import type {
  CredentialRisk,
  EndpointProbe,
  HealthSample,
  RegionCode,
  RegionEvidence,
  RegionVerification,
  RouteCandidate,
} from "@/domain/models";

export type RouteFilter = "all" | "conflict" | "risk" | "unverified" | "verified";

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

export function computeHealthScore(sample: HealthSample): number {
  const score =
    0.3 * clamp(sample.connectionSuccess) +
    0.2 * clamp(sample.sessionSurvival) +
    0.15 * clamp(sample.latencyScore) +
    0.1 * clamp(sample.jitterScore) +
    0.1 * clamp(sample.throughputScore) +
    0.1 * clamp(sample.targetReachability) +
    0.05 * clamp(sample.regionConfidence);

  return Math.round(score * 100);
}

export function scoreEndpointProbe(probe: EndpointProbe): number {
  const baseScore = {
    failed: 10,
    passed: 90,
    warning: 55,
  }[probe.status === "pending" ? "warning" : probe.status];
  const latencyPenalty =
    probe.durationMs === undefined
      ? 5
      : probe.durationMs <= 300
        ? 0
        : probe.durationMs <= 800
          ? 10
          : probe.durationMs <= 2000
            ? 20
            : 30;
  return Math.max(0, baseScore - latencyPenalty);
}

export function evaluateRegionEvidence(
  configuredRegion: RegionCode,
  evidence: RegionEvidence[],
): {
  observedRegion: RegionCode;
  verification: RegionVerification;
} {
  const recentEvidence = evidence.filter((item) => item.code !== "UNKNOWN");
  if (recentEvidence.length === 0) {
    return { observedRegion: "UNKNOWN", verification: "unverified" };
  }

  const counts = recentEvidence.reduce<Map<RegionCode, number>>((result, item) => {
    result.set(item.code, (result.get(item.code) ?? 0) + 1);
    return result;
  }, new Map());
  const [observedRegion, count] = [...counts.entries()].sort(
    ([, countA], [, countB]) => countB - countA,
  )[0];
  const independentSources = new Set(
    recentEvidence.filter((item) => item.code === observedRegion).map((item) => item.source),
  ).size;

  if (observedRegion !== configuredRegion) {
    return { observedRegion, verification: "conflict" };
  }
  if (count >= 2 && independentSources >= 2) {
    return { observedRegion, verification: "verified" };
  }
  return { observedRegion, verification: "estimated" };
}

export function findCredentialRisks(routes: RouteCandidate[]): CredentialRisk[] {
  const risks: CredentialRisk[] = [];
  const credentialGroups = groupRouteIds(routes, (route) => route.credentialGroupId);
  const pathGroups = groupRouteIds(routes, (route) => route.nodePathGroupId);

  for (const routeIds of credentialGroups.values()) {
    if (routeIds.length > 1) {
      risks.push({
        affectedRouteIds: routeIds,
        code: "duplicate-node-credential",
        severity: "critical",
        title: `${routeIds.length} 条线路共用节点身份`,
      });
    }
  }

  for (const routeIds of pathGroups.values()) {
    if (routeIds.length > 1) {
      risks.push({
        affectedRouteIds: routeIds,
        code: "duplicate-node-path",
        severity: "high",
        title: `${routeIds.length} 条线路共用节点路径`,
      });
    }
  }

  return risks;
}

export function filterRoutes(
  routes: RouteCandidate[],
  filter: RouteFilter,
): RouteCandidate[] {
  if (filter === "all") {
    return routes;
  }
  if (filter === "risk") {
    return routes.filter((route) => route.credentialState === "at-risk");
  }
  if (filter === "conflict") {
    return routes.filter((route) => route.regionVerification === "conflict");
  }
  if (filter === "verified") {
    return routes.filter((route) => route.regionVerification === "verified");
  }
  return routes.filter(
    (route) =>
      route.regionVerification === "estimated" ||
      route.regionVerification === "unverified",
  );
}

export function getIndependentCredentialCount(routes: RouteCandidate[]): number {
  return new Set(routes.map((route) => route.credentialGroupId)).size;
}

export function getRegionName(code: RegionCode): string {
  const names: Record<RegionCode, string> = {
    AUTO: "自动",
    HK: "香港",
    JP: "日本",
    SG: "新加坡",
    TW: "台湾",
    UNKNOWN: "未知",
    US: "美国",
  };
  return names[code];
}

export function getVerificationLabel(verification: RegionVerification): string {
  const labels: Record<RegionVerification, string> = {
    conflict: "地区冲突",
    estimated: "估算",
    unverified: "待验证",
    verified: "已验证",
  };
  return labels[verification];
}

function groupRouteIds(
  routes: RouteCandidate[],
  getKey: (route: RouteCandidate) => string,
): Map<string, string[]> {
  return routes.reduce<Map<string, string[]>>((groups, route) => {
    const key = getKey(route);
    groups.set(key, [...(groups.get(key) ?? []), route.id]);
    return groups;
  }, new Map());
}
