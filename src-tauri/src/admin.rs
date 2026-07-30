use std::{
    collections::{BTreeSet, HashMap, HashSet},
    sync::Arc,
    time::{Duration, Instant},
};

use base64::{engine::general_purpose, Engine as _};
use percent_encoding::percent_decode_str;
use reqwest::{
    header::{ACCEPT, CONTENT_TYPE, COOKIE, SET_COOKIE},
    Client, Response, StatusCode,
};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use tokio::{net::TcpStream, sync::Semaphore, task::JoinSet};
use url::{form_urlencoded, Url};
use zeroize::Zeroize;

use crate::{
    network::{
        build_pinned_client, parse_admin_endpoint, validate_public_host, validate_public_node_host,
    },
    security::read_secret,
};

const MAXIMUM_CONFIG_BYTES: usize = 1_048_576;
const MAXIMUM_NODE_COUNT: usize = 512;
const MAXIMUM_NODE_NAME_CHARS: usize = 80;
const MAXIMUM_NODE_PROBE_TARGETS: usize = 24;
const MAXIMUM_NODE_URI_BYTES: usize = 8_192;
const MAXIMUM_PASSWORD_BYTES: usize = 1_024;
const MAXIMUM_SUBSCRIPTION_BYTES: usize = 2_097_152;
const MAXIMUM_SUBSCRIPTION_TOKEN_BYTES: usize = 512;
const MAXIMUM_CONCURRENT_NODE_PROBES: usize = 4;
const MINIMUM_CREDIBLE_NODE_LATENCY: Duration = Duration::from_millis(5);
const NODE_PROBE_BUDGET: Duration = Duration::from_secs(6);
const NODE_PROBE_TIMEOUT: Duration = Duration::from_millis(1_800);
const OPTIMIZATION_PROBE_TIMEOUT: Duration = Duration::from_secs(12);
const ROUTE_REFRESH_TIMEOUT: Duration = Duration::from_secs(8);
const SUBSCRIPTION_RETRY_DELAY: Duration = Duration::from_millis(350);

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedSubscription {
    nodes: Vec<SubscriptionNode>,
    response_time_ms: u128,
    subscription_url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionNode {
    display_name: String,
    id: String,
    latency_ms: Option<u128>,
    latency_status: &'static str,
    protocol: String,
    region: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedSubscriptionNode {
    display_name: String,
    node_uri: String,
    protocol: String,
    region: String,
    response_time_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteOptimizationProbe {
    inspection: AdminInspection,
    subscription: PreparedSubscription,
}

struct AuthenticatedConfig {
    admin_url: Url,
    client: Client,
    config: Value,
    started_at: Instant,
}

struct ParsedSubscriptionNode {
    metadata: SubscriptionNode,
    uri: String,
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
pub async fn prepare_route_subscription(
    endpoint: String,
    credential_reference: String,
) -> Result<PreparedSubscription, String> {
    let mut password =
        tauri::async_runtime::spawn_blocking(move || read_secret(&credential_reference))
            .await
            .map_err(|_| "无法读取 Glide 本机加密目录中的管理密码。".to_string())??;
    let result = prepare_subscription_with_password(&endpoint, &password).await;
    password.zeroize();
    result
}

#[tauri::command]
pub async fn prepare_route_subscription_node(
    endpoint: String,
    credential_reference: String,
    node_id: String,
) -> Result<PreparedSubscriptionNode, String> {
    validate_node_id(&node_id)?;
    let mut password =
        tauri::async_runtime::spawn_blocking(move || read_secret(&credential_reference))
            .await
            .map_err(|_| "无法读取 Glide 本机加密目录中的管理密码。".to_string())??;
    let result = prepare_subscription_node_with_password(&endpoint, &password, &node_id).await;
    password.zeroize();
    result
}

#[tauri::command]
pub async fn probe_route_for_optimization(
    endpoint: String,
    credential_reference: String,
) -> Result<RouteOptimizationProbe, String> {
    let mut password =
        tauri::async_runtime::spawn_blocking(move || read_secret(&credential_reference))
            .await
            .map_err(|_| "无法读取 Glide 本机加密目录中的管理密码。".to_string())??;
    let result = match tokio::time::timeout(
        OPTIMIZATION_PROBE_TIMEOUT,
        probe_route_with_password(&endpoint, &password),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => Err("节点验证超过 12 秒，已跳过这条线路。".to_string()),
    };
    password.zeroize();
    result
}

#[tauri::command]
pub async fn refresh_admin_deployment(
    endpoint: String,
    credential_reference: String,
) -> Result<AdminInspection, String> {
    let mut password =
        tauri::async_runtime::spawn_blocking(move || read_secret(&credential_reference))
            .await
            .map_err(|_| "无法读取 Glide 本机加密目录中的管理密码。".to_string())??;
    let result = match tokio::time::timeout(
        ROUTE_REFRESH_TIMEOUT,
        inspect_with_password(&endpoint, &password),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => Err("刷新超过 8 秒，已保留上次状态。".to_string()),
    };
    password.zeroize();
    result
}

pub(crate) async fn inspect_with_password(
    endpoint: &str,
    password: &str,
) -> Result<AdminInspection, String> {
    let context = fetch_authenticated_config(endpoint, password).await?;
    inspection_from_config(&context.config, context.started_at.elapsed().as_millis())
}

pub(crate) async fn prepare_subscription_with_password(
    endpoint: &str,
    password: &str,
) -> Result<PreparedSubscription, String> {
    let context = fetch_authenticated_config(endpoint, password).await?;
    prepare_subscription_from_context(&context).await
}

async fn prepare_subscription_node_with_password(
    endpoint: &str,
    password: &str,
    node_id: &str,
) -> Result<PreparedSubscriptionNode, String> {
    let context = fetch_authenticated_config(endpoint, password).await?;
    let subscription_url = subscription_url_from_config(&context.admin_url, &context.config)?;
    let content = fetch_subscription_with_retry(&context.client, &subscription_url).await?;
    let selected = parse_subscription_nodes(&content)?
        .into_iter()
        .find(|node| node.metadata.id == node_id)
        .ok_or_else(|| "订阅内容已更新，所选节点不存在；请重新选择。".to_string())?;
    Ok(PreparedSubscriptionNode {
        display_name: selected.metadata.display_name,
        node_uri: selected.uri,
        protocol: selected.metadata.protocol,
        region: selected.metadata.region,
        response_time_ms: context.started_at.elapsed().as_millis(),
    })
}

async fn probe_route_with_password(
    endpoint: &str,
    password: &str,
) -> Result<RouteOptimizationProbe, String> {
    let context = fetch_authenticated_config(endpoint, password).await?;
    let inspection =
        inspection_from_config(&context.config, context.started_at.elapsed().as_millis())?;
    let subscription = prepare_subscription_from_context(&context).await?;

    Ok(RouteOptimizationProbe {
        inspection,
        subscription,
    })
}

async fn prepare_subscription_from_context(
    context: &AuthenticatedConfig,
) -> Result<PreparedSubscription, String> {
    let subscription_url = subscription_url_from_config(&context.admin_url, &context.config)?;
    let content = fetch_subscription_with_retry(&context.client, &subscription_url).await?;
    let response_time_ms = context.started_at.elapsed().as_millis();
    let mut parsed_nodes = parse_subscription_nodes(&content)?;
    probe_node_entry_latency(&mut parsed_nodes).await;
    let nodes = parsed_nodes.into_iter().map(|node| node.metadata).collect();

    Ok(PreparedSubscription {
        nodes,
        response_time_ms,
        subscription_url: subscription_url.to_string(),
    })
}

async fn probe_node_entry_latency(nodes: &mut [ParsedSubscriptionNode]) {
    let targets = nodes
        .iter()
        .filter_map(|node| node_probe_target(&node.uri))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .take(MAXIMUM_NODE_PROBE_TARGETS);
    let semaphore = node_probe_semaphore();
    let mut probes = JoinSet::new();

    for (host, port) in targets {
        let semaphore = Arc::clone(&semaphore);
        probes.spawn(async move {
            let Ok(_permit) = semaphore.acquire_owned().await else {
                return ((host, port), NodeLatency::Unavailable);
            };
            let result = probe_public_node_entry(&host, port).await;
            ((host, port), result)
        });
    }

    let mut results = HashMap::new();
    let deadline = tokio::time::Instant::now() + NODE_PROBE_BUDGET;
    loop {
        match tokio::time::timeout_at(deadline, probes.join_next()).await {
            Ok(Some(Ok((target, latency)))) => {
                results.insert(target, latency);
            }
            Ok(Some(Err(_))) => {}
            Ok(None) => break,
            Err(_) => {
                probes.abort_all();
                break;
            }
        }
    }

    for node in nodes {
        let latency = node_probe_target(&node.uri)
            .and_then(|target| results.get(&target).copied())
            .unwrap_or(NodeLatency::Unavailable);
        match latency {
            NodeLatency::Reachable(latency_ms) => {
                node.metadata.latency_ms = Some(latency_ms);
                node.metadata.latency_status = "reachable";
            }
            NodeLatency::Timeout => node.metadata.latency_status = "timeout",
            NodeLatency::Unavailable => node.metadata.latency_status = "unavailable",
        }
    }
}

fn node_probe_semaphore() -> Arc<Semaphore> {
    static NODE_PROBE_SEMAPHORE: std::sync::OnceLock<Arc<Semaphore>> = std::sync::OnceLock::new();
    Arc::clone(
        NODE_PROBE_SEMAPHORE
            .get_or_init(|| Arc::new(Semaphore::new(MAXIMUM_CONCURRENT_NODE_PROBES))),
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NodeLatency {
    Reachable(u128),
    Timeout,
    Unavailable,
}

fn node_probe_target(uri: &str) -> Option<(String, u16)> {
    let parsed = Url::parse(uri).ok()?;
    let host = parsed.host_str()?.trim().to_ascii_lowercase();
    let port = parsed.port()?;
    if host.is_empty() {
        return None;
    }
    Some((host, port))
}

async fn probe_public_node_entry(host: &str, port: u16) -> NodeLatency {
    let mut validation_url = match Url::parse("https://glide.invalid/") {
        Ok(url) => url,
        Err(_) => return NodeLatency::Unavailable,
    };
    if validation_url.set_host(Some(host)).is_err() || validation_url.set_port(Some(port)).is_err()
    {
        return NodeLatency::Unavailable;
    }
    let addresses = match validate_public_node_host(&validation_url).await {
        Ok(addresses) => addresses,
        Err(_) => return NodeLatency::Unavailable,
    };
    let started_at = Instant::now();
    let connection = tokio::time::timeout(NODE_PROBE_TIMEOUT, async {
        for address in addresses {
            if TcpStream::connect(address).await.is_ok() {
                return true;
            }
        }
        false
    })
    .await;
    match connection {
        Ok(true) => classify_node_latency(started_at.elapsed()),
        Ok(false) | Err(_) => NodeLatency::Timeout,
    }
}

fn classify_node_latency(elapsed: Duration) -> NodeLatency {
    if elapsed < MINIMUM_CREDIBLE_NODE_LATENCY {
        NodeLatency::Unavailable
    } else {
        NodeLatency::Reachable(elapsed.as_millis())
    }
}

async fn fetch_authenticated_config(
    endpoint: &str,
    password: &str,
) -> Result<AuthenticatedConfig, String> {
    if password.is_empty() || password.len() > MAXIMUM_PASSWORD_BYTES {
        return Err("管理员密码为空或超过安全长度限制。".into());
    }

    let started_at = Instant::now();
    let admin_url = parse_admin_endpoint(endpoint)?;
    let resolved_addresses = validate_public_host(&admin_url).await?;
    let hostname = admin_url
        .host_str()
        .ok_or_else(|| "管理地址缺少域名。".to_string())?;
    let client = build_pinned_client(hostname, &resolved_addresses, "Glide-Admin/0.6.1")?;
    let auth_cookie = authenticate(&client, &admin_url, password).await?;
    let config = fetch_config(&client, &admin_url, &auth_cookie).await?;
    Ok(AuthenticatedConfig {
        admin_url,
        client,
        config,
        started_at,
    })
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

async fn fetch_subscription(client: &Client, subscription_url: &Url) -> Result<Vec<u8>, String> {
    let response = client
        .get(subscription_url.clone())
        .header(ACCEPT, "text/plain, application/x-yaml")
        .send()
        .await
        .map_err(safe_request_error)?;
    if !response.status().is_success() {
        return Err(format!(
            "订阅验证失败，服务器返回 {}。",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAXIMUM_SUBSCRIPTION_BYTES as u64)
    {
        return Err("订阅内容超过安全大小限制。".into());
    }
    let bytes = response.bytes().await.map_err(safe_request_error)?;
    if bytes.is_empty() || bytes.len() > MAXIMUM_SUBSCRIPTION_BYTES {
        return Err("订阅内容为空或超过安全大小限制。".into());
    }
    if !looks_like_subscription(&bytes) {
        return Err("订阅地址返回了网页或无效内容，请检查后台订阅设置。".into());
    }
    Ok(bytes.to_vec())
}

async fn fetch_subscription_with_retry(
    client: &Client,
    subscription_url: &Url,
) -> Result<Vec<u8>, String> {
    match fetch_subscription(client, subscription_url).await {
        Ok(content) => Ok(content),
        Err(first_error) => {
            tokio::time::sleep(SUBSCRIPTION_RETRY_DELAY).await;
            fetch_subscription(client, subscription_url)
                .await
                .map_err(|_| first_error)
        }
    }
}

fn looks_like_subscription(bytes: &[u8]) -> bool {
    decode_subscription_content(bytes).is_some()
}

fn decode_subscription_content(bytes: &[u8]) -> Option<String> {
    let Ok(content) = std::str::from_utf8(bytes) else {
        return None;
    };
    let content = content.trim();
    if content.len() < 16 || content.starts_with('<') {
        return None;
    }
    if contains_subscription_marker(content) {
        return Some(content.to_string());
    }
    if content.bytes().any(|byte| matches!(byte, b' ' | b'\t')) {
        return None;
    }
    let encoded = content
        .bytes()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect::<Vec<_>>();
    if encoded.len() < 32
        || !encoded.iter().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'=' | b'-' | b'_')
        })
    {
        return None;
    }
    [
        &general_purpose::STANDARD,
        &general_purpose::STANDARD_NO_PAD,
        &general_purpose::URL_SAFE,
        &general_purpose::URL_SAFE_NO_PAD,
    ]
    .iter()
    .filter_map(|engine| engine.decode(&encoded).ok())
    .filter_map(|decoded| String::from_utf8(decoded).ok())
    .find(|decoded| contains_subscription_marker(decoded))
}

fn contains_subscription_marker(content: &str) -> bool {
    let lowercase = content.to_ascii_lowercase();
    [
        "vless://",
        "trojan://",
        "ss://",
        "proxies:",
        "\"outbounds\"",
        "\"proxies\"",
    ]
    .iter()
    .any(|marker| lowercase.contains(marker))
}

fn parse_subscription_nodes(bytes: &[u8]) -> Result<Vec<ParsedSubscriptionNode>, String> {
    let content = decode_subscription_content(bytes)
        .ok_or_else(|| "订阅内容不是 Glide 支持的节点格式。".to_string())?;
    let mut node_ids = HashSet::new();
    let mut nodes = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && line.len() <= MAXIMUM_NODE_URI_BYTES)
        .filter_map(parse_subscription_node)
        .filter(|node| node_ids.insert(node.metadata.id.clone()))
        .take(MAXIMUM_NODE_COUNT)
        .collect::<Vec<_>>();
    disambiguate_node_names(&mut nodes);
    if nodes.is_empty() {
        Err("订阅已生成，但没有发现可单独选择的 VLESS、Trojan 或 Shadowsocks 节点。".into())
    } else {
        Ok(nodes)
    }
}

fn disambiguate_node_names(nodes: &mut [ParsedSubscriptionNode]) {
    let totals = nodes.iter().fold(HashMap::new(), |mut counts, node| {
        *counts
            .entry(node.metadata.display_name.clone())
            .or_insert(0_usize) += 1;
        counts
    });
    let mut positions = HashMap::new();
    for node in nodes {
        let total = totals
            .get(&node.metadata.display_name)
            .copied()
            .unwrap_or(1);
        if total <= 1 {
            continue;
        }
        let position = positions
            .entry(node.metadata.display_name.clone())
            .and_modify(|position| *position += 1)
            .or_insert(1);
        node.metadata.display_name = format!("{} · {position}/{total}", node.metadata.display_name);
    }
}

fn sanitize_node_display_name(name: &str, fallback: &str) -> String {
    let mut sanitized = String::new();
    let mut previous_was_space = false;
    for character in name.trim().chars() {
        if is_invisible_node_name_character(character) {
            continue;
        }
        if character.is_whitespace() {
            if !sanitized.is_empty() && !previous_was_space {
                sanitized.push(' ');
            }
            previous_was_space = true;
            continue;
        }
        sanitized.push(character);
        previous_was_space = false;
    }

    let sanitized = sanitized
        .trim()
        .chars()
        .take(MAXIMUM_NODE_NAME_CHARS)
        .collect::<String>();
    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn is_invisible_node_name_character(character: char) -> bool {
    matches!(
        character,
        '\u{00AD}'
            | '\u{034F}'
            | '\u{061C}'
            | '\u{180E}'
            | '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'..='\u{206F}'
            | '\u{FE00}'..='\u{FE0F}'
            | '\u{FEFF}'
            | '\u{E0100}'..='\u{E01EF}'
    )
}

fn parse_subscription_node(uri: &str) -> Option<ParsedSubscriptionNode> {
    let parsed = Url::parse(uri).ok()?;
    let protocol = match parsed.scheme().to_ascii_lowercase().as_str() {
        "ss" => "Shadowsocks",
        "trojan" => "Trojan",
        "vless" => "VLESS",
        _ => return None,
    };
    let fallback_name = format!("{protocol} 节点");
    let decoded_name = parsed
        .fragment()
        .map(|fragment| {
            percent_decode_str(fragment)
                .decode_utf8_lossy()
                .into_owned()
        })
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| fallback_name.clone());
    let display_name = sanitize_node_display_name(&decoded_name, &fallback_name);
    let metadata = SubscriptionNode {
        id: fingerprint(uri),
        latency_ms: None,
        latency_status: "unavailable",
        protocol: protocol.into(),
        region: infer_node_region(&display_name).into(),
        display_name,
    };
    Some(ParsedSubscriptionNode {
        metadata,
        uri: uri.to_string(),
    })
}

fn infer_node_region(display_name: &str) -> &'static str {
    let lowercase = display_name.to_lowercase();
    let tokens = lowercase
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .collect::<HashSet<_>>();
    if display_name.contains("🇭🇰")
        || display_name.contains("香港")
        || lowercase.contains("hong kong")
        || tokens.contains("hk")
    {
        "HK"
    } else if display_name.contains("🇯🇵")
        || display_name.contains("日本")
        || lowercase.contains("japan")
        || tokens.contains("jp")
    {
        "JP"
    } else if display_name.contains("🇸🇬")
        || display_name.contains("新加坡")
        || display_name.contains("狮城")
        || lowercase.contains("singapore")
        || tokens.contains("sg")
    {
        "SG"
    } else if display_name.contains("🇹🇼")
        || display_name.contains("台湾")
        || display_name.contains("台灣")
        || lowercase.contains("taiwan")
        || tokens.contains("tw")
    {
        "TW"
    } else if display_name.contains("🇺🇸")
        || display_name.contains("美国")
        || display_name.contains("美國")
        || lowercase.contains("united states")
        || tokens.contains("us")
        || tokens.contains("usa")
    {
        "US"
    } else {
        "UNKNOWN"
    }
}

fn validate_node_id(node_id: &str) -> Result<(), String> {
    if node_id.len() == 12
        && node_id
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        Ok(())
    } else {
        Err("节点标识无效，请重新选择。".into())
    }
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

fn subscription_url_from_config(admin_url: &Url, config: &Value) -> Result<Url, String> {
    let token = config
        .get("优选订阅生成")
        .and_then(Value::as_object)
        .and_then(|value| value.get("TOKEN"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= MAXIMUM_SUBSCRIPTION_TOKEN_BYTES)
        .ok_or_else(|| "管理配置尚未生成可用订阅，请先在原后台开启订阅。".to_string())?;
    let mut subscription_url = admin_url
        .join("/sub")
        .map_err(|_| "无法生成订阅地址。".to_string())?;
    subscription_url
        .query_pairs_mut()
        .clear()
        .append_pair("target", "mixed")
        .append_pair("token", token);
    Ok(subscription_url)
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
    use std::time::Duration;

    use base64::{engine::general_purpose, Engine as _};
    use reqwest::header::{HeaderMap, HeaderValue, SET_COOKIE};
    use serde_json::json;

    use super::{
        classify_node_latency, infer_node_region, inspection_from_config, looks_like_subscription,
        node_probe_target, parse_subscription_nodes, subscription_url_from_config,
        validate_node_id, NodeLatency, MAXIMUM_CONFIG_BYTES,
    };
    use url::Url;

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
    fn rejects_implausibly_fast_node_latency_from_local_proxy_interception() {
        assert_eq!(
            classify_node_latency(Duration::from_millis(1)),
            NodeLatency::Unavailable
        );
        assert_eq!(
            classify_node_latency(Duration::from_millis(15)),
            NodeLatency::Reachable(15)
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

    #[test]
    fn builds_encoded_subscription_url_from_supported_config() {
        let admin_url = Url::parse("https://edge.example.com/admin").unwrap();
        let config = json!({
            "优选订阅生成": {
                "TOKEN": "private token"
            }
        });

        let subscription_url = subscription_url_from_config(&admin_url, &config).unwrap();

        assert_eq!(subscription_url.path(), "/sub");
        assert_eq!(
            subscription_url.query_pairs().collect::<Vec<_>>(),
            vec![
                ("target".into(), "mixed".into()),
                ("token".into(), "private token".into())
            ]
        );
    }

    #[test]
    fn rejects_missing_subscription_token() {
        let admin_url = Url::parse("https://edge.example.com/admin").unwrap();

        assert!(subscription_url_from_config(&admin_url, &json!({})).is_err());
    }

    #[test]
    fn accepts_supported_subscription_shapes() {
        assert!(looks_like_subscription(
            b"vless://00000000-0000-4000-8000-000000000000@example.com:443"
        ));
        assert!(looks_like_subscription(
            b"dmxlc3M6Ly8wMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDA="
        ));
        assert!(looks_like_subscription(
            b"proxies:\n  - name: example\n    type: vless"
        ));
    }

    #[test]
    fn rejects_disguised_html_and_error_text() {
        assert!(!looks_like_subscription(
            b"<!doctype html><html><body>Not found</body></html>"
        ));
        assert!(!looks_like_subscription(b"invalid token supplied"));
        assert!(!looks_like_subscription(
            b"VGhpcyBpcyBhIHZhbGlkIEJhc2U2NCBzdHJpbmcsIGJ1dCBub3QgYSBzdWJzY3JpcHRpb24u"
        ));
    }

    #[test]
    fn rejects_subscription_shapes_without_selectable_nodes() {
        let yaml_without_supported_uris =
            b"proxies:\n  - name: placeholder\n    type: unsupported\n";

        assert!(looks_like_subscription(yaml_without_supported_uris));
        assert!(parse_subscription_nodes(yaml_without_supported_uris).is_err());
    }

    #[test]
    fn discovers_nodes_without_returning_their_private_uris_in_metadata() {
        let content = concat!(
            "vless://00000000-0000-4000-8000-000000000000@example.com:443",
            "?security=tls&type=ws#%F0%9F%87%AF%F0%9F%87%B5%20%E6%97%A5%E6%9C%AC%2001\n",
            "trojan://private-password@example.net:443?security=tls#Singapore%2002\n"
        );

        let nodes = parse_subscription_nodes(content.as_bytes()).unwrap();
        let serialized = serde_json::to_string(
            &nodes
                .iter()
                .map(|node| node.metadata.clone())
                .collect::<Vec<_>>(),
        )
        .unwrap();

        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0].metadata.display_name, "🇯🇵 日本 01");
        assert_eq!(nodes[0].metadata.region, "JP");
        assert_eq!(nodes[1].metadata.region, "SG");
        assert!(!serialized.contains("00000000"));
        assert!(!serialized.contains("private-password"));
        assert!(!serialized.contains("example.com"));
    }

    #[test]
    fn decodes_base64_subscriptions_before_discovering_nodes() {
        let encoded = general_purpose::STANDARD
            .encode(b"vless://00000000-0000-4000-8000-000000000000@example.com:443#Hong%20Kong");

        let nodes = parse_subscription_nodes(encoded.as_bytes()).unwrap();

        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].metadata.region, "HK");
    }

    #[test]
    fn reports_only_regions_supported_by_the_interface() {
        assert_eq!(infer_node_region("🇭🇰 香港 01"), "HK");
        assert_eq!(infer_node_region("JP Tokyo"), "JP");
        assert_eq!(infer_node_region("Singapore Premium"), "SG");
        assert_eq!(infer_node_region("台灣 TW"), "TW");
        assert_eq!(infer_node_region("United States West"), "US");
        assert_eq!(infer_node_region("CF 官方优选"), "UNKNOWN");
    }

    #[test]
    fn numbers_duplicate_node_names_without_exposing_their_endpoints() {
        let content = concat!(
            "vless://00000000-0000-4000-8000-000000000000@one.example:443#%E6%97%A5%E6%9C%AC-CF\n",
            "vless://00000000-0000-4000-8000-000000000000@two.example:443#%E6%97%A5%E6%9C%AC-CF\n"
        );

        let nodes = parse_subscription_nodes(content.as_bytes()).unwrap();

        assert_eq!(nodes[0].metadata.display_name, "日本-CF · 1/2");
        assert_eq!(nodes[1].metadata.display_name, "日本-CF · 2/2");
        assert!(!nodes[0].metadata.display_name.contains("one.example"));
        assert!(!nodes[1].metadata.display_name.contains("two.example"));
    }

    #[test]
    fn numbers_visually_identical_names_after_removing_invisible_characters() {
        let content = concat!(
            "vless://00000000-0000-4000-8000-000000000000@one.example:443#%E6%97%A5%E6%9C%AC-CF%E2%80%8B\n",
            "vless://00000000-0000-4000-8000-000000000000@two.example:443#%E6%97%A5%E6%9C%AC-CF\n"
        );

        let nodes = parse_subscription_nodes(content.as_bytes()).unwrap();

        assert_eq!(nodes[0].metadata.display_name, "日本-CF · 1/2");
        assert_eq!(nodes[1].metadata.display_name, "日本-CF · 2/2");
    }

    #[test]
    fn rejects_untrusted_node_identifiers() {
        assert!(validate_node_id("0123456789ab").is_ok());
        assert!(validate_node_id("../private").is_err());
        assert!(validate_node_id("0123456789abcdef").is_err());
    }

    #[test]
    fn extracts_only_explicit_node_hosts_and_ports_for_latency_probes() {
        assert_eq!(
            node_probe_target(
                "vless://00000000-0000-4000-8000-000000000000@edge.example.com:443#Node",
            ),
            Some(("edge.example.com".into(), 443)),
        );
        assert!(node_probe_target("vless://id@edge.example.com#MissingPort").is_none());
        assert!(node_probe_target("not-a-node-uri").is_none());
    }
}
