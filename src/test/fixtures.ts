import type { RegionCode, RouteCandidate } from "@/domain/models";

const configuredRegions: RegionCode[] = ["HK", "JP", "SG", "TW", "US"];
const observedAt = "2026-07-26T00:00:00.000Z";

export function createRouteFixtures(): RouteCandidate[] {
  return configuredRegions.map((region, index) => ({
    configuredRegion: region,
    credentialGroupId: "shared-credential",
    credentialState: "at-risk",
    displayName: `线路 ${index + 1}`,
    endpointLabel: "测试地址已隐藏",
    healthScore: 70 - index,
    id: `test-route-${region.toLowerCase()}`,
    nodePathGroupId: "shared-path",
    observedRegion: "JP",
    preferredIpCount: 10,
    protocol: "VLESS",
    regionEvidence: [
      { code: "JP", observedAt, source: "source-a" },
      { code: "JP", observedAt, source: "source-b" },
    ],
    regionVerification: region === "JP" ? "verified" : "conflict",
    status: "degraded",
    transport: "WebSocket",
    version: "test",
  }));
}
