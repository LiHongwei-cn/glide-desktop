import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import type {
  AdminInspection,
  AppState,
  CloudflareAuthorization,
  CloudflareDeploymentPlan,
  CloudflareDeploymentResult,
  CloudflareOAuthConfiguration,
  CloudflareOAuthStart,
  CredentialVaultStatus,
  EndpointProbe,
  PreparedSubscriptionNode,
  PreparedSubscription,
  RouteOptimizationProbe,
  RuntimeInfo,
} from "@/domain/models";
import { normalizeAdminEndpoint, redactEndpoint } from "@/domain/validation";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const browserStorageKey = "glide.workspace.v1";
const trustedOfficialHosts = new Set([
  "dash.cloudflare.com",
  "developers.cloudflare.com",
  "github.com",
]);

export async function authorizeCloudflare(
  token: string,
): Promise<CloudflareAuthorization> {
  if (!isDesktopRuntime()) {
    throw new Error("浏览器预览不能连接 Cloudflare，请使用桌面应用完成创建。");
  }
  return invoke<CloudflareAuthorization>("authorize_cloudflare", { token });
}

export async function cancelCloudflareOAuth(flowId: string): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }
  await invoke("cancel_cloudflare_oauth", { flowId });
}

export async function completeCloudflareOAuth(
  flowId: string,
): Promise<CloudflareAuthorization> {
  if (!isDesktopRuntime()) {
    throw new Error("浏览器预览不能接收 Cloudflare 登录回调。");
  }
  return invoke<CloudflareAuthorization>("complete_cloudflare_oauth", { flowId });
}

export async function createCloudflareDeploymentPlan(
  accountId: string,
  authorizationReference: string,
  displayName: string,
): Promise<CloudflareDeploymentPlan> {
  if (!isDesktopRuntime()) {
    throw new Error("浏览器预览不能生成真实部署计划，请使用桌面应用。");
  }
  return invoke<CloudflareDeploymentPlan>("create_cloudflare_deployment_plan", {
    accountId,
    authorizationReference,
    displayName,
  });
}

export async function deployCloudflareConnection(
  accountId: string,
  authorizationReference: string,
  displayName: string,
  planHash: string,
): Promise<CloudflareDeploymentResult> {
  if (!isDesktopRuntime()) {
    throw new Error("浏览器预览不能创建云端资源，请使用桌面应用。");
  }
  return invoke<CloudflareDeploymentResult>("deploy_cloudflare_connection", {
    accountId,
    authorizationReference,
    displayName,
    planHash,
  });
}

export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function deleteSecret(reference: string): Promise<void> {
  if (!isDesktopRuntime()) {
    return;
  }
  await invoke("delete_secret", { reference });
}

export async function getRuntimeInfo(): Promise<RuntimeInfo> {
  if (!isDesktopRuntime()) {
    return normalizeRuntimeInfo({
      appVersion: "0.6.2-web",
      architecture: navigator.userAgent.includes("ARM") ? "ARM64" : "unknown",
      desktop: false,
      operatingSystem: navigator.platform || "Web",
    });
  }
  return normalizeRuntimeInfo(await invoke<RuntimeInfo>("get_runtime_info"));
}

export async function getCredentialVaultStatus(
  references: string[],
): Promise<CredentialVaultStatus> {
  if (!isDesktopRuntime()) {
    return { missingReferenceCount: references.length, ready: false };
  }
  return invoke<CredentialVaultStatus>("credential_vault_status", { references });
}

export async function getCloudflareOAuthConfiguration(
): Promise<CloudflareOAuthConfiguration> {
  if (!isDesktopRuntime()) {
    return {
      available: false,
      redirectUri: "http://127.0.0.1:49217/oauth/callback",
      setupMessage: "请在桌面应用中使用 Cloudflare 登录。",
    };
  }
  return invoke<CloudflareOAuthConfiguration>("cloudflare_oauth_configuration");
}

export async function loadWorkspaceState(): Promise<unknown | null> {
  if (!isDesktopRuntime()) {
    const payload = window.localStorage.getItem(browserStorageKey);
    return payload ? (JSON.parse(payload) as unknown) : null;
  }
  const payload = await invoke<string | null>("load_workspace_state");
  return payload ? (JSON.parse(payload) as unknown) : null;
}

export async function inspectAdminDeployment(
  endpoint: string,
  password: string,
): Promise<AdminInspection> {
  if (!isDesktopRuntime()) {
    throw new Error("浏览器预览不能登录管理后台，请使用桌面应用完成验证。");
  }
  const normalizedEndpoint = normalizeAdminEndpoint(endpoint).normalizedUrl;
  return invoke<AdminInspection>("inspect_admin_deployment", {
    endpoint: normalizedEndpoint,
    password,
  });
}

export async function openAdminEndpoint(endpoint: string): Promise<void> {
  if (!isDesktopRuntime()) {
    window.open(
      normalizeAdminEndpoint(endpoint).normalizedUrl,
      "_blank",
      "noopener,noreferrer",
    );
    return;
  }
  await invoke("open_admin_endpoint", {
    endpoint: normalizeAdminEndpoint(endpoint).normalizedUrl,
  });
}

export async function openOfficialUrl(url: string): Promise<void> {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:") {
    throw new Error("只允许打开经过验证的 HTTPS 地址。");
  }
  if (!trustedOfficialHosts.has(parsedUrl.hostname)) {
    throw new Error("该地址不在 Glide 的官方来源允许列表中。");
  }
  if (isDesktopRuntime()) {
    await openUrl(parsedUrl.toString());
    return;
  }
  window.open(parsedUrl.toString(), "_blank", "noopener,noreferrer");
}

export async function probeEndpoints(endpoints: string[]): Promise<EndpointProbe[]> {
  const normalizedEndpoints = endpoints.map(
    (endpoint) => normalizeAdminEndpoint(endpoint).normalizedUrl,
  );
  if (!isDesktopRuntime()) {
    return normalizedEndpoints.map((endpoint) => ({
      detail: "浏览器预览不能执行本机 DNS/TLS 检查，请在桌面应用中运行。",
      endpoint: redactEndpoint(endpoint),
      status: "warning",
    }));
  }
  return invoke<EndpointProbe[]>("probe_endpoints", { endpoints: normalizedEndpoints });
}

export async function prepareRouteSubscription(
  endpoint: string,
  credentialReference: string,
): Promise<PreparedSubscription> {
  if (!isDesktopRuntime()) {
    throw new Error("浏览器预览不能生成真实订阅，请使用桌面应用。");
  }
  return invoke<PreparedSubscription>("prepare_route_subscription", {
    credentialReference,
    endpoint: normalizeAdminEndpoint(endpoint).normalizedUrl,
  });
}

export async function prepareRouteSubscriptionNode(
  endpoint: string,
  credentialReference: string,
  nodeId: string,
): Promise<PreparedSubscriptionNode> {
  if (!isDesktopRuntime()) {
    throw new Error("浏览器预览不能准备真实节点，请使用桌面应用。");
  }
  return invoke<PreparedSubscriptionNode>("prepare_route_subscription_node", {
    credentialReference,
    endpoint: normalizeAdminEndpoint(endpoint).normalizedUrl,
    nodeId,
  });
}

export async function probeRouteForOptimization(
  endpoint: string,
  credentialReference: string,
): Promise<RouteOptimizationProbe> {
  if (!isDesktopRuntime()) {
    throw new Error("浏览器预览不能运行真实优化，请使用桌面应用。");
  }
  return invoke<RouteOptimizationProbe>("probe_route_for_optimization", {
    credentialReference,
    endpoint: normalizeAdminEndpoint(endpoint).normalizedUrl,
  });
}

export async function refreshAdminDeployment(
  endpoint: string,
  credentialReference: string,
): Promise<AdminInspection> {
  if (!isDesktopRuntime()) {
    throw new Error("浏览器预览不能读取本机凭据目录，请使用桌面应用刷新。");
  }
  return invoke<AdminInspection>("refresh_admin_deployment", {
    credentialReference,
    endpoint: normalizeAdminEndpoint(endpoint).normalizedUrl,
  });
}

export async function saveWorkspaceState(state: AppState): Promise<void> {
  const payload = JSON.stringify(state);
  if (!isDesktopRuntime()) {
    window.localStorage.setItem(browserStorageKey, payload);
    return;
  }
  await invoke("save_workspace_state", { payload });
}

export async function secretExists(reference: string): Promise<boolean> {
  if (!isDesktopRuntime()) {
    return false;
  }
  return invoke<boolean>("secret_exists", { reference });
}

export async function storeSecret(reference: string, secret: string): Promise<void> {
  if (!isDesktopRuntime()) {
    throw new Error("浏览器预览不会保存密码，请使用桌面应用完成导入。");
  }
  await invoke("store_secret", { reference, secret });
}

export async function storeSharedSecret(
  references: string[],
  secret: string,
): Promise<void> {
  if (!isDesktopRuntime()) {
    throw new Error("浏览器预览不会保存密码，请使用桌面应用完成设置。");
  }
  await invoke("store_shared_secret", { references, secret });
}

export async function startCloudflareOAuth(): Promise<CloudflareOAuthStart> {
  if (!isDesktopRuntime()) {
    throw new Error("浏览器预览不能启动 Cloudflare 登录。");
  }
  return invoke<CloudflareOAuthStart>("start_cloudflare_oauth");
}

export async function validateAdminEndpointOnDesktop(endpoint: string): Promise<string> {
  const normalizedEndpoint = normalizeAdminEndpoint(endpoint).normalizedUrl;
  if (!isDesktopRuntime()) {
    return normalizedEndpoint;
  }
  return invoke<string>("validate_admin_endpoint", { endpoint: normalizedEndpoint });
}

export function userFacingDesktopError(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function normalizeRuntimeInfo(runtimeInfo: RuntimeInfo): RuntimeInfo {
  const operatingSystems: Record<string, string> = {
    darwin: "macOS",
    macos: "macOS",
    win32: "Windows",
    windows: "Windows",
  };
  const architectures: Record<string, string> = {
    aarch64: "ARM64",
    arm64: "ARM64",
    x86_64: "x64",
  };
  return {
    ...runtimeInfo,
    architecture:
      architectures[runtimeInfo.architecture.toLowerCase()] ?? runtimeInfo.architecture,
    operatingSystem:
      operatingSystems[runtimeInfo.operatingSystem.toLowerCase()] ??
      runtimeInfo.operatingSystem,
  };
}
