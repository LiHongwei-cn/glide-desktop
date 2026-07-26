import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import type {
  AdminInspection,
  AppState,
  EndpointProbe,
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
      appVersion: "0.2.2-web",
      architecture: navigator.userAgent.includes("ARM") ? "ARM64" : "unknown",
      desktop: false,
      operatingSystem: navigator.platform || "Web",
    });
  }
  return normalizeRuntimeInfo(await invoke<RuntimeInfo>("get_runtime_info"));
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

export async function refreshAdminDeployment(
  endpoint: string,
  credentialReference: string,
): Promise<AdminInspection> {
  if (!isDesktopRuntime()) {
    throw new Error("浏览器预览不能读取系统钥匙串，请使用桌面应用刷新。");
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
