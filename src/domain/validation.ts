import type { RegionCode } from "@/domain/models";

export interface AdminEndpointValidation {
  hostname: string;
  normalizedUrl: string;
}

export interface SubscriptionEndpointValidation {
  hostname: string;
  normalizedUrl: string;
}

const allowedRegions = new Set<RegionCode>(["HK", "JP", "SG", "TW", "US", "UNKNOWN"]);
export const maximumAdminEndpointLength = 2048;
export const maximumDisplayNameLength = 64;
export const maximumSecretLength = 1024;
export const maximumSubscriptionEndpointLength = 4096;

export function normalizeAdminEndpoint(rawUrl: string): AdminEndpointValidation {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) {
    throw new Error("请输入管理后台地址。");
  }
  if (trimmedUrl.length > maximumAdminEndpointLength) {
    throw new Error("管理后台地址过长，请检查是否粘贴了多余内容。");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new Error("地址格式不正确，请输入完整的 HTTPS 地址。");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("管理后台必须使用 HTTPS。");
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("管理地址不能包含内嵌用户名或密码。");
  }
  if (parsedUrl.search || parsedUrl.hash) {
    throw new Error("管理地址不能包含查询参数或片段。");
  }
  if (!isPublicDomainName(parsedUrl.hostname)) {
    throw new Error("请输入公开可验证的域名，不能使用本机地址。");
  }

  const normalizedPath = parsedUrl.pathname.replace(/\/+$/, "");
  if (!normalizedPath) {
    parsedUrl.pathname = "/admin";
  } else if (!normalizedPath.endsWith("/admin")) {
    throw new Error("管理地址必须指向 /admin 页面。");
  } else {
    parsedUrl.pathname = normalizedPath;
  }

  return {
    hostname: parsedUrl.hostname,
    normalizedUrl: parsedUrl.toString().replace(/\/$/, ""),
  };
}

export function parseRegion(value: string): RegionCode {
  const normalized = value.toUpperCase() as RegionCode;
  return allowedRegions.has(normalized) ? normalized : "UNKNOWN";
}

export function normalizeDisplayName(rawName: string, fieldLabel = "名称"): string {
  const normalizedName = rawName.trim();
  if (!normalizedName) {
    throw new Error(`请输入${fieldLabel}。`);
  }
  if (normalizedName.length > maximumDisplayNameLength) {
    throw new Error(`${fieldLabel}不能超过 ${maximumDisplayNameLength} 个字符。`);
  }
  if (/[\u0000-\u001f\u007f]/.test(normalizedName)) {
    throw new Error(`${fieldLabel}不能包含控制字符。`);
  }
  return normalizedName;
}

export function validateSecretInput(secret: string, fieldLabel: string): string {
  if (!secret) {
    throw new Error(`请输入${fieldLabel}。`);
  }
  if (secret.length > maximumSecretLength) {
    throw new Error(`${fieldLabel}超过安全长度限制。`);
  }
  return secret;
}

export function normalizeSubscriptionEndpoint(
  rawUrl: string,
): SubscriptionEndpointValidation {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) {
    throw new Error("请输入订阅地址。");
  }
  if (trimmedUrl.length > maximumSubscriptionEndpointLength) {
    throw new Error("订阅地址过长，请检查是否粘贴了多余内容。");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new Error("订阅地址格式不正确，请输入完整的 HTTPS 地址。");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("订阅地址必须使用 HTTPS。");
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("订阅地址不能在主机名前包含用户名或密码。");
  }
  if (parsedUrl.hash) {
    throw new Error("订阅地址不能包含片段标识。");
  }
  if (!isPublicDomainName(parsedUrl.hostname)) {
    throw new Error("订阅地址必须使用公开域名，不能使用本机地址。");
  }

  return {
    hostname: parsedUrl.hostname,
    normalizedUrl: parsedUrl.toString(),
  };
}

export function redactEndpoint(rawUrl: string): string {
  try {
    const { hostname } = normalizeAdminEndpoint(rawUrl);
    const labels = hostname.split(".");
    if (labels.length < 3) {
      return hostname;
    }
    return `••••.${labels.slice(-2).join(".")}`;
  } catch {
    return "无效地址";
  }
}

function isPublicDomainName(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  if (
    normalizedHostname === "localhost" ||
    !normalizedHostname.includes(".") ||
    normalizedHostname.includes(":")
  ) {
    return false;
  }
  const labels = normalizedHostname.split(".");
  if (
    labels.every((label) => /^\d+$/.test(label)) ||
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        !/^[a-z0-9-]+$/.test(label),
    )
  ) {
    return false;
  }
  return true;
}
