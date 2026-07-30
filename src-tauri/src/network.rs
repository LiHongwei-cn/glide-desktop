use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    time::Duration,
};

use reqwest::{redirect::Policy, Client};
use tokio::net::lookup_host;
use url::Url;

pub fn build_pinned_client(
    hostname: &str,
    addresses: &[SocketAddr],
    user_agent: &str,
) -> Result<Client, String> {
    Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .redirect(Policy::none())
        .resolve_to_addrs(hostname, addresses)
        .timeout(Duration::from_secs(10))
        .user_agent(user_agent)
        .build()
        .map_err(|_| "无法创建安全网络客户端。".to_string())
}

pub fn parse_admin_endpoint(endpoint: &str) -> Result<Url, String> {
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

pub fn redact_endpoint(url: &Url) -> String {
    let hostname = url.host_str().unwrap_or("unknown");
    let labels = hostname.split('.').collect::<Vec<_>>();
    if labels.len() < 3 {
        return hostname.to_string();
    }
    format!("••••.{}", labels[labels.len() - 2..].join("."))
}

pub async fn validate_public_host(url: &Url) -> Result<Vec<SocketAddr>, String> {
    validate_resolved_host(url, true).await
}

pub async fn validate_public_node_host(url: &Url) -> Result<Vec<SocketAddr>, String> {
    validate_resolved_host(url, false).await
}

async fn validate_resolved_host(
    url: &Url,
    allow_tls_proxy_fake_ip: bool,
) -> Result<Vec<SocketAddr>, String> {
    let hostname = url
        .host_str()
        .ok_or_else(|| "管理地址缺少域名。".to_string())?;
    let port = url.port_or_known_default().unwrap_or(443);
    let system_addresses = lookup_host((hostname, port))
        .await
        .map(|addresses| addresses.collect::<Vec<_>>())
        .unwrap_or_default();

    if addresses_are_public(&system_addresses)
        || (allow_tls_proxy_fake_ip && addresses_are_tls_proxy_fake_ips(&system_addresses))
    {
        return Ok(system_addresses);
    }

    Err("域名解析到了本机、私网或未知保留地址，已停止连接。".into())
}

fn addresses_are_public(addresses: &[SocketAddr]) -> bool {
    !addresses.is_empty()
        && addresses.len() <= 32
        && addresses
            .iter()
            .all(|address| !is_forbidden_ip(address.ip()))
}

fn addresses_are_tls_proxy_fake_ips(addresses: &[SocketAddr]) -> bool {
    // Fake-IP 只用于建立 TLS 连接；证书仍按原始域名校验，验证通过前不会发送密码。
    !addresses.is_empty()
        && addresses.len() <= 32
        && addresses
            .iter()
            .all(|address| is_tls_proxy_fake_ip(address.ip()))
}

fn is_tls_proxy_fake_ip(ip_address: IpAddr) -> bool {
    match ip_address {
        IpAddr::V4(address) => is_benchmarking_ipv4(address),
        IpAddr::V6(address) => {
            let segments = address.segments();
            if segments[..4] == [0, 0, 0, 0] && segments[4] == 0xffff && segments[5] == 0 {
                let encoded = Ipv4Addr::new(
                    (segments[6] >> 8) as u8,
                    segments[6] as u8,
                    (segments[7] >> 8) as u8,
                    segments[7] as u8,
                );
                return is_benchmarking_ipv4(encoded);
            }
            false
        }
    }
}

fn is_benchmarking_ipv4(address: Ipv4Addr) -> bool {
    let [first, second, _, _] = address.octets();
    first == 198 && (second == 18 || second == 19)
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

#[cfg(test)]
mod tests {
    use super::{
        addresses_are_public, addresses_are_tls_proxy_fake_ips, is_forbidden_ip,
        parse_admin_endpoint,
    };

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
    fn rejects_insecure_or_incorrect_admin_urls() {
        assert!(parse_admin_endpoint("http://example.com/admin").is_err());
        assert!(parse_admin_endpoint("https://example.com/dashboard").is_err());
    }

    #[test]
    fn accepts_only_the_standard_fake_ip_pool_for_tls_proxy_compatibility() {
        let fake_addresses = [
            "198.18.0.84:443".parse().unwrap(),
            "[::ffff:0:c612:54]:443".parse().unwrap(),
        ];
        let mixed_addresses = [
            "198.18.0.84:443".parse().unwrap(),
            "127.0.0.1:443".parse().unwrap(),
        ];

        assert!(addresses_are_tls_proxy_fake_ips(&fake_addresses));
        assert!(!addresses_are_tls_proxy_fake_ips(&mixed_addresses));
    }

    #[test]
    fn refuses_mixed_public_and_private_dns_answers() {
        let addresses = [
            "104.21.94.193:443".parse().unwrap(),
            "127.0.0.1:443".parse().unwrap(),
        ];

        assert!(!addresses_are_public(&addresses));
    }
}
