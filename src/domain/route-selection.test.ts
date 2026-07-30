import { describe, expect, it } from "vitest";

import {
  chooseOptimizedRoute,
  rankRoutesForSelection,
} from "@/domain/route-selection";
import { createRouteFixtures } from "@/test/fixtures";

describe("route selection", () => {
  it("selects by measured quality without letting a region label bias the result", () => {
    const routes = createRouteFixtures().map((route) => ({
      ...route,
      subscriptionReady: true,
    }));

    const result = chooseOptimizedRoute(
      routes,
      {
        "test-route-hk": 300,
        "test-route-jp": 850,
        "test-route-sg": 900,
      },
      2,
    );

    expect(result).toMatchObject({
      availableCount: 3,
      failedCount: 2,
      routeId: "test-route-hk",
    });
    expect(result.reason).toContain("典型响应 300 ms");
  });

  it("uses deterministic latency and route id tie breakers", () => {
    const routes = createRouteFixtures()
      .slice(0, 2)
      .map((route) => ({
        ...route,
        configuredRegion: "UNKNOWN" as const,
        healthScore: 80,
        observedRegion: "UNKNOWN" as const,
        regionVerification: "unverified" as const,
        subscriptionReady: true,
      }));

    const rankedRoutes = rankRoutesForSelection(
      routes,
      {
        "test-route-hk": 900,
        "test-route-jp": 500,
      },
    );

    expect(rankedRoutes.map((route) => route.routeId)).toEqual([
      "test-route-jp",
      "test-route-hk",
    ]);
  });

  it("excludes unreadable and subscription-disabled routes", () => {
    const [firstRoute, secondRoute] = createRouteFixtures();
    const rankedRoutes = rankRoutesForSelection(
      [
        { ...firstRoute, subscriptionReady: false },
        { ...secondRoute, subscriptionReady: true },
      ],
      {
        [firstRoute.id]: 100,
        [secondRoute.id]: Number.NaN,
      },
    );

    expect(rankedRoutes).toEqual([]);
  });

  it("returns an actionable error when every route fails", () => {
    expect(() =>
      chooseOptimizedRoute(createRouteFixtures(), {}, 5),
    ).toThrow("没有检测到可用节点");
  });

  it("does not reward a verified label when measured inputs are otherwise equal", () => {
    const [verifiedRoute, unverifiedRoute] = createRouteFixtures().map((route) => ({
      ...route,
      healthScore: 80,
      subscriptionReady: true,
    }));
    const rankedRoutes = rankRoutesForSelection(
      [
        { ...verifiedRoute, regionVerification: "verified" },
        { ...unverifiedRoute, regionVerification: "unverified" },
      ],
      {
        [verifiedRoute.id]: 700,
        [unverifiedRoute.id]: 700,
      },
    );

    expect(rankedRoutes[0].score).toBe(rankedRoutes[1].score);
  });
});
