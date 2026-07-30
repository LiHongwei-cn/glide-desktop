import type {
  RouteCandidate,
  RouteOptimizationResult,
} from "@/domain/models";

export interface RankedRoute {
  reason: string;
  responseTimeMs: number;
  routeId: string;
  score: number;
}

export function chooseOptimizedRoute(
  routes: RouteCandidate[],
  responseTimes: Readonly<Record<string, number>>,
  failedCount = 0,
): RouteOptimizationResult {
  const rankedRoutes = rankRoutesForSelection(routes, responseTimes);
  const bestRoute = rankedRoutes[0];
  if (!bestRoute) {
    throw new Error("没有检测到可用节点。请检查管理凭据或网络后重试。");
  }
  return {
    availableCount: rankedRoutes.length,
    failedCount,
    nodes: [],
    reason: bestRoute.reason,
    routeId: bestRoute.routeId,
  };
}

export function rankRoutesForSelection(
  routes: RouteCandidate[],
  responseTimes: Readonly<Record<string, number>>,
): RankedRoute[] {
  return routes
    .filter(
      (route) =>
        Number.isFinite(responseTimes[route.id]) &&
        responseTimes[route.id] >= 0 &&
        route.subscriptionReady !== false,
    )
    .map((route) => {
      const responseTimeMs = responseTimes[route.id];
      return {
        reason: describeSelection(route, responseTimeMs),
        responseTimeMs,
        routeId: route.id,
        score: calculateSelectionScore(route, responseTimeMs),
      };
    })
    .sort(
      (routeA, routeB) =>
        routeB.score - routeA.score ||
        routeA.responseTimeMs - routeB.responseTimeMs ||
        routeA.routeId.localeCompare(routeB.routeId),
    );
}

function calculateSelectionScore(
  route: RouteCandidate,
  responseTimeMs: number,
): number {
  const score =
    route.healthScore * 0.4 +
    scoreResponseTime(responseTimeMs) * 0.45 +
    scoreCredential(route) * 0.1 +
    scoreSubscription(route) * 0.05;
  return Math.round(score);
}

function describeSelection(
  route: RouteCandidate,
  responseTimeMs: number,
): string {
  const reasons: string[] = ["本轮综合得分最高"];
  if (responseTimeMs <= 1_000) {
    reasons.push(`典型响应 ${responseTimeMs} ms`);
  } else if (responseTimeMs <= 2_500) {
    reasons.push(`典型响应 ${responseTimeMs} ms`);
  } else {
    reasons.push(`已通过验证（${responseTimeMs} ms）`);
  }

  if (route.credentialState === "at-risk") {
    reasons.push("但与其他线路共用节点身份");
  }
  return reasons.join("，");
}

function scoreCredential(route: RouteCandidate): number {
  return {
    "at-risk": 35,
    healthy: 100,
    rotating: 50,
    unverified: 65,
  }[route.credentialState];
}

function scoreResponseTime(responseTimeMs: number): number {
  if (responseTimeMs <= 500) {
    return 100;
  }
  if (responseTimeMs <= 1_000) {
    return 90;
  }
  if (responseTimeMs <= 2_000) {
    return 75;
  }
  if (responseTimeMs <= 3_000) {
    return 60;
  }
  if (responseTimeMs <= 5_000) {
    return 40;
  }
  return 20;
}

function scoreSubscription(route: RouteCandidate): number {
  if (route.subscriptionReady === true) {
    return 100;
  }
  return route.subscriptionReady === false ? 20 : 60;
}
