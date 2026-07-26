use std::time::Instant;

use reqwest::{
    header::{ACCEPT, CONTENT_TYPE, COOKIE, SET_COOKIE},
    Client, Response, StatusCode,
};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use url::{form_urlencoded, Url};
use zeroize::Zeroize;

use crate::{
    network::{build_pinned_client, parse_admin_endpoint, validate_public_host},
    security::read_secret,
};

const MAXIMUM_CONFIG_BYTES: usize = 1_048_576;
const MAXIMUM_PASSWORD_BYTES: usize = 1_024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminInspection {
    adapter: &'static str,
    authenticated: bool,
    config_updated_at: Option<String>,
    credential_fingerprint: String,
    host_count: usize,
    node_path_fingerprint: String,
    preference_mode: &'static str,
    preferred_endpoint_count: u64,
    protocol: String,
    response_time_ms: u128,
    skip_certificate_verification: bool,
    specified_port: Option<u64>,
    subscription_ready: bool,
    transport: String,
    usage_max: Option<u64>,
    usage_total: Option<u64>,
}

#[tauri::command]
pub async fn inspect_admin_deployment(
    endpoint: String,
    mut password: String,
) -> Result<AdminInspection, String> {
    let result = inspect_with_password(&endpoint, &password).await;
    password.zeroize();
    result
}

#[tauri::command]
pub async fn open_admin_endpoint(app: AppHandle, endpoint: String) -> Result<(), String> {
    let parsed_url = parse_admin_endpoint(&endpoint)?;
    validate_public_host(&parsed_url).await?;
    app.opener()
        .open_url(parsed_url.to_string(), None::<String>)
        .map_err(|_| "无法使用系统浏览器打开管理后台。".to_string())
}

#[tauri::command]
pub async fn refresh_admin_deployment(
    endpoint: String,
    credential_reference: String,
) -> Result<AdminInspection, String> {
    let mut password =
        tauri::async_runtime::spawn_blocking(move || read_secret(&credential_reference))
            .await
            .map_err(|_| "无法读取系统钥匙串中的管理密码。".to_string())??;
    let result = inspect_with_password(&endpoint, &password).await;
    password.zeroize();
    result
}

async fn inspect_with_password(endpoint: &str, password: &str) -> Result<AdminInspection, String> {
    if password.is_empty() || password.len() > MAXIMUM_PASSWORD_BYTES {
        return Err("管理员密码为空或超过安全长度限制。".into());
    }

    let started_at = Instant::now();
    let admin_url = parse_admin_endpoint(endpoint)?;
    let resolved_addresses = validate_public_host(&admin_url).await?;
    let hostname = admin_url
        .host_str()
        .ok_or_else(|| "管理地址缺少域名。".to_string())?;
    let client = build_pinned_client(hostname, &resolved_addresses, "Glide-Admin/0.2.2")?;
    let auth_cookie = authenticate(&client, &admin_url, password).await?;
    let config = fetch_config(&client, &admin_url, &auth_cookie).await?;
    inspection_from_config(&config, started_at.elapsed().as_millis())
}

async fn authenticate(client: &Client, admin_url: &Url, password: &str) -> Result<String, String> {
    let login_url = admin_url
        .join("/login")
        .map_err(|_| "管理后台登录地址无效。".to_string())?;
    let form_body = form_urlencoded::Serializer::new(String::new())
        .append_pair("password", password)
        .finish();
    let response = client
        .post(login_url)
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(form_body)
        .send()
        .await
        .map_err(safe_request_error)?;

    if response.status().is_server_error() {
        return Err(format!(
            "管理后台暂时不可用，服务器返回 {}。",
            response.status().as_u16()
        ));
    }
    extract_auth_cookie(&response)
        .ok_or_else(|| "管理员密码不正确，或该后台版本不支持 Glide 的安全登录协议。".to_string())
}

fn extract_auth_cookie(response: &Response) -> Option<String> {
    response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|header| header.to_str().ok())
        .filter_map(|header| header.split(';').next())
        .find_map(|cookie| {
            let value = cookie.trim().strip_prefix("auth=")?;
            let valid =
                value.len() == 32 && value.chars().all(|character| character.is_ascii_hexdigit());
            valid.then(|| format!("auth={value}"))
        })
}

async fn fetch_config(
    client: &Client,
    admin_url: &Url,
    auth_cookie: &str,
) -> Result<Value, String> {
    let config_url = admin_url
        .join("/admin/config.json")
        .map_err(|_| "管理后台配置地址无效。".to_string())?;
    let response = client
        .get(config_url)
        .header(ACCEPT, "application/json")
        .header(COOKIE, auth_cookie)
        .send()
        .await
        .map_err(safe_request_error)?;

    if response.status().is_redirection()
        || matches!(
            response.status(),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
        )
    {
        return Err("管理会话被拒绝；请重新确认管理员密码。".into());
    }
    if !response.status().is_success() {
        return Err(format!(
            "配置读取失败，管理后台返回 {}。",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAXIMUM_CONFIG_BYTES as u64)
    {
        return Err("管理配置响应过大，已停止读取。".into());
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|header| header.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !content_type.contains("application/json") {
        return Err("管理后台没有返回 JSON 配置；可能是密码错误或版本不兼容。".into());
    }
    let bytes = response.bytes().await.map_err(safe_request_error)?;
    if bytes.len() > MAXIMUM_CONFIG_BYTES {
        return Err("管理配置响应过大，已停止读取。".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "管理配置不是有效 JSON。".to_string())
}

fn inspection_from_config(
    config: &Value,
    response_time_ms: u128,
) -> Result<AdminInspection, String> {
    required_string(config, "HOST")?;
    let node_credential = required_string(config, "UUID")?;
    let node_path = required_string(config, "PATH")?;
    let preferred = config.get("优选订阅生成").and_then(Value::as_object);
    let local_mode = preferred
        .and_then(|value| value.get("local"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let local_library = preferred
        .and_then(|value| value.get("本地IP库"))
        .and_then(Value::as_object);
    let random_mode = local_library
        .and_then(|value| value.get("随机IP"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let preference_mode = if !local_mode {
        "generator"
    } else if random_mode {
        "random"
    } else {
        "custom"
    };
    let usage = config
        .get("CF")
        .and_then(Value::as_object)
        .and_then(|value| value.get("Usage"))
        .and_then(Value::as_object);

    Ok(AdminInspection {
        adapter: "cmliu-edgetunnel",
        authenticated: true,
        config_updated_at: safe_optional_string(config.get("TIME"), 64),
        credential_fingerprint: fingerprint(node_credential),
        host_count: config
            .get("HOSTS")
            .and_then(Value::as_array)
            .map_or(1, |hosts| hosts.len().clamp(1, 128)),
        node_path_fingerprint: fingerprint(node_path),
        preference_mode,
        preferred_endpoint_count: local_library
            .and_then(|value| value.get("随机数量"))
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(1_000),
        protocol: safe_optional_string(config.get("协议类型"), 24)
            .unwrap_or_else(|| "unknown".into()),
        response_time_ms,
        skip_certificate_verification: config
            .get("跳过证书验证")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        specified_port: local_library
            .and_then(|value| value.get("指定端口"))
            .and_then(Value::as_u64)
            .filter(|port| *port <= 65_535),
        subscription_ready: preferred
            .and_then(|value| value.get("TOKEN"))
            .and_then(Value::as_str)
            .is_some_and(|token| !token.is_empty())
            && config
                .get("LINK")
                .and_then(Value::as_str)
                .is_some_and(|link| !link.is_empty()),
        transport: safe_optional_string(config.get("传输协议"), 24)
            .unwrap_or_else(|| "unknown".into()),
        usage_max: usage
            .and_then(|value| value.get("max"))
            .and_then(Value::as_u64),
        usage_total: usage
            .and_then(|value| value.get("total"))
            .and_then(Value::as_u64),
    })
}

fn fingerprint(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    digest[..6]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn required_string<'a>(config: &'a Value, key: &str) -> Result<&'a str, String> {
    config
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "管理配置缺少必要字段；该后台版本暂不兼容。".to_string())
}

fn safe_optional_string(value: Option<&Value>, maximum_length: usize) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(|text| text.chars().take(maximum_length).collect())
}

fn safe_request_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "管理后台响应超时；请检查当前网络、DNS 或 Cloudflare 状态。".into()
    } else if error.is_connect() {
        "无法建立 HTTPS 连接；请检查域名、证书和当前网络。".into()
    } else {
        "管理后台请求失败；原始错误已脱敏。".into()
    }
}

#[cfg(test)]
mod tests {
    use reqwest::header::{HeaderMap, HeaderValue, SET_COOKIE};
    use serde_json::json;

    use super::{inspection_from_config, MAXIMUM_CONFIG_BYTES};

    #[test]
    fn extracts_only_well_formed_auth_cookie() {
        let mut headers = HeaderMap::new();
        headers.insert(
            SET_COOKIE,
            HeaderValue::from_static(
                "auth=0123456789abcdef0123456789abcdef; Path=/; HttpOnly; Secure",
            ),
        );
        let cookie = headers
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|header| header.to_str().ok())
            .filter_map(|header| header.split(';').next())
            .find_map(|cookie| {
                let value = cookie.trim().strip_prefix("auth=")?;
                (value.len() == 32 && value.chars().all(|character| character.is_ascii_hexdigit()))
                    .then(|| format!("auth={value}"))
            });
        assert_eq!(
            cookie.as_deref(),
            Some("auth=0123456789abcdef0123456789abcdef")
        );
    }

    #[test]
    fn parses_supported_config_without_returning_secrets() {
        let config = json!({
            "CF": { "Usage": { "max": 100000, "total": 12 } },
            "HOST": "private.example.com",
            "HOSTS": ["private.example.com"],
            "LINK": "vless://secret",
            "PATH": "/secret-path",
            "TIME": "2026-07-27T00:00:00Z",
            "UUID": "00000000-0000-4000-8000-000000000000",
            "传输协议": "ws",
            "优选订阅生成": {
                "TOKEN": "secret-token",
                "local": true,
                "本地IP库": { "指定端口": 443, "随机IP": true, "随机数量": 16 }
            },
            "协议类型": "vless",
            "跳过证书验证": false
        });
        let inspection = inspection_from_config(&config, 123).unwrap();
        let serialized = serde_json::to_string(&inspection).unwrap();

        assert!(serialized.contains("\"authenticated\":true"));
        assert!(serialized.contains("\"preferredEndpointCount\":16"));
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("00000000"));
        assert!(MAXIMUM_CONFIG_BYTES >= serialized.len());
    }

    #[test]
    fn rejects_unknown_config_shape() {
        assert!(inspection_from_config(&json!({ "HOST": "example.com" }), 1).is_err());
    }
}
