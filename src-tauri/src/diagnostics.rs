use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    time::{Duration, Instant},
};

use reqwest::{redirect::Policy, Client, StatusCode};
use serde::Serialize;
use tokio::net::lookup_host;
use url::Url;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointProbe {
    detail: String,
    duration_ms: Option<u128>,
    endpoint: String,
    status: &'static str,
}

#[tauri::command]
pub async fn probe_endpoints(endpoints: Vec<String>) -> Result<Vec<EndpointProbe>, String> {
    if endpoints.is_empty() || endpoints.len() > 20 {
        return Err("一次只能检查 1–20 个管理入口。".into());
    }

    let mut results = Vec::with_capacity(endpoints.len());

    for endpoint in endpoints {
        results.push(probe_endpoint(&endpoint).await);
    }
    Ok(results)
}

#[tauri::command]
pub async fn validate_admin_endpoint(endpoint: String) -> Result<String, String> {
    let parsed_url = parse_admin_endpoint(&endpoint)?;
    validate_public_host(&parsed_url).await?;
    Ok(parsed_url.to_string().trim_end_matches('/').to_string())
}

async fn probe_endpoint(endpoint: &str) -> EndpointProbe {
    let started_at = Instant::now();
    let parsed_url = match parse_admin_endpoint(endpoint) {
        Ok(url) => url,
        Err(detail) => {
            return EndpointProbe {
                detail,
                duration_ms: None,
                endpoint: "无效地址".into(),
                status: "failed",
            }
        }
    };
    let redacted_endpoint = redact_endpoint(&parsed_url);

    let resolved_addresses = match validate_public_host(&parsed_url).await {
        Ok(addresses) => addresses,
        Err(detail) => {
            return EndpointProbe {
                detail,
                duration_ms: Some(started_at.elapsed().as_millis()),
                endpoint: redacted_endpoint,
                status: "failed",
            }
        }
    };
    let hostname = parsed_url.host_str().unwrap_or_default();
    let client = match build_pinned_client(hostname, &resolved_addresses) {
        Ok(client) => client,
        Err(detail) => {
            return EndpointProbe {
                detail,
                duration_ms: Some(started_at.elapsed().as_millis()),
                endpoint: redacted_endpoint,
                status: "failed",
            }
        }
    };

    match client.head(parsed_url).send().await {
        Ok(response) => response_to_probe(response.status(), redacted_endpoint, started_at),
        Err(error) if error.is_timeout() => EndpointProbe {
            detail: "连接超时；请检查 DNS、证书或当前网络。".into(),
            duration_ms: Some(started_at.elapsed().as_millis()),
            endpoint: redacted_endpoint,
            status: "failed",
        },
        Err(_) => EndpointProbe {
            detail: "无法建立 HTTPS 连接；原始错误已脱敏。".into(),
            duration_ms: Some(started_at.elapsed().as_millis()),
            endpoint: redacted_endpoint,
            status: "failed",
        },
    }
}

fn parse_admin_endpoint(endpoint: &str) -> Result<Url, String> {
    let parsed_url = Url::parse(endpoint).map_err(|_| "管理地址格式无效。".to_string())?;
    if parsed_url.scheme() != "https" {
        return Err("管理入口必须使用 HTTPS。".into());
    }
    if !parsed_url.username().is_empty() || parsed_url.password().is_some() {
        return Err("管理地址不能包含内嵌用户名或密码。".into());
    }
    if parsed_url.query().is_some() || parsed_url.fragment().is_some() {
        return Err("管理地址不能包含查询参数或片段。".into());
    }
    if !parsed_url.path().trim_end_matches('/').ends_with("/admin") {
        return Err("管理地址必须指向 /admin。".into());
    }
    if parsed_url.host_str().is_none() {
        return Err("管理地址缺少域名。".into());
    }
    Ok(parsed_url)
}

fn build_pinned_client(hostname: &str, addresses: &[SocketAddr]) -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .redirect(Policy::none())
        .resolve_to_addrs(hostname, addresses)
        .timeout(Duration::from_secs(8))
        .user_agent("Glide-Diagnostics/0.2.1")
        .build()
        .map_err(|_| "无法创建安全诊断客户端。".to_string())
}

async fn validate_public_host(url: &Url) -> Result<Vec<SocketAddr>, String> {
    let hostname = url
        .host_str()
        .ok_or_else(|| "管理地址缺少域名。".to_string())?;
    let port = url.port_or_known_default().unwrap_or(443);
    let resolved_addresses = lookup_host((hostname, port))
        .await
        .map_err(|_| "域名解析失败。".to_string())?
        .collect::<Vec<_>>();

    if resolved_addresses.is_empty() {
        return Err("域名没有可用地址。".into());
    }
    if resolved_addresses.len() > 32 {
        return Err("域名返回了异常数量的地址，已停止检查。".into());
    }
    if resolved_addresses
        .iter()
        .any(|address| is_forbidden_ip(address.ip()))
    {
        return Err("出于 SSRF 防护，不能检查本机、私网或保留地址。".into());
    }
    Ok(resolved_addresses)
}

fn is_forbidden_ip(ip_address: IpAddr) -> bool {
    match ip_address {
        IpAddr::V4(address) => is_forbidden_ipv4(address),
        IpAddr::V6(address) => is_forbidden_ipv6(address),
    }
}

fn is_forbidden_ipv4(address: Ipv4Addr) -> bool {
    let [first, second, third, _] = address.octets();
    first == 0
        || first == 10
        || (first == 100 && (64..=127).contains(&second))
        || first == 127
        || (first == 169 && second == 254)
        || (first == 172 && (16..=31).contains(&second))
        || (first == 192 && second == 0 && third == 0)
        || (first == 192 && second == 0 && third == 2)
        || (first == 192 && second == 88 && third == 99)
        || (first == 192 && second == 168)
        || (first == 198 && (second == 18 || second == 19))
        || (first == 198 && second == 51 && third == 100)
        || (first == 203 && second == 0 && third == 113)
        || first >= 224
}

fn is_forbidden_ipv6(address: Ipv6Addr) -> bool {
    if let Some(mapped_ipv4) = address.to_ipv4() {
        return is_forbidden_ipv4(mapped_ipv4);
    }
    let segments = address.segments();
    address.is_loopback()
        || address.is_multicast()
        || address.is_unique_local()
        || address.is_unicast_link_local()
        || address.is_unspecified()
        || (segments[0] == 0x0064
            && segments[1] == 0xff9b
            && segments[2..6].iter().all(|segment| *segment == 0))
        || (segments[0] == 0x0064 && segments[1] == 0xff9b && segments[2] == 1)
        || (segments[0] == 0x0100 && segments[1..4].iter().all(|segment| *segment == 0))
        || (segments[0] == 0x2001 && segments[1] == 0)
        || (segments[0] == 0x2001 && segments[1] & 0xfff0 == 0x0010)
        || (segments[0] == 0x2001 && segments[1] & 0xfff0 == 0x0020)
        || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        || segments[0] == 0x2002
}

fn redact_endpoint(url: &Url) -> String {
    let hostname = url.host_str().unwrap_or("unknown");
    let labels = hostname.split('.').collect::<Vec<_>>();
    if labels.len() < 3 {
        return hostname.to_string();
    }
    format!("••••.{}", labels[labels.len() - 2..].join("."))
}

fn response_to_probe(
    status_code: StatusCode,
    endpoint: String,
    started_at: Instant,
) -> EndpointProbe {
    let (detail, status) = if status_code.is_success() {
        (
            format!("HTTPS 入口可达，状态 {}。", status_code.as_u16()),
            "passed",
        )
    } else if matches!(
        status_code,
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::METHOD_NOT_ALLOWED
    ) {
        (
            format!(
                "HTTPS 入口可达且受到访问控制，状态 {}。",
                status_code.as_u16()
            ),
            "passed",
        )
    } else if status_code.is_server_error() {
        (
            format!("入口可达，但服务器返回 {}。", status_code.as_u16()),
            "warning",
        )
    } else if status_code.is_redirection() {
        ("入口可达并返回重定向；未自动跟随。".into(), "warning")
    } else {
        (
            format!(
                "入口可达，但返回客户端错误 {}；请核对 /admin 路径。",
                status_code.as_u16()
            ),
            "warning",
        )
    };
    EndpointProbe {
        detail,
        duration_ms: Some(started_at.elapsed().as_millis()),
        endpoint,
        status,
    }
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use reqwest::StatusCode;

    use super::{is_forbidden_ip, parse_admin_endpoint, response_to_probe};

    #[test]
    fn rejects_insecure_admin_url() {
        assert!(parse_admin_endpoint("http://example.com/admin").is_err());
    }

    #[test]
    fn rejects_non_admin_path() {
        assert!(parse_admin_endpoint("https://example.com/dashboard").is_err());
    }

    #[test]
    fn blocks_private_ip_addresses() {
        assert!(is_forbidden_ip("127.0.0.1".parse().unwrap()));
        assert!(is_forbidden_ip("10.0.0.1".parse().unwrap()));
        assert!(is_forbidden_ip("100.64.0.1".parse().unwrap()));
        assert!(is_forbidden_ip("198.18.0.1".parse().unwrap()));
        assert!(is_forbidden_ip("::ffff:10.0.0.1".parse().unwrap()));
        assert!(is_forbidden_ip("2001:db8::1".parse().unwrap()));
        assert!(!is_forbidden_ip("1.1.1.1".parse().unwrap()));
        assert!(!is_forbidden_ip("2606:4700:4700::1111".parse().unwrap()));
    }

    #[test]
    fn classifies_protected_and_missing_admin_endpoints() {
        let protected = response_to_probe(
            StatusCode::UNAUTHORIZED,
            "••••.example.com".into(),
            Instant::now(),
        );
        let missing = response_to_probe(
            StatusCode::NOT_FOUND,
            "••••.example.com".into(),
            Instant::now(),
        );

        assert_eq!(protected.status, "passed");
        assert_eq!(missing.status, "warning");
    }
}
