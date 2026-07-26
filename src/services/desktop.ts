import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { AppState, EndpointProbe, RuntimeInfo } from "@/domain/models";
import { normalizeAdminEndpoint } from "@/domain/validation";

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
      appVersion: "0.1.0-web",
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
      endpoint,
      status: "warning",
    }));
  }
  return invoke<EndpointProbe[]>("probe_endpoints", { endpoints: normalizedEndpoints });
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
