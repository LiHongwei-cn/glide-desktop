use std::{
    collections::HashMap,
    future::Future,
    pin::Pin,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::{
    header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE},
    Client, Method, Response, StatusCode,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use url::Url;
use zeroize::{Zeroize, Zeroizing};

use crate::{
    admin::{
        inspect_with_password, prepare_subscription_with_password, AdminInspection,
        PreparedSubscription,
    },
    network::{build_pinned_client, validate_public_host},
    security::{delete_secret, read_secret, secret_exists, store_secret},
};

const API_BASE: &str = "https://api.cloudflare.com/client/v4/";
const API_RESPONSE_LIMIT: usize = 2_097_152;
const CLOUDFLARE_OAUTH_AUTHORIZATION_URL: &str = "https://dash.cloudflare.com/oauth2/auth";
const CLOUDFLARE_OAUTH_REDIRECT_URI: &str = "http://127.0.0.1:49217/oauth/callback";
const CLOUDFLARE_OAUTH_TOKEN_URL: &str = "https://dash.cloudflare.com/oauth2/token";
const DEPLOYMENT_SOURCE_COMMIT: &str = "fa5a3a6022d46fb18ed251974556fd98ac0ee2f7";
const DEPLOYMENT_SOURCE_SHA256: &str =
    "3db0ef9c55ceb1aa9706697fdb0ae7472169d308fa4317490372844afc884de1";
const DEPLOYMENT_SOURCE_URL: &str = "https://raw.githubusercontent.com/cmliu/edgetunnel/fa5a3a6022d46fb18ed251974556fd98ac0ee2f7/_worker.js";
const MAXIMUM_DEPLOYMENT_SOURCE_BYTES: usize = 409_600;
const MAXIMUM_OAUTH_CALLBACK_BYTES: usize = 8_192;
const MAXIMUM_TOKEN_BYTES: usize = 1_024;
const MULTIPART_BOUNDARY: &str = "----GlideWorkerUploadBoundary7MA4YWxkTrZu0gW";
const PENDING_AUTHORIZATION_REFERENCE: &str = "cloudflare-auth:pending";
const PENDING_OAUTH_FLOW_LIMIT: usize = 1;
const OAUTH_FLOW_TIMEOUT: Duration = Duration::from_secs(300);
const WORKER_COMPATIBILITY_DATE: &str = "2025-11-04";
const WORKER_TAG: &str = "glide-edgetunnel-v1";

static PENDING_OAUTH_FLOWS: OnceLock<Mutex<HashMap<String, PendingOAuthFlow>>> = OnceLock::new();

#[derive(Deserialize)]
struct ApiEnvelope<T> {
    #[serde(default)]
    errors: Vec<ApiError>,
    result: Option<T>,
    success: bool,
}

#[derive(Deserialize)]
struct ApiError {
    code: u64,
}

#[derive(Deserialize)]
struct ApiNamespace {
    id: String,
    title: String,
}

#[derive(Deserialize)]
struct ApiScript {
    id: String,
}

#[derive(Deserialize)]
struct ApiSubdomain {
    subdomain: String,
}

#[derive(Deserialize)]
struct ApiWorkerAnnotation {
    #[serde(rename = "workers/message")]
    message: Option<String>,
    #[serde(rename = "workers/tag")]
    tag: Option<String>,
}

#[derive(Deserialize)]
struct ApiWorkerBinding {
    name: Option<String>,
    namespace_id: Option<String>,
    #[serde(rename = "type")]
    binding_type: Option<String>,
}

#[derive(Deserialize)]
struct ApiWorkerSettings {
    annotations: Option<ApiWorkerAnnotation>,
    #[serde(default)]
    bindings: Vec<ApiWorkerBinding>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareAccount {
    id: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareAuthorization {
    accounts: Vec<CloudflareAccount>,
    credential_reference: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareOAuthConfiguration {
    available: bool,
    redirect_uri: &'static str,
    setup_message: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareOAuthStart {
    authorization_url: String,
    flow_id: String,
}

#[derive(Deserialize)]
struct CloudflareOAuthToken {
    access_token: String,
    token_type: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentAction {
    action: &'static str,
    label: &'static str,
    resource: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareDeploymentPlan {
    account_id: String,
    account_name: String,
    actions: Vec<DeploymentAction>,
    admin_credential_reference: String,
    authorization_reference: String,
    display_name: String,
    endpoint_preview: String,
    kv_title: String,
    plan_hash: String,
    script_name: String,
    source_commit: &'static str,
    source_sha256: &'static str,
    workers_subdomain: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudflareDeploymentResult {
    admin_endpoint: String,
    credential_reference: String,
    inspection: AdminInspection,
    subscription: PreparedSubscription,
}

struct PlanContext {
    account_name: String,
    admin_credential_reference: String,
    endpoint_preview: String,
    kv_exists: bool,
    kv_title: String,
    subdomain_exists: bool,
    subdomain: String,
    script_exists: bool,
    script_name: String,
}

struct CloudflareClient {
    base_url: Url,
    http: Client,
}

struct PendingOAuthFlow {
    code_verifier: Zeroizing<String>,
    created_at: Instant,
    listener: TcpListener,
    state: String,
}

#[derive(Debug)]
struct DeploymentFailure {
    message: String,
    rollback_complete: bool,
}

type VerificationFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;
type DeploymentVerifier<T> = for<'a> fn(&'a str, &'a str) -> VerificationFuture<'a, T>;

impl CloudflareClient {
    fn api_url(&self, path: &str) -> Result<Url, String> {
        self.base_url
            .join(path)
            .map_err(|_| "Cloudflare API 请求地址无效。".to_string())
    }
}

#[tauri::command]
pub fn cloudflare_oauth_configuration() -> CloudflareOAuthConfiguration {
    let available = cloudflare_oauth_settings().is_ok();
    CloudflareOAuthConfiguration {
        available,
        redirect_uri: CLOUDFLARE_OAUTH_REDIRECT_URI,
        setup_message: if available {
            "使用 Cloudflare 官方登录授权；Glide 不会读取账号密码。"
        } else {
            "当前发行包尚未配置发布者 OAuth Client，请使用高级 Token 方式或重新构建发行包。"
        },
    }
}

#[tauri::command]
pub async fn start_cloudflare_oauth() -> Result<CloudflareOAuthStart, String> {
    let (client_id, scopes) = cloudflare_oauth_settings()?;
    let listener = TcpListener::bind("127.0.0.1:49217")
        .await
        .map_err(|_| "无法启动本机授权回调；请关闭占用端口的程序后重试。".to_string())?;
    let flow_id = random_url_safe(18)?;
    let state = random_url_safe(32)?;
    let code_verifier = Zeroizing::new(random_url_safe(32)?);
    let code_challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()));
    let mut authorization_url = Url::parse(CLOUDFLARE_OAUTH_AUTHORIZATION_URL)
        .map_err(|_| "Cloudflare OAuth 地址配置无效。".to_string())?;
    authorization_url
        .query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", CLOUDFLARE_OAUTH_REDIRECT_URI)
        .append_pair("scope", scopes)
        .append_pair("state", &state)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256");

    let mut flows = pending_oauth_flows()?;
    flows.retain(|_, flow| flow.created_at.elapsed() < OAUTH_FLOW_TIMEOUT);
    if flows.len() >= PENDING_OAUTH_FLOW_LIMIT {
        return Err("已有 Cloudflare 登录正在等待，请先完成或取消。".into());
    }
    flows.insert(
        flow_id.clone(),
        PendingOAuthFlow {
            code_verifier,
            created_at: Instant::now(),
            listener,
            state,
        },
    );
    Ok(CloudflareOAuthStart {
        authorization_url: authorization_url.to_string(),
        flow_id,
    })
}

#[tauri::command]
pub async fn complete_cloudflare_oauth(flow_id: String) -> Result<CloudflareAuthorization, String> {
    validate_oauth_flow_id(&flow_id)?;
    let flow = {
        let mut flows = pending_oauth_flows()?;
        flows
            .remove(&flow_id)
            .ok_or_else(|| "Cloudflare 登录已取消或过期，请重新开始。".to_string())?
    };
    if flow.created_at.elapsed() >= OAUTH_FLOW_TIMEOUT {
        return Err("Cloudflare 登录已超过 5 分钟，请重新开始。".into());
    }

    let (mut stream, peer_address) = tokio::time::timeout(
        OAUTH_FLOW_TIMEOUT.saturating_sub(flow.created_at.elapsed()),
        flow.listener.accept(),
    )
    .await
    .map_err(|_| "Cloudflare 登录已超过 5 分钟，请重新开始。".to_string())?
    .map_err(|_| "无法接收 Cloudflare 本机授权回调。".to_string())?;
    if !peer_address.ip().is_loopback() {
        let _ = write_oauth_callback_page(&mut stream, false).await;
        return Err("授权回调不是来自本机，已拒绝。".into());
    }

    let code = match read_oauth_callback_code(&mut stream, &flow.state).await {
        Ok(code) => Zeroizing::new(code),
        Err(error) => {
            let _ = write_oauth_callback_page(&mut stream, false).await;
            return Err(error);
        }
    };
    let authorization =
        authorize_cloudflare_oauth_code(code.as_str(), flow.code_verifier.as_str()).await;
    let _ = write_oauth_callback_page(&mut stream, authorization.is_ok()).await;
    authorization
}

#[tauri::command]
pub fn cancel_cloudflare_oauth(flow_id: String) -> Result<(), String> {
    validate_oauth_flow_id(&flow_id)?;
    pending_oauth_flows()?.remove(&flow_id);
    Ok(())
}

#[tauri::command]
pub async fn authorize_cloudflare(token: String) -> Result<CloudflareAuthorization, String> {
    validate_api_token(&token)?;
    let protected_token = Zeroizing::new(token);
    authorize_cloudflare_token(protected_token.as_str()).await
}

async fn authorize_cloudflare_token(token: &str) -> Result<CloudflareAuthorization, String> {
    let client = cloudflare_client().await?;
    let mut accounts = list_accounts(&client, token).await?;
    if accounts.is_empty() {
        return Err("这个授权没有可用的 Cloudflare 账号，请检查 Token 资源范围。".into());
    }
    accounts.sort_by(|left, right| left.name.cmp(&right.name));
    let credential_reference = PENDING_AUTHORIZATION_REFERENCE.to_string();
    store_secret(credential_reference.clone(), token.to_string())?;
    Ok(CloudflareAuthorization {
        accounts,
        credential_reference,
    })
}

#[tauri::command]
pub async fn create_cloudflare_deployment_plan(
    account_id: String,
    authorization_reference: String,
    display_name: String,
) -> Result<CloudflareDeploymentPlan, String> {
    validate_account_id(&account_id)?;
    validate_authorization_reference(&authorization_reference)?;
    validate_display_name(&display_name)?;
    let token = Zeroizing::new(read_secret_async(authorization_reference.clone()).await?);
    let client = cloudflare_client().await?;
    build_plan(
        &client,
        token.as_str(),
        &account_id,
        &authorization_reference,
        &display_name,
    )
    .await
}

#[tauri::command]
pub async fn deploy_cloudflare_connection(
    account_id: String,
    authorization_reference: String,
    display_name: String,
    plan_hash: String,
) -> Result<CloudflareDeploymentResult, String> {
    validate_account_id(&account_id)?;
    validate_authorization_reference(&authorization_reference)?;
    validate_display_name(&display_name)?;
    if plan_hash.len() != 64
        || !plan_hash
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("部署计划校验值无效，请重新生成计划。".into());
    }

    let token = Zeroizing::new(read_secret_async(authorization_reference.clone()).await?);
    let client = cloudflare_client().await?;
    let plan = build_plan(
        &client,
        token.as_str(),
        &account_id,
        &authorization_reference,
        &display_name,
    )
    .await?;
    if plan.plan_hash != plan_hash {
        return Err("云端资源已变化，请重新检查部署计划后再确认。".into());
    }

    let deployment_source = if plan
        .actions
        .iter()
        .any(|action| action.label == "连接服务" && action.action == "create")
    {
        Some(download_pinned_source().await?)
    } else {
        None
    };
    let had_admin_secret = secret_exists(plan.admin_credential_reference.clone())?;
    let admin_secret = Zeroizing::new(if had_admin_secret {
        read_secret_async(plan.admin_credential_reference.clone()).await?
    } else {
        let secret = generate_secret()?;
        store_secret(plan.admin_credential_reference.clone(), secret.clone())?;
        secret
    });
    let deployment_result = run_cloudflare_deployment(
        &client,
        token.as_str(),
        &account_id,
        &plan,
        deployment_source,
        admin_secret.as_str(),
        boxed_deployment_verification,
    )
    .await;

    match deployment_result {
        Ok((inspection, subscription)) => Ok(CloudflareDeploymentResult {
            admin_endpoint: plan.endpoint_preview,
            credential_reference: plan.admin_credential_reference,
            inspection,
            subscription,
        }),
        Err(failure) => {
            if failure.rollback_complete && !had_admin_secret {
                let _ = delete_secret(plan.admin_credential_reference);
            }
            Err(failure.message)
        }
    }
}

async fn run_cloudflare_deployment<T>(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
    plan: &CloudflareDeploymentPlan,
    mut deployment_source: Option<Vec<u8>>,
    admin_secret: &str,
    verify: DeploymentVerifier<T>,
) -> Result<T, DeploymentFailure> {
    let mut created_namespace_id = None;
    let mut created_script = false;
    let mut created_subdomain = false;
    let deployment_result = async {
        match get_workers_subdomain(client, token, account_id).await? {
            Some(current_subdomain) if current_subdomain != plan.workers_subdomain => {
                return Err("Cloudflare 公共子域刚刚发生变化，请重新生成部署计划后再确认。".into());
            }
            Some(_) => {}
            None => {
                create_workers_subdomain(client, token, account_id, &plan.workers_subdomain)
                    .await?;
                created_subdomain = true;
            }
        }
        let namespace_id = match find_namespace(client, token, account_id, &plan.kv_title).await? {
            Some(namespace) => namespace.id,
            None => {
                let namespace = create_namespace(client, token, account_id, &plan.kv_title).await?;
                created_namespace_id = Some(namespace.id.clone());
                namespace.id
            }
        };

        if !script_exists(client, token, account_id, &plan.script_name).await? {
            let source = deployment_source
                .take()
                .ok_or_else(|| "部署计划与载荷状态不一致，请重新生成计划。".to_string())?;
            upload_worker(
                client,
                token,
                account_id,
                &plan.script_name,
                &namespace_id,
                source,
            )
            .await?;
            created_script = true;
            add_admin_secret(client, token, account_id, &plan.script_name, admin_secret).await?;
        }
        enable_worker_subdomain(client, token, account_id, &plan.script_name).await?;
        verify(&plan.endpoint_preview, admin_secret).await
    }
    .await;

    match deployment_result {
        Ok(result) => Ok(result),
        Err(error) => {
            let rollback_complete = rollback_new_resources(
                client,
                token,
                account_id,
                &plan.script_name,
                created_script,
                created_namespace_id.as_deref(),
            )
            .await;
            let message = if rollback_complete {
                if created_subdomain {
                    format!(
                        "{error} 本次新建 Worker 和配置存储已回滚；账号级公共子域为避免影响其他 Worker 已保留。"
                    )
                } else {
                    format!("{error} 本次新建资源已回滚。")
                }
            } else {
                format!(
                    "{error} 自动回滚未完全成功，请在 Cloudflare 控制台检查带 glide 前缀的资源。"
                )
            };
            Err(DeploymentFailure {
                message,
                rollback_complete,
            })
        }
    }
}

fn boxed_deployment_verification<'a>(
    admin_endpoint: &'a str,
    admin_secret: &'a str,
) -> VerificationFuture<'a, (AdminInspection, PreparedSubscription)> {
    Box::pin(verify_new_deployment(admin_endpoint, admin_secret))
}

async fn build_plan(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
    authorization_reference: &str,
    display_name: &str,
) -> Result<CloudflareDeploymentPlan, String> {
    let account_name = list_accounts(client, token)
        .await?
        .into_iter()
        .find(|account| account.id == account_id)
        .map(|account| account.name)
        .ok_or_else(|| "当前授权不能访问所选 Cloudflare 账号。".to_string())?;
    let suffix = fingerprint(&format!("{account_id}:{display_name}"));
    let script_name = deployment_name(display_name, &suffix);
    let kv_title = format!("{script_name}-kv");
    let admin_credential_reference = format!("managed-admin:{suffix}");
    let existing_subdomain = get_workers_subdomain(client, token, account_id).await?;
    let subdomain_exists = existing_subdomain.is_some();
    let subdomain =
        existing_subdomain.unwrap_or_else(|| format!("glide-{}", fingerprint(account_id)));
    let endpoint_preview = format!("https://{script_name}.{subdomain}.workers.dev/admin");
    let script_exists = script_exists(client, token, account_id, &script_name).await?;
    let existing_namespace = find_namespace(client, token, account_id, &kv_title).await?;
    let kv_exists = existing_namespace.is_some();
    if script_exists && existing_namespace.is_none() {
        return Err(
            "检测到同名 Worker 但缺少配套配置存储；为避免覆盖未知内容，已停止创建。".into(),
        );
    }
    if (script_exists || kv_exists) && !secret_exists(admin_credential_reference.clone())? {
        return Err("检测到同名云端资源，但本机没有对应管理凭据；为避免覆盖，已停止创建。".into());
    }
    if let (true, Some(namespace)) = (script_exists, existing_namespace.as_ref()) {
        let settings = get_worker_settings(client, token, account_id, &script_name).await?;
        validate_worker_settings(&settings, &namespace.id)?;
    }

    let context = PlanContext {
        account_name,
        admin_credential_reference,
        endpoint_preview,
        kv_exists,
        kv_title,
        subdomain,
        subdomain_exists,
        script_exists,
        script_name,
    };
    Ok(plan_from_context(
        account_id,
        authorization_reference,
        display_name,
        context,
    ))
}

fn plan_from_context(
    account_id: &str,
    authorization_reference: &str,
    display_name: &str,
    context: PlanContext,
) -> CloudflareDeploymentPlan {
    let actions = vec![
        DeploymentAction {
            action: if context.subdomain_exists {
                "reuse"
            } else {
                "create"
            },
            label: "公共子域",
            resource: redact_workers_subdomain(&context.subdomain),
        },
        DeploymentAction {
            action: if context.kv_exists { "reuse" } else { "create" },
            label: "配置存储",
            resource: context.kv_title.clone(),
        },
        DeploymentAction {
            action: if context.script_exists {
                "reuse"
            } else {
                "create"
            },
            label: "连接服务",
            resource: context.script_name.clone(),
        },
        DeploymentAction {
            action: "enable",
            label: "安全入口",
            resource: redact_workers_endpoint(&context.endpoint_preview),
        },
    ];
    let plan_hash = plan_fingerprint(account_id, &context, DEPLOYMENT_SOURCE_SHA256);
    CloudflareDeploymentPlan {
        account_id: account_id.to_string(),
        account_name: context.account_name,
        actions,
        admin_credential_reference: context.admin_credential_reference,
        authorization_reference: authorization_reference.to_string(),
        display_name: display_name.to_string(),
        endpoint_preview: context.endpoint_preview,
        kv_title: context.kv_title,
        plan_hash,
        script_name: context.script_name,
        source_commit: DEPLOYMENT_SOURCE_COMMIT,
        source_sha256: DEPLOYMENT_SOURCE_SHA256,
        workers_subdomain: context.subdomain,
    }
}

fn cloudflare_oauth_settings() -> Result<(&'static str, &'static str), String> {
    let client_id = option_env!("GLIDE_CLOUDFLARE_OAUTH_CLIENT_ID")
        .map(str::trim)
        .filter(|value| {
            (10..=256).contains(&value.len())
                && value
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
        })
        .ok_or_else(|| {
            "当前发行包尚未配置 Cloudflare OAuth Client，请展开高级方式使用 API Token。".to_string()
        })?;
    let scopes = option_env!("GLIDE_CLOUDFLARE_OAUTH_SCOPES")
        .map(str::trim)
        .filter(|value| {
            (3..=512).contains(&value.len())
                && value.chars().all(|character| {
                    character.is_ascii_alphanumeric() || " :_-.".contains(character)
                })
        })
        .ok_or_else(|| "当前发行包缺少 Cloudflare OAuth 权限范围配置。".to_string())?;
    Ok((client_id, scopes))
}

fn pending_oauth_flows(
) -> Result<std::sync::MutexGuard<'static, HashMap<String, PendingOAuthFlow>>, String> {
    PENDING_OAUTH_FLOWS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Cloudflare 登录状态暂时不可用，请重启 Glide。".into())
}

fn random_url_safe(byte_count: usize) -> Result<String, String> {
    let mut bytes = vec![0_u8; byte_count];
    getrandom::fill(&mut bytes).map_err(|_| "无法生成 OAuth 安全随机数。".to_string())?;
    let encoded = URL_SAFE_NO_PAD.encode(&bytes);
    bytes.zeroize();
    Ok(encoded)
}

fn validate_oauth_flow_id(flow_id: &str) -> Result<(), String> {
    if (20..=64).contains(&flow_id.len())
        && flow_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_".contains(character))
    {
        Ok(())
    } else {
        Err("Cloudflare 登录标识无效，请重新开始。".into())
    }
}

async fn read_oauth_callback_code(
    stream: &mut tokio::net::TcpStream,
    expected_state: &str,
) -> Result<String, String> {
    let mut request = Vec::with_capacity(2_048);
    loop {
        let mut chunk = [0_u8; 1_024];
        let read = tokio::time::timeout(Duration::from_secs(10), stream.read(&mut chunk))
            .await
            .map_err(|_| "Cloudflare 授权回调读取超时。".to_string())?
            .map_err(|_| "无法读取 Cloudflare 授权回调。".to_string())?;
        if read == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..read]);
        if request.len() > MAXIMUM_OAUTH_CALLBACK_BYTES {
            return Err("Cloudflare 授权回调超过安全大小限制。".into());
        }
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    let request = std::str::from_utf8(&request)
        .map_err(|_| "Cloudflare 授权回调不是有效文本。".to_string())?;
    let request_line = request
        .lines()
        .next()
        .ok_or_else(|| "Cloudflare 授权回调为空。".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    let version = parts.next().unwrap_or_default();
    if method != "GET" || !version.starts_with("HTTP/1.") || !target.starts_with('/') {
        return Err("Cloudflare 授权回调格式无效。".into());
    }
    parse_oauth_callback_target(target, expected_state)
}

fn parse_oauth_callback_target(target: &str, expected_state: &str) -> Result<String, String> {
    let callback_url = Url::parse(&format!("http://127.0.0.1:49217{target}"))
        .map_err(|_| "Cloudflare 授权回调地址无效。".to_string())?;
    if callback_url.path() != "/oauth/callback" {
        return Err("Cloudflare 授权回调路径无效。".into());
    }
    let mut code = None;
    let mut error = None;
    let mut state = None;
    for (key, value) in callback_url.query_pairs() {
        let destination = match key.as_ref() {
            "code" => &mut code,
            "error" => &mut error,
            "state" => &mut state,
            _ => continue,
        };
        if destination.replace(value.into_owned()).is_some() {
            return Err("Cloudflare 授权回调包含重复安全参数。".into());
        }
    }
    if state.as_deref() != Some(expected_state) {
        return Err("Cloudflare 登录状态校验失败，已阻止可能的跨站请求。".into());
    }
    if error.is_some() {
        return Err("Cloudflare 登录已取消或未授予所需权限。".into());
    }
    code.as_ref()
        .filter(|code| {
            (16..=2_048).contains(&code.len())
                && code.chars().all(|character| character.is_ascii_graphic())
        })
        .cloned()
        .ok_or_else(|| "Cloudflare 授权回调缺少有效授权码。".to_string())
}

async fn write_oauth_callback_page(
    stream: &mut tokio::net::TcpStream,
    succeeded: bool,
) -> Result<(), String> {
    let (title, message) = if succeeded {
        ("授权完成", "你可以关闭此页面并返回 Glide。")
    } else {
        ("授权未完成", "请关闭此页面，返回 Glide 后重新尝试。")
    };
    let body = format!(
        "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>{title}</title><body style=\"font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:560px;margin:12vh auto;padding:24px;color:#161618\"><h1>{title}</h1><p>{message}</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(response.as_bytes())
        .await
        .map_err(|_| "无法返回 OAuth 完成页面。".to_string())
}

async fn authorize_cloudflare_oauth_code(
    code: &str,
    code_verifier: &str,
) -> Result<CloudflareAuthorization, String> {
    let (client_id, _) = cloudflare_oauth_settings()?;
    let token_url = Url::parse(CLOUDFLARE_OAUTH_TOKEN_URL)
        .map_err(|_| "Cloudflare OAuth Token 地址配置无效。".to_string())?;
    let addresses = validate_public_host(&token_url).await?;
    let client = build_pinned_client(
        "dash.cloudflare.com",
        &addresses,
        "Glide-Cloudflare-OAuth/0.6.2",
    )?;
    let body = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("grant_type", "authorization_code")
        .append_pair("client_id", client_id)
        .append_pair("code", code)
        .append_pair("redirect_uri", CLOUDFLARE_OAUTH_REDIRECT_URI)
        .append_pair("code_verifier", code_verifier)
        .finish();
    let response = client
        .post(token_url)
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(safe_api_request_error)?;
    if !response.status().is_success() {
        return Err("Cloudflare OAuth 授权码交换失败，请重新登录。".into());
    }
    if response
        .content_length()
        .is_some_and(|length| length > API_RESPONSE_LIMIT as u64)
    {
        return Err("Cloudflare OAuth 响应超过安全大小限制。".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "无法读取 Cloudflare OAuth 响应。".to_string())?;
    if bytes.len() > API_RESPONSE_LIMIT {
        return Err("Cloudflare OAuth 响应超过安全大小限制。".into());
    }
    let token: CloudflareOAuthToken = serde_json::from_slice(&bytes)
        .map_err(|_| "Cloudflare OAuth 返回了无效数据。".to_string())?;
    if !token.token_type.eq_ignore_ascii_case("bearer") {
        return Err("Cloudflare OAuth 返回了不受支持的 Token 类型。".into());
    }
    validate_api_token(&token.access_token)?;
    let protected_token = Zeroizing::new(token.access_token);
    authorize_cloudflare_token(protected_token.as_str()).await
}

async fn cloudflare_client() -> Result<CloudflareClient, String> {
    let base_url = Url::parse(API_BASE).map_err(|_| "Cloudflare API 地址配置无效。".to_string())?;
    let addresses = validate_public_host(&base_url).await?;
    let http = build_pinned_client("api.cloudflare.com", &addresses, "Glide-Cloudflare/0.6.2")?;
    Ok(CloudflareClient { base_url, http })
}

async fn list_accounts(
    client: &CloudflareClient,
    token: &str,
) -> Result<Vec<CloudflareAccount>, String> {
    let response = api_request(client, token, Method::GET, "accounts?per_page=50", None).await?;
    read_api_result(response).await
}

async fn list_namespaces(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
) -> Result<Vec<ApiNamespace>, String> {
    let response = api_request(
        client,
        token,
        Method::GET,
        &format!("accounts/{account_id}/storage/kv/namespaces?per_page=100"),
        None,
    )
    .await?;
    read_api_result(response).await
}

async fn find_namespace(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
    title: &str,
) -> Result<Option<ApiNamespace>, String> {
    Ok(list_namespaces(client, token, account_id)
        .await?
        .into_iter()
        .find(|namespace| namespace.title == title))
}

async fn create_namespace(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
    title: &str,
) -> Result<ApiNamespace, String> {
    let response = api_request(
        client,
        token,
        Method::POST,
        &format!("accounts/{account_id}/storage/kv/namespaces"),
        Some(json!({ "title": title })),
    )
    .await?;
    read_api_result(response).await
}

async fn list_scripts(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
) -> Result<Vec<ApiScript>, String> {
    let response = api_request(
        client,
        token,
        Method::GET,
        &format!("accounts/{account_id}/workers/scripts?per_page=100"),
        None,
    )
    .await?;
    read_api_result(response).await
}

async fn script_exists(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
    script_name: &str,
) -> Result<bool, String> {
    Ok(list_scripts(client, token, account_id)
        .await?
        .iter()
        .any(|script| script.id == script_name))
}

async fn get_worker_settings(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
    script_name: &str,
) -> Result<ApiWorkerSettings, String> {
    let response = api_request(
        client,
        token,
        Method::GET,
        &format!("accounts/{account_id}/workers/scripts/{script_name}/settings"),
        None,
    )
    .await?;
    read_api_result(response).await
}

fn validate_worker_settings(
    settings: &ApiWorkerSettings,
    namespace_id: &str,
) -> Result<(), String> {
    let expected_message = format!("Glide pinned edgetunnel {DEPLOYMENT_SOURCE_COMMIT}");
    let has_expected_annotations = settings.annotations.as_ref().is_some_and(|annotations| {
        annotations.message.as_deref() == Some(expected_message.as_str())
            && annotations.tag.as_deref() == Some(WORKER_TAG)
    });
    let has_expected_binding = settings.bindings.iter().any(|binding| {
        binding.name.as_deref() == Some("KV")
            && binding.namespace_id.as_deref() == Some(namespace_id)
            && binding.binding_type.as_deref() == Some("kv_namespace")
    });

    if has_expected_annotations && has_expected_binding {
        Ok(())
    } else {
        Err(
            "检测到同名 Worker，但部署标记或配置绑定不属于当前 Glide 连接；为避免启用未知代码，已停止创建。"
                .into(),
        )
    }
}

async fn get_workers_subdomain(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
) -> Result<Option<String>, String> {
    let response = api_request(
        client,
        token,
        Method::GET,
        &format!("accounts/{account_id}/workers/subdomain"),
        None,
    )
    .await?;
    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let result: ApiSubdomain = read_api_result(response).await?;
    let valid = !result.subdomain.is_empty()
        && result.subdomain.len() <= 63
        && result
            .subdomain
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-');
    if valid {
        Ok(Some(result.subdomain))
    } else {
        Err("Cloudflare Workers 子域格式无效，已停止创建。".into())
    }
}

async fn create_workers_subdomain(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
    subdomain: &str,
) -> Result<(), String> {
    let response = api_request(
        client,
        token,
        Method::PUT,
        &format!("accounts/{account_id}/workers/subdomain"),
        Some(json!({ "subdomain": subdomain })),
    )
    .await?;
    let result: ApiSubdomain = read_api_result(response).await?;
    if result.subdomain == subdomain {
        Ok(())
    } else {
        Err("Cloudflare 返回了不同的 Workers 子域，已停止创建。".into())
    }
}

async fn upload_worker(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
    script_name: &str,
    namespace_id: &str,
    source: Vec<u8>,
) -> Result<(), String> {
    let metadata = json!({
        "annotations": {
            "workers/message": format!("Glide pinned edgetunnel {DEPLOYMENT_SOURCE_COMMIT}"),
            "workers/tag": WORKER_TAG
        },
        "bindings": [{
            "name": "KV",
            "namespace_id": namespace_id,
            "type": "kv_namespace"
        }],
        "compatibility_date": WORKER_COMPATIBILITY_DATE,
        "main_module": "worker.js"
    });
    if source
        .windows(MULTIPART_BOUNDARY.len())
        .any(|window| window == MULTIPART_BOUNDARY.as_bytes())
    {
        return Err("部署载荷与上传边界冲突，已停止创建。".into());
    }
    let mut body = Vec::with_capacity(source.len() + 1_024);
    body.extend_from_slice(
        format!(
            "--{MULTIPART_BOUNDARY}\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n{}\r\n",
            metadata
        )
        .as_bytes(),
    );
    body.extend_from_slice(
        format!(
            "--{MULTIPART_BOUNDARY}\r\nContent-Disposition: form-data; name=\"worker.js\"; filename=\"worker.js\"\r\nContent-Type: application/javascript+module\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(&source);
    body.extend_from_slice(format!("\r\n--{MULTIPART_BOUNDARY}--\r\n").as_bytes());
    let url = client.api_url(&format!(
        "accounts/{account_id}/workers/scripts/{script_name}"
    ))?;
    let response = client
        .http
        .put(url)
        .header(AUTHORIZATION, bearer_header(token)?)
        .header(
            CONTENT_TYPE,
            format!("multipart/form-data; boundary={MULTIPART_BOUNDARY}"),
        )
        .body(body)
        .send()
        .await
        .map_err(safe_api_request_error)?;
    read_api_success(response).await
}

async fn add_admin_secret(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
    script_name: &str,
    admin_secret: &str,
) -> Result<(), String> {
    let response = api_request(
        client,
        token,
        Method::PUT,
        &format!("accounts/{account_id}/workers/scripts/{script_name}/secrets"),
        Some(json!({
            "name": "ADMIN",
            "text": admin_secret,
            "type": "secret_text"
        })),
    )
    .await?;
    read_api_success(response).await
}

async fn enable_worker_subdomain(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
    script_name: &str,
) -> Result<(), String> {
    let response = api_request(
        client,
        token,
        Method::POST,
        &format!("accounts/{account_id}/workers/scripts/{script_name}/subdomain"),
        Some(json!({
            "enabled": true,
            "previews_enabled": false
        })),
    )
    .await?;
    read_api_success(response).await
}

async fn delete_worker(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
    script_name: &str,
) -> Result<(), String> {
    let response = api_request(
        client,
        token,
        Method::DELETE,
        &format!("accounts/{account_id}/workers/scripts/{script_name}"),
        None,
    )
    .await?;
    read_api_success(response).await
}

async fn delete_namespace(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
    namespace_id: &str,
) -> Result<(), String> {
    let response = api_request(
        client,
        token,
        Method::DELETE,
        &format!("accounts/{account_id}/storage/kv/namespaces/{namespace_id}"),
        None,
    )
    .await?;
    read_api_success(response).await
}

async fn rollback_new_resources(
    client: &CloudflareClient,
    token: &str,
    account_id: &str,
    script_name: &str,
    created_script: bool,
    created_namespace_id: Option<&str>,
) -> bool {
    let script_rollback = if created_script {
        delete_worker(client, token, account_id, script_name)
            .await
            .is_ok()
    } else {
        true
    };
    let namespace_rollback = if let Some(namespace_id) = created_namespace_id {
        delete_namespace(client, token, account_id, namespace_id)
            .await
            .is_ok()
    } else {
        true
    };
    script_rollback && namespace_rollback
}

async fn verify_new_deployment(
    admin_endpoint: &str,
    admin_secret: &str,
) -> Result<(AdminInspection, PreparedSubscription), String> {
    let mut last_error = "新连接尚未就绪。".to_string();
    for attempt in 0..6 {
        let verification = tokio::time::timeout(
            Duration::from_secs(8),
            inspect_with_password(admin_endpoint, admin_secret),
        )
        .await;
        match verification {
            Ok(Ok(inspection)) => {
                let subscription =
                    prepare_subscription_with_password(admin_endpoint, admin_secret).await?;
                return Ok((inspection, subscription));
            }
            Ok(Err(error)) => last_error = error,
            Err(_) => last_error = "新连接验证超时。".into(),
        }
        if attempt < 5 {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }
    Err(format!("{last_error} Cloudflare 部署后验证未通过。"))
}

async fn download_pinned_source() -> Result<Vec<u8>, String> {
    let source_url =
        Url::parse(DEPLOYMENT_SOURCE_URL).map_err(|_| "部署载荷地址无效。".to_string())?;
    let addresses = validate_public_host(&source_url).await?;
    let client = build_pinned_client(
        "raw.githubusercontent.com",
        &addresses,
        "Glide-Deployment-Source/0.6.2",
    )?;
    let response = client
        .get(source_url)
        .header(ACCEPT, "application/javascript, text/plain")
        .send()
        .await
        .map_err(|_| "无法下载锁定的上游部署载荷。".to_string())?;
    if !response.status().is_success() {
        return Err("锁定的上游部署载荷暂时不可用。".into());
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAXIMUM_DEPLOYMENT_SOURCE_BYTES as u64)
    {
        return Err("部署载荷超过安全大小限制。".into());
    }
    let source = response
        .bytes()
        .await
        .map_err(|_| "无法读取部署载荷。".to_string())?
        .to_vec();
    if source.is_empty() || source.len() > MAXIMUM_DEPLOYMENT_SOURCE_BYTES {
        return Err("部署载荷为空或超过安全大小限制。".into());
    }
    let digest = Sha256::digest(&source);
    if hex_digest(&digest) != DEPLOYMENT_SOURCE_SHA256 {
        return Err("部署载荷完整性校验失败，已停止创建。".into());
    }
    Ok(source)
}

async fn api_request(
    client: &CloudflareClient,
    token: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Response, String> {
    let mut request = client
        .http
        .request(method, client.api_url(path)?)
        .header(ACCEPT, "application/json")
        .header(AUTHORIZATION, bearer_header(token)?);
    if let Some(body) = body {
        request = request
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string());
    }
    request.send().await.map_err(safe_api_request_error)
}

async fn read_api_result<T: DeserializeOwned>(response: Response) -> Result<T, String> {
    let status = response.status();
    let envelope: ApiEnvelope<T> = read_api_envelope(response).await?;
    if status.is_success() && envelope.success {
        envelope
            .result
            .ok_or_else(|| "Cloudflare API 没有返回预期结果。".to_string())
    } else {
        Err(api_error_message(status, &envelope.errors))
    }
}

async fn read_api_success(response: Response) -> Result<(), String> {
    let status = response.status();
    let envelope: ApiEnvelope<Value> = read_api_envelope(response).await?;
    if status.is_success() && envelope.success {
        Ok(())
    } else {
        Err(api_error_message(status, &envelope.errors))
    }
}

async fn read_api_envelope<T: DeserializeOwned>(
    response: Response,
) -> Result<ApiEnvelope<T>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > API_RESPONSE_LIMIT as u64)
    {
        return Err("Cloudflare API 响应超过安全大小限制。".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "无法读取 Cloudflare API 响应。".to_string())?;
    if bytes.len() > API_RESPONSE_LIMIT {
        return Err("Cloudflare API 响应超过安全大小限制。".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Cloudflare API 返回了无效数据。".to_string())
}

fn api_error_message(status: StatusCode, errors: &[ApiError]) -> String {
    if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
        return "Cloudflare 授权无效或权限不足；只使用最小权限 API Token，不要使用全局 API Key。"
            .into();
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        return "Cloudflare 请求过于频繁，请稍后重试。".into();
    }
    let error_code = errors.first().map(|error| error.code).unwrap_or(0);
    format!(
        "Cloudflare API 请求失败（HTTP {}，错误码 {}）。",
        status.as_u16(),
        error_code
    )
}

fn bearer_header(token: &str) -> Result<String, String> {
    validate_api_token(token)?;
    Ok(format!("Bearer {token}"))
}

fn safe_api_request_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "Cloudflare API 响应超时，请检查网络后重试。".into()
    } else if error.is_connect() {
        "无法连接 Cloudflare API，请检查 DNS、证书或当前网络。".into()
    } else {
        "Cloudflare API 请求失败；原始错误已脱敏。".into()
    }
}

async fn read_secret_async(reference: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_secret(&reference))
        .await
        .map_err(|_| "无法读取 Glide 本机凭据存储。".to_string())?
}

fn validate_api_token(token: &str) -> Result<(), String> {
    let valid = (20..=MAXIMUM_TOKEN_BYTES).contains(&token.len())
        && !token.chars().any(char::is_whitespace)
        && token.chars().all(|character| character.is_ascii_graphic());
    if valid {
        Ok(())
    } else {
        Err("API Token 格式无效；不要填写邮箱密码或 Global API Key。".into())
    }
}

fn validate_account_id(account_id: &str) -> Result<(), String> {
    if account_id.len() == 32
        && account_id
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        Ok(())
    } else {
        Err("Cloudflare 账号标识格式无效。".into())
    }
}

fn validate_authorization_reference(reference: &str) -> Result<(), String> {
    if reference == PENDING_AUTHORIZATION_REFERENCE {
        Ok(())
    } else {
        Err("Cloudflare 临时授权引用无效，请重新验证 API Token。".into())
    }
}

fn validate_display_name(display_name: &str) -> Result<(), String> {
    let trimmed = display_name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 64 {
        Err("连接名称为空或超过 64 个字符。".into())
    } else {
        Ok(())
    }
}

fn deployment_name(display_name: &str, suffix: &str) -> String {
    let mut slug = display_name
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    slug = slug.trim_matches('-').chars().take(28).collect();
    if slug.is_empty() {
        slug = "connection".into();
    }
    format!("glide-{slug}-{}", &suffix[..8])
}

fn plan_fingerprint(account_id: &str, context: &PlanContext, source_sha256: &str) -> String {
    let digest = Sha256::digest(
        format!(
            "{account_id}\n{}\n{}\n{}\n{}\n{}\n{}\n{source_sha256}",
            context.script_name,
            context.kv_title,
            context.subdomain,
            context.script_exists,
            context.kv_exists,
            context.subdomain_exists,
        )
        .as_bytes(),
    );
    hex_digest(&digest)
}

fn fingerprint(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    hex_digest(&digest[..8])
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn redact_workers_endpoint(endpoint: &str) -> String {
    Url::parse(endpoint)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
        .map(|host| {
            let labels = host.split('.').collect::<Vec<_>>();
            if labels.len() >= 3 {
                format!("••••.{}", labels[labels.len() - 2..].join("."))
            } else {
                "Cloudflare Workers 地址".into()
            }
        })
        .unwrap_or_else(|| "Cloudflare Workers 地址".into())
}

fn redact_workers_subdomain(subdomain: &str) -> String {
    if subdomain.len() <= 8 {
        "••••.workers.dev".into()
    } else {
        format!("{}••••.workers.dev", &subdomain[..4])
    }
}

fn generate_secret() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "系统随机数生成失败，已停止创建。".to_string())?;
    Ok(hex_digest(&bytes))
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashSet,
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc,
        thread,
        time::Duration,
    };

    use reqwest::Client;
    use serde_json::{json, Value};
    use url::Url;

    use super::{
        build_plan, deployment_name, fingerprint, list_accounts, parse_oauth_callback_target,
        plan_fingerprint, plan_from_context, rollback_new_resources, run_cloudflare_deployment,
        validate_account_id, validate_api_token, validate_authorization_reference,
        validate_display_name, validate_oauth_flow_id, validate_worker_settings,
        ApiWorkerAnnotation, ApiWorkerBinding, ApiWorkerSettings, CloudflareClient,
        CloudflareDeploymentPlan, PlanContext, VerificationFuture, DEPLOYMENT_SOURCE_COMMIT,
        PENDING_AUTHORIZATION_REFERENCE, WORKER_TAG,
    };

    const TEST_ACCOUNT_ID: &str = "0123456789abcdef0123456789abcdef";
    const TEST_ADMIN_SECRET: &str =
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const TEST_TOKEN: &str = "private-test-token-1234567890";

    struct CapturedRequest {
        authorized: bool,
        body: Vec<u8>,
        method: String,
        path: String,
    }

    struct ScriptedResponse {
        body: String,
        status: &'static str,
    }

    #[test]
    fn creates_stable_safe_deployment_names() {
        assert_eq!(
            deployment_name("日本 线路", "0123456789abcdef"),
            "glide-connection-01234567"
        );
        assert_eq!(
            deployment_name("My Fast Route!", "0123456789abcdef"),
            "glide-my-fast-route-01234567"
        );
    }

    #[test]
    fn creates_distinct_resource_names_for_three_non_ascii_lines() {
        let names = ["第一条线路", "第二条线路", "第三条线路"];
        let deployment_names = names
            .map(|name| {
                let suffix = fingerprint(&format!("{TEST_ACCOUNT_ID}:{name}"));
                deployment_name(name, &suffix)
            })
            .into_iter()
            .collect::<HashSet<_>>();

        assert_eq!(deployment_names.len(), names.len());
        assert!(deployment_names
            .iter()
            .all(|name| name.starts_with("glide-connection-")));
    }

    #[test]
    fn validates_cloudflare_identifiers_without_accepting_credentials_as_ids() {
        assert!(validate_account_id(TEST_ACCOUNT_ID).is_ok());
        assert!(validate_account_id("../../account").is_err());
        assert!(validate_authorization_reference(PENDING_AUTHORIZATION_REFERENCE).is_ok());
        assert!(validate_authorization_reference("managed-admin:test").is_err());
        assert!(validate_api_token("token-with-at-least-twenty-characters").is_ok());
        assert!(validate_api_token("short").is_err());
        assert!(validate_api_token("token with whitespace and enough length").is_err());
        assert!(validate_display_name("私人连接").is_ok());
    }

    #[test]
    fn validates_oauth_state_and_rejects_duplicate_security_parameters() {
        let callback = "/oauth/callback?code=authorization-code-1234&state=expected-state";

        assert_eq!(
            parse_oauth_callback_target(callback, "expected-state").unwrap(),
            "authorization-code-1234"
        );
        assert!(parse_oauth_callback_target(callback, "different-state").is_err());
        assert!(parse_oauth_callback_target(
            "/oauth/callback?code=authorization-code-1234&state=a&state=b",
            "a",
        )
        .is_err());
        assert!(parse_oauth_callback_target(
            "/oauth/callback?error=access_denied&state=expected-state",
            "expected-state",
        )
        .is_err());
    }

    #[test]
    fn accepts_only_url_safe_oauth_flow_identifiers() {
        assert!(validate_oauth_flow_id("safe-oauth-flow-id-12345").is_ok());
        assert!(validate_oauth_flow_id("../unsafe-flow-identifier").is_err());
        assert!(validate_oauth_flow_id("short").is_err());
    }

    #[test]
    fn plan_fingerprint_changes_when_cloud_resources_change() {
        let context = |script_exists| PlanContext {
            account_name: "account".into(),
            admin_credential_reference: "managed-admin:test".into(),
            endpoint_preview: "https://glide-route.glide-test.workers.dev/admin".into(),
            kv_exists: false,
            kv_title: "glide-route-12345678-kv".into(),
            script_exists,
            script_name: "glide-route-12345678".into(),
            subdomain: "glide-test-account".into(),
            subdomain_exists: false,
        };
        let first = plan_fingerprint(
            "0123456789abcdef0123456789abcdef",
            &context(false),
            "source",
        );
        let second = plan_fingerprint("0123456789abcdef0123456789abcdef", &context(true), "source");

        assert_eq!(first.len(), 64);
        assert_ne!(first, second);
    }

    #[test]
    fn new_account_plan_includes_redacted_subdomain_creation() {
        let plan = plan_from_context(
            TEST_ACCOUNT_ID,
            "cloudflare-auth:test",
            "私人连接",
            PlanContext {
                account_name: "个人账号".into(),
                admin_credential_reference: "managed-admin:test".into(),
                endpoint_preview: "https://glide-private.glide-account.workers.dev/admin".into(),
                kv_exists: false,
                kv_title: "glide-private-kv".into(),
                script_exists: false,
                script_name: "glide-private".into(),
                subdomain: "glide-account".into(),
                subdomain_exists: false,
            },
        );

        assert_eq!(plan.source_commit, DEPLOYMENT_SOURCE_COMMIT);
        assert_eq!(plan.actions[0].action, "create");
        assert_eq!(plan.actions[0].label, "公共子域");
        assert!(!plan.actions[0].resource.contains("glide-account"));
        assert_eq!(plan.plan_hash.len(), 64);
    }

    #[test]
    fn accepts_only_the_expected_existing_worker_binding() {
        let namespace_id = "abcdef0123456789abcdef0123456789";
        let settings = ApiWorkerSettings {
            annotations: Some(ApiWorkerAnnotation {
                message: Some(format!(
                    "Glide pinned edgetunnel {DEPLOYMENT_SOURCE_COMMIT}"
                )),
                tag: Some(WORKER_TAG.into()),
            }),
            bindings: vec![ApiWorkerBinding {
                binding_type: Some("kv_namespace".into()),
                name: Some("KV".into()),
                namespace_id: Some(namespace_id.into()),
            }],
        };

        assert!(validate_worker_settings(&settings, namespace_id).is_ok());
        assert!(validate_worker_settings(&settings, "different-namespace").is_err());
    }

    #[test]
    fn rejects_an_existing_worker_without_glide_markers() {
        let settings = ApiWorkerSettings {
            annotations: Some(ApiWorkerAnnotation {
                message: Some("unknown deployment".into()),
                tag: Some("unknown".into()),
            }),
            bindings: Vec::new(),
        };

        assert!(validate_worker_settings(&settings, "abcdef0123456789abcdef0123456789").is_err());
    }

    #[test]
    fn deployment_plan_uses_only_read_requests_before_confirmation() {
        let (client, requests, server) = scripted_api(vec![
            json_response(json!([{ "id": TEST_ACCOUNT_ID, "name": "个人账号" }])),
            ScriptedResponse {
                body: r#"{"errors":[{"code":10090}],"result":null,"success":false}"#.into(),
                status: "404 Not Found",
            },
            json_response(json!([])),
            json_response(json!([])),
        ]);

        let plan = tauri::async_runtime::block_on(build_plan(
            &client,
            TEST_TOKEN,
            TEST_ACCOUNT_ID,
            PENDING_AUTHORIZATION_REFERENCE,
            "私人连接",
        ))
        .expect("read-only plan should be created");
        server.join().expect("scripted API server should finish");
        let captured = requests.into_iter().collect::<Vec<_>>();

        assert_eq!(captured.len(), 4);
        assert!(captured.iter().all(|request| request.method == "GET"));
        assert!(captured.iter().all(|request| request.body.is_empty()));
        assert_eq!(
            captured
                .iter()
                .map(|request| request.path.as_str())
                .collect::<Vec<_>>(),
            vec![
                "/client/v4/accounts?per_page=50",
                "/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/subdomain",
                "/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts?per_page=100",
                "/client/v4/accounts/0123456789abcdef0123456789abcdef/storage/kv/namespaces?per_page=100",
            ]
        );
        assert_eq!(plan.actions[0].action, "create");
    }

    #[test]
    fn deployment_plan_stops_on_an_incomplete_existing_worker() {
        let suffix = super::fingerprint(&format!("{TEST_ACCOUNT_ID}:私人连接"));
        let script_name = deployment_name("私人连接", &suffix);
        let (client, requests, server) = scripted_api(vec![
            json_response(json!([{ "id": TEST_ACCOUNT_ID, "name": "个人账号" }])),
            json_response(json!({ "subdomain": "existing-account" })),
            json_response(json!([{ "id": script_name }])),
            json_response(json!([])),
        ]);

        let result = tauri::async_runtime::block_on(build_plan(
            &client,
            TEST_TOKEN,
            TEST_ACCOUNT_ID,
            PENDING_AUTHORIZATION_REFERENCE,
            "私人连接",
        ));
        let error = match result {
            Ok(_) => panic!("incomplete existing resources must stop deployment"),
            Err(error) => error,
        };
        server.join().expect("scripted API server should finish");
        let captured = requests.into_iter().collect::<Vec<_>>();

        assert!(error.contains("缺少配套配置存储"));
        assert!(captured.iter().all(|request| request.method == "GET"));
    }

    #[test]
    fn full_new_deployment_uses_the_expected_cloudflare_transaction() {
        let plan = test_plan(false);
        let namespace_id = "abcdef0123456789abcdef0123456789";
        let (client, requests, server) = scripted_api(vec![
            not_found_response(10090),
            json_response(json!({ "subdomain": plan.workers_subdomain })),
            json_response(json!([])),
            json_response(json!({
                "id": namespace_id,
                "title": plan.kv_title
            })),
            json_response(json!([])),
            json_response(json!({})),
            json_response(json!({})),
            json_response(json!({})),
        ]);

        tauri::async_runtime::block_on(run_cloudflare_deployment(
            &client,
            TEST_TOKEN,
            TEST_ACCOUNT_ID,
            &plan,
            Some(b"export default { fetch() { return new Response('ok') } }".to_vec()),
            TEST_ADMIN_SECRET,
            successful_verification,
        ))
        .expect("new resources should deploy");
        server.join().expect("scripted API server should finish");
        let captured = requests.into_iter().collect::<Vec<_>>();

        assert_eq!(
            captured
                .iter()
                .map(|request| (request.method.as_str(), request.path.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (
                    "GET",
                    "/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/subdomain"
                ),
                (
                    "PUT",
                    "/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/subdomain"
                ),
                (
                    "GET",
                    "/client/v4/accounts/0123456789abcdef0123456789abcdef/storage/kv/namespaces?per_page=100"
                ),
                (
                    "POST",
                    "/client/v4/accounts/0123456789abcdef0123456789abcdef/storage/kv/namespaces"
                ),
                (
                    "GET",
                    "/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts?per_page=100"
                ),
                (
                    "PUT",
                    "/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts/glide-private-01234567"
                ),
                (
                    "PUT",
                    "/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts/glide-private-01234567/secrets"
                ),
                (
                    "POST",
                    "/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts/glide-private-01234567/subdomain"
                ),
            ]
        );
        assert!(captured.iter().all(|request| request.authorized));
        assert!(captured.iter().all(|request| !request
            .body
            .windows(TEST_TOKEN.len())
            .any(|window| window == TEST_TOKEN.as_bytes())));
    }

    #[test]
    fn deployment_verification_failure_rolls_back_only_new_scoped_resources() {
        let plan = test_plan(false);
        let namespace_id = "abcdef0123456789abcdef0123456789";
        let (client, requests, server) = scripted_api(vec![
            not_found_response(10090),
            json_response(json!({ "subdomain": plan.workers_subdomain })),
            json_response(json!([])),
            json_response(json!({
                "id": namespace_id,
                "title": plan.kv_title
            })),
            json_response(json!([])),
            json_response(json!({})),
            json_response(json!({})),
            json_response(json!({})),
            json_response(json!({})),
            json_response(json!({})),
        ]);

        let failure = tauri::async_runtime::block_on(run_cloudflare_deployment(
            &client,
            TEST_TOKEN,
            TEST_ACCOUNT_ID,
            &plan,
            Some(b"export default {}".to_vec()),
            TEST_ADMIN_SECRET,
            failed_verification,
        ))
        .expect_err("failed post-deployment verification must roll back");
        server.join().expect("scripted API server should finish");
        let captured = requests.into_iter().collect::<Vec<_>>();

        assert!(failure.rollback_complete);
        assert!(failure.message.contains("部署后验证未通过"));
        assert!(failure.message.contains("已回滚"));
        assert!(!failure.message.contains(TEST_TOKEN));
        assert_eq!(captured.len(), 10);
        assert_eq!(captured[8].method, "DELETE");
        assert!(captured[8]
            .path
            .ends_with("/workers/scripts/glide-private-01234567"));
        assert_eq!(captured[9].method, "DELETE");
        assert!(captured[9]
            .path
            .ends_with("/storage/kv/namespaces/abcdef0123456789abcdef0123456789"));
        assert!(captured
            .iter()
            .all(|request| !request.path.ends_with("/workers/subdomain")
                || request.method != "DELETE"));
    }

    #[test]
    fn repeated_deployment_reuses_owned_resources_without_overwriting_them() {
        let plan = test_plan(true);
        let namespace_id = "abcdef0123456789abcdef0123456789";
        let (client, requests, server) = scripted_api(vec![
            json_response(json!({ "subdomain": plan.workers_subdomain })),
            json_response(json!([{
                "id": namespace_id,
                "title": plan.kv_title
            }])),
            json_response(json!([{ "id": plan.script_name }])),
            json_response(json!({})),
        ]);

        tauri::async_runtime::block_on(run_cloudflare_deployment(
            &client,
            TEST_TOKEN,
            TEST_ACCOUNT_ID,
            &plan,
            None,
            TEST_ADMIN_SECRET,
            successful_verification,
        ))
        .expect("owned resources should be reused");
        server.join().expect("scripted API server should finish");
        let captured = requests.into_iter().collect::<Vec<_>>();

        assert_eq!(captured.len(), 4);
        assert_eq!(
            captured
                .iter()
                .map(|request| request.method.as_str())
                .collect::<Vec<_>>(),
            vec!["GET", "GET", "GET", "POST"]
        );
        assert!(captured
            .iter()
            .all(|request| !request.path.contains("/secrets")));
    }

    #[test]
    fn rollback_deletes_only_the_new_worker_and_namespace() {
        let (client, requests, server) =
            scripted_api(vec![json_response(json!({})), json_response(json!({}))]);

        let completed = tauri::async_runtime::block_on(rollback_new_resources(
            &client,
            TEST_TOKEN,
            TEST_ACCOUNT_ID,
            "glide-private-01234567",
            true,
            Some("abcdef0123456789abcdef0123456789"),
        ));
        server.join().expect("scripted API server should finish");
        let captured = requests.into_iter().collect::<Vec<_>>();

        assert!(completed);
        assert_eq!(captured.len(), 2);
        assert!(captured.iter().all(|request| request.method == "DELETE"));
        assert!(captured
            .iter()
            .all(|request| !request.path.ends_with("/workers/subdomain")));
    }

    #[test]
    fn cloudflare_errors_do_not_echo_remote_messages_or_tokens() {
        let (client, _requests, server) = scripted_api(vec![ScriptedResponse {
            body: r#"{"errors":[{"code":6003,"message":"private remote detail"}],"result":null,"success":false}"#.into(),
            status: "400 Bad Request",
        }]);

        let result = tauri::async_runtime::block_on(list_accounts(&client, TEST_TOKEN));
        let error = match result {
            Ok(_) => panic!("invalid authorization must fail"),
            Err(error) => error,
        };
        server.join().expect("scripted API server should finish");

        assert!(error.contains("错误码 6003"));
        assert!(!error.contains("private remote detail"));
        assert!(!error.contains(TEST_TOKEN));
    }

    fn json_response(result: Value) -> ScriptedResponse {
        ScriptedResponse {
            body: json!({
                "errors": [],
                "result": result,
                "success": true
            })
            .to_string(),
            status: "200 OK",
        }
    }

    fn not_found_response(code: u64) -> ScriptedResponse {
        ScriptedResponse {
            body: json!({
                "errors": [{ "code": code }],
                "result": Value::Null,
                "success": false
            })
            .to_string(),
            status: "404 Not Found",
        }
    }

    fn test_plan(resources_exist: bool) -> CloudflareDeploymentPlan {
        plan_from_context(
            TEST_ACCOUNT_ID,
            PENDING_AUTHORIZATION_REFERENCE,
            "private",
            PlanContext {
                account_name: "个人账号".into(),
                admin_credential_reference: "managed-admin:test".into(),
                endpoint_preview: "https://glide-private-01234567.glide-account.workers.dev/admin"
                    .into(),
                kv_exists: resources_exist,
                kv_title: "glide-private-01234567-kv".into(),
                script_exists: resources_exist,
                script_name: "glide-private-01234567".into(),
                subdomain: "glide-account".into(),
                subdomain_exists: resources_exist,
            },
        )
    }

    fn successful_verification<'a>(
        _admin_endpoint: &'a str,
        _admin_secret: &'a str,
    ) -> VerificationFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }

    fn failed_verification<'a>(
        _admin_endpoint: &'a str,
        _admin_secret: &'a str,
    ) -> VerificationFuture<'a, ()> {
        Box::pin(async { Err("部署后验证未通过。".into()) })
    }

    fn scripted_api(
        responses: Vec<ScriptedResponse>,
    ) -> (
        CloudflareClient,
        mpsc::Receiver<CapturedRequest>,
        thread::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test API should bind");
        let address = listener
            .local_addr()
            .expect("test API should have an address");
        let (sender, receiver) = mpsc::channel();
        let server = thread::spawn(move || {
            for response in responses {
                let (mut stream, _) = listener.accept().expect("test API should accept");
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .expect("test API timeout should apply");
                let mut request = Vec::new();
                let mut buffer = [0_u8; 4_096];
                let header_end = loop {
                    let read = stream.read(&mut buffer).expect("test API should read");
                    assert!(read > 0, "request ended before headers");
                    request.extend_from_slice(&buffer[..read]);
                    if let Some(position) =
                        request.windows(4).position(|window| window == b"\r\n\r\n")
                    {
                        break position + 4;
                    }
                    assert!(request.len() <= 65_536, "request headers too large");
                };
                let headers = String::from_utf8_lossy(&request[..header_end]).into_owned();
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                while request.len() < header_end + content_length {
                    let read = stream.read(&mut buffer).expect("test API should read body");
                    assert!(read > 0, "request ended before body");
                    request.extend_from_slice(&buffer[..read]);
                }
                let request_line = headers.lines().next().expect("request line should exist");
                let mut parts = request_line.split_whitespace();
                let method = parts.next().expect("request method").to_string();
                let path = parts.next().expect("request path").to_string();
                let authorized = headers.lines().any(|line| {
                    line.split_once(':').is_some_and(|(name, value)| {
                        name.eq_ignore_ascii_case("authorization")
                            && value.trim() == format!("Bearer {TEST_TOKEN}")
                    })
                });
                sender
                    .send(CapturedRequest {
                        authorized,
                        body: request[header_end..header_end + content_length].to_vec(),
                        method,
                        path,
                    })
                    .expect("request should be captured");
                write!(
                    stream,
                    "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response.status,
                    response.body.len(),
                    response.body
                )
                .expect("test API should respond");
            }
        });
        let base_url =
            Url::parse(&format!("http://{address}/client/v4/")).expect("test URL should parse");
        let http = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
            .expect("test client should build");
        (CloudflareClient { base_url, http }, receiver, server)
    }
}
