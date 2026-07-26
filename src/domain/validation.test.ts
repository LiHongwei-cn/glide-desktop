import { describe, expect, it } from "vitest";

import {
  normalizeAdminEndpoint,
  normalizeDisplayName,
  normalizeSubscriptionEndpoint,
  parseRegion,
  redactEndpoint,
} from "@/domain/validation";

describe("normalizeAdminEndpoint", () => {
  it("adds the admin path only for a domain root", () => {
    expect(normalizeAdminEndpoint("https://edge.example.com/").normalizedUrl).toBe(
      "https://edge.example.com/admin",
    );
  });

  it("rejects insecure and ambiguous endpoints", () => {
    expect(() => normalizeAdminEndpoint("http://edge.example.com/admin")).toThrow(
      "管理后台必须使用 HTTPS",
    );
    expect(() =>
      normalizeAdminEndpoint("https://edge.example.com/?token=secret"),
    ).toThrow("不能包含查询参数");
    expect(() => normalizeAdminEndpoint("https://edge.example.com/dashboard")).toThrow(
      "必须指向 /admin",
    );
    expect(() =>
      normalizeAdminEndpoint("https://user:secret@edge.example.com/admin"),
    ).toThrow("不能包含内嵌用户名");
  });

  it("rejects local, IP literal, and empty endpoints", () => {
    expect(() => normalizeAdminEndpoint("")).toThrow("请输入管理后台地址");
    expect(() => normalizeAdminEndpoint("https://localhost/admin")).toThrow(
      "不能使用本机地址",
    );
    expect(() => normalizeAdminEndpoint("https://127.0.0.1/admin")).toThrow(
      "不能使用本机地址",
    );
  });
});

describe("normalizeDisplayName", () => {
  it("trims safe names and rejects controls or excessive length", () => {
    expect(normalizeDisplayName("  东京线路  ", "线路名称")).toBe("东京线路");
    expect(() => normalizeDisplayName("东京\n线路", "线路名称")).toThrow("控制字符");
    expect(() => normalizeDisplayName("a".repeat(65), "线路名称")).toThrow(
      "不能超过 64 个字符",
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
  it("keeps the path and query token", () => {
    expect(
      normalizeSubscriptionEndpoint(
        "https://sub.example.com/client/token?format=clash",
      ).normalizedUrl,
    ).toBe("https://sub.example.com/client/token?format=clash");
  });

  it("rejects insecure, local, fragmented, and authority credential URLs", () => {
    expect(() => normalizeSubscriptionEndpoint("http://example.com/sub")).toThrow(
      "必须使用 HTTPS",
    );
    expect(() => normalizeSubscriptionEndpoint("https://localhost/sub")).toThrow(
      "必须使用公开域名",
    );
    expect(() =>
      normalizeSubscriptionEndpoint("https://user:secret@example.com/sub"),
    ).toThrow("不能在主机名前");
    expect(() =>
      normalizeSubscriptionEndpoint("https://sub.example.com/client#private"),
    ).toThrow("不能包含片段");
  });
});

describe("parseRegion", () => {
  it("normalizes known codes and rejects unknown values", () => {
    expect(parseRegion("sg")).toBe("SG");
    expect(parseRegion("moon")).toBe("UNKNOWN");
  });
});
