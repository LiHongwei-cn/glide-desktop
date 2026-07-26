import { describe, expect, it } from "vitest";

import {
  computeHealthScore,
  evaluateRegionEvidence,
  filterRoutes,
  findCredentialRisks,
  getIndependentCredentialCount,
  getRegionName,
  getVerificationLabel,
  scoreEndpointProbe,
} from "@/domain/health";
import { createRouteFixtures } from "@/test/fixtures";

describe("computeHealthScore", () => {
  it("applies the documented weighted score", () => {
    expect(
      computeHealthScore({
        connectionSuccess: 1,
        jitterScore: 0.8,
        latencyScore: 0.8,
        regionConfidence: 0.6,
        sessionSurvival: 0.9,
        targetReachability: 0.9,
        throughputScore: 0.7,
      }),
    ).toBe(87);
  });

  it("clamps invalid sample values", () => {
    expect(
      computeHealthScore({
        connectionSuccess: 2,
        jitterScore: -1,
        latencyScore: 2,
        regionConfidence: -1,
        sessionSurvival: 2,
        targetReachability: 2,
        throughputScore: -1,
      }),
    ).toBe(75);
  });
});

describe("scoreEndpointProbe", () => {
  it("scores reachable low-latency endpoints highly", () => {
    expect(
      scoreEndpointProbe({
        detail: "可达",
        durationMs: 180,
        endpoint: "••••.example.com",
        status: "passed",
      }),
    ).toBe(90);
  });

  it("penalizes warnings, failures and slow responses", () => {
    expect(
      scoreEndpointProbe({
        detail: "有限通过",
        durationMs: 900,
        endpoint: "••••.example.com",
        status: "warning",
      }),
    ).toBe(35);
    expect(
      scoreEndpointProbe({
        detail: "失败",
        durationMs: 2100,
        endpoint: "••••.example.com",
        status: "failed",
      }),
    ).toBe(0);
  });
});

describe("evaluateRegionEvidence", () => {
  it("requires two independent matching sources for verification", () => {
    expect(
      evaluateRegionEvidence("JP", [
        { code: "JP", observedAt: "2026-07-26T00:00:00Z", source: "source-a" },
        { code: "JP", observedAt: "2026-07-26T00:01:00Z", source: "source-b" },
      ]),
    ).toEqual({ observedRegion: "JP", verification: "verified" });
  });

  it("reports a configured and observed region conflict", () => {
    expect(
      evaluateRegionEvidence("HK", [
        { code: "JP", observedAt: "2026-07-26T00:00:00Z", source: "source-a" },
      ]),
    ).toEqual({ observedRegion: "JP", verification: "conflict" });
  });

  it("keeps a single matching source as an estimate", () => {
    expect(
      evaluateRegionEvidence("SG", [
        { code: "SG", observedAt: "2026-07-26T00:00:00Z", source: "source-a" },
      ]),
    ).toEqual({ observedRegion: "SG", verification: "estimated" });
  });

  it("reports unknown when no usable evidence exists", () => {
    expect(evaluateRegionEvidence("US", [])).toEqual({
      observedRegion: "UNKNOWN",
      verification: "unverified",
    });
  });
});

describe("findCredentialRisks", () => {
  it("finds shared identity and path groups without exposing values", () => {
    const routes = createRouteFixtures();
    const risks = findCredentialRisks(routes);

    expect(risks).toHaveLength(2);
    expect(risks.map((risk) => risk.code)).toEqual([
      "duplicate-node-credential",
      "duplicate-node-path",
    ]);
    expect(risks.every((risk) => risk.affectedRouteIds.length === 5)).toBe(true);
  });

  it("returns no risks for independent routes", () => {
    const routes = createRouteFixtures().map((route, index) => ({
      ...route,
      credentialGroupId: `credential-${index}`,
      nodePathGroupId: `path-${index}`,
    }));

    expect(findCredentialRisks(routes)).toEqual([]);
  });
});

describe("route management helpers", () => {
  const routes = createRouteFixtures();

  it("filters verification and credential risk states", () => {
    expect(filterRoutes(routes, "all")).toHaveLength(5);
    expect(filterRoutes(routes, "verified")).toHaveLength(1);
    expect(filterRoutes(routes, "conflict")).toHaveLength(4);
    expect(filterRoutes(routes, "risk")).toHaveLength(5);
    expect(filterRoutes(routes, "unverified")).toHaveLength(0);
  });

  it("counts independent credential fault domains", () => {
    expect(getIndependentCredentialCount(routes)).toBe(1);
  });
});

describe("display labels", () => {
  it("maps region and verification codes to Chinese labels", () => {
    expect(getRegionName("HK")).toBe("香港");
    expect(getRegionName("UNKNOWN")).toBe("未知");
    expect(getVerificationLabel("verified")).toBe("已验证");
    expect(getVerificationLabel("conflict")).toBe("地区冲突");
  });
});
