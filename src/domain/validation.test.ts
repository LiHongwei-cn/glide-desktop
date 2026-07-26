import { describe, expect, it } from "vitest";

import {
  normalizeAdminEndpoint,
  normalizeSubscriptionEndpoint,
  parseRegion,
  redactEndpoint,
} from "@/domain/validation";

describe("normalizeAdminEndpoint", () => {
  it("adds the admin path and strips query data", () => {
    expect(normalizeAdminEndpoint("https://edge.example.com/?token=secret").normalizedUrl).toBe(
      "https://edge.example.com/admin",
    );
  });

  it("rejects insecure endpoints", () => {
    expect(() => normalizeAdminEndpoint("http://edge.example.com/admin")).toThrow(
      "管理后台必须使用 HTTPS",
    );
  });

  it("rejects local endpoints and empty values", () => {
    expect(() => normalizeAdminEndpoint("")).toThrow("请输入管理后台地址");
    expect(() => normalizeAdminEndpoint("https://localhost/admin")).toThrow(
      "不能使用本机地址",
    );
  });
});

describe("redactEndpoint", () => {
  it("does not reveal the instance subdomain", () => {
    expect(redactEndpoint("https://private.edge.example.com/admin")).toBe("••••.example.com");
  });

  it("returns a safe label for invalid input", () => {
    expect(redactEndpoint("not a url")).toBe("无效地址");
  });
});

describe("normalizeSubscriptionEndpoint", () => {
  it("keeps the path and query token while removing fragments", () => {
    expect(
      normalizeSubscriptionEndpoint(
        "https://sub.example.com/client/token?format=clash#private",
      ).normalizedUrl,
    ).toBe("https://sub.example.com/client/token?format=clash");
  });

  it("rejects insecure, local, and authority credential URLs", () => {
    expect(() => normalizeSubscriptionEndpoint("http://example.com/sub")).toThrow(
      "必须使用 HTTPS",
    );
    expect(() => normalizeSubscriptionEndpoint("https://localhost/sub")).toThrow(
      "必须使用公开域名",
    );
    expect(() =>
      normalizeSubscriptionEndpoint("https://user:secret@example.com/sub"),
    ).toThrow("不能在主机名前");
  });
});

describe("parseRegion", () => {
  it("normalizes known codes and rejects unknown values", () => {
    expect(parseRegion("sg")).toBe("SG");
    expect(parseRegion("moon")).toBe("UNKNOWN");
  });
});
