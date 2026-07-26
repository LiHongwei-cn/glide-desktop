use std::time::Instant;

use reqwest::StatusCode;
use serde::Serialize;

use crate::network::{
    build_pinned_client, parse_admin_endpoint, redact_endpoint, validate_public_host,
};

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
    let client = match build_pinned_client(hostname, &resolved_addresses, "Glide-Diagnostics/0.2.2")
    {
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

    use super::response_to_probe;

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
