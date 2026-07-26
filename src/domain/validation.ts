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

export function normalizeAdminEndpoint(rawUrl: string): AdminEndpointValidation {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) {
    throw new Error("请输入管理后台地址。");
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
  if (!parsedUrl.hostname.includes(".") || parsedUrl.hostname === "localhost") {
    throw new Error("请输入公开可验证的域名，不能使用本机地址。");
  }

  parsedUrl.hash = "";
  parsedUrl.search = "";
  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/admin";
  if (!parsedUrl.pathname.endsWith("/admin")) {
    parsedUrl.pathname = `${parsedUrl.pathname}/admin`.replace(/\/+/g, "/");
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

export function normalizeSubscriptionEndpoint(
  rawUrl: string,
): SubscriptionEndpointValidation {
  const trimmedUrl = rawUrl.trim();
  if (!trimmedUrl) {
    throw new Error("请输入订阅地址。");
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
  if (!parsedUrl.hostname.includes(".") || parsedUrl.hostname === "localhost") {
    throw new Error("订阅地址必须使用公开域名，不能使用本机地址。");
  }

  parsedUrl.hash = "";
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
