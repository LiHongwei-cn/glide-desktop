import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialState } from "@/data/seed";
import { CredentialSetupRequiredError } from "@/domain/errors";
import type { RouteOptimizationResult } from "@/domain/models";
import { useAppState } from "@/hooks/use-app-state";
import {
  getCredentialVaultStatus,
  inspectAdminDeployment,
  loadWorkspaceState,
  prepareRouteSubscriptionNode,
  prepareRouteSubscription,
  probeRouteForOptimization,
  saveWorkspaceState,
  storeSharedSecret,
} from "@/services/desktop";
import { createRouteFixtures } from "@/test/fixtures";

vi.mock("@/services/desktop", () => ({
  deleteSecret: vi.fn(),
  getCredentialVaultStatus: vi.fn(),
  inspectAdminDeployment: vi.fn(),
  loadWorkspaceState: vi.fn(),
  prepareRouteSubscriptionNode: vi.fn(),
  prepareRouteSubscription: vi.fn(),
  probeRouteForOptimization: vi.fn(),
  saveWorkspaceState: vi.fn(),
  storeSharedSecret: vi.fn(),
}));

const inspection = {
  adapter: "cmliu-edgetunnel" as const,
  authenticated: true,
  credentialFingerprint: "credential-fingerprint",
  hostCount: 1,
  nodePathFingerprint: "path-fingerprint",
  preferenceMode: "custom" as const,
  preferredEndpointCount: 8,
  protocol: "vless",
  responseTimeMs: 900,
  skipCertificateVerification: false,
  subscriptionReady: true,
  transport: "ws",
};

const subscriptionNodes = [
  {
    displayName: "🇯🇵 日本 01",
    id: "0123456789ab",
    protocol: "VLESS",
    region: "JP" as const,
  },
];

describe("useAppState route selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        addEventListener: vi.fn(),
        matches: false,
        removeEventListener: vi.fn(),
      }),
    });
    const routes = createRouteFixtures().slice(0, 2).map((route) => ({
      ...route,
      adminEndpoint: `https://${route.id}.example.com/admin`,
      credentialReference: `legacy-admin:${route.id}`,
      managementState: "connected" as const,
      subscriptionReady: true,
    }));
    vi.mocked(loadWorkspaceState).mockResolvedValue({
      ...initialState,
      connectionGroups: [
        {
          ...initialState.connectionGroups[0],
          preferredRegion: "JP",
          routes,
        },
      ],
    });
    vi.mocked(saveWorkspaceState).mockResolvedValue();
    vi.mocked(getCredentialVaultStatus).mockResolvedValue({
      missingReferenceCount: 0,
      ready: true,
    });
    vi.mocked(prepareRouteSubscription).mockResolvedValue({
      nodes: subscriptionNodes,
      responseTimeMs: 750,
      subscriptionUrl: "https://example.com/sub?token=test",
    });
    vi.mocked(prepareRouteSubscriptionNode).mockResolvedValue({
      displayName: "🇯🇵 日本 01",
      nodeUri: "vless://private-node",
      protocol: "VLESS",
      region: "JP",
      responseTimeMs: 780,
    });
    vi.mocked(probeRouteForOptimization).mockResolvedValue({
      inspection,
      subscription: {
        nodes: subscriptionNodes,
        responseTimeMs: 750,
        subscriptionUrl: "https://example.com/sub?token=test",
      },
    });
  });

  it("probes manageable routes twice and stores the stable automatic choice", async () => {
    vi.mocked(probeRouteForOptimization).mockImplementation(async (endpoint) => ({
      inspection: {
        ...inspection,
        responseTimeMs: endpoint.includes("route-jp") ? 650 : 1_200,
      },
      subscription: {
        nodes: subscriptionNodes,
        responseTimeMs: endpoint.includes("route-jp") ? 750 : 1_300,
        subscriptionUrl: "https://example.com/sub?token=test",
      },
    }));
    const { result } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    let optimizationResult: RouteOptimizationResult | undefined;
    await act(async () => {
      optimizationResult = await result.current.actions.optimizeRoutes(
        "primary-connection-group",
      );
    });

    expect(probeRouteForOptimization).toHaveBeenCalledTimes(4);
    expect(prepareRouteSubscription).not.toHaveBeenCalled();
    expect(optimizationResult).toMatchObject({
      nodes: subscriptionNodes,
      routeName: "线路 2",
      stabilityDeltaMs: 0,
      subscriptionUrl: "https://example.com/sub?token=test",
      verificationSamples: 2,
    });
    expect(result.current.state.connectionGroups[0]).toMatchObject({
      selectedRouteId: "test-route-jp",
      selectionMode: "automatic",
    });
    expect(result.current.state.connectionGroups[0].selectionReason).toContain(
      "线路 2",
    );
  });

  it("lets a manual choice override the automatic mode", async () => {
    const { result } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    act(() => {
      result.current.actions.selectRoute(
        "primary-connection-group",
        "test-route-hk",
      );
    });

    expect(result.current.state.connectionGroups[0]).toMatchObject({
      selectedRouteId: "test-route-hk",
      selectionMode: "manual",
    });
  });

  it("prepares a node only from the selected managed line", async () => {
    const { result } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    let preparedNode;
    await act(async () => {
      preparedNode =
        await result.current.actions.prepareSelectedSubscriptionNode(
          "primary-connection-group",
          "test-route-jp",
          "0123456789ab",
        );
    });

    expect(preparedNode).toMatchObject({
      displayName: "🇯🇵 日本 01",
      region: "JP",
    });
    expect(prepareRouteSubscriptionNode).toHaveBeenCalledWith(
      "https://test-route-jp.example.com/admin",
      "legacy-admin:test-route-jp",
      "0123456789ab",
    );
  });

  it("falls back to the next route when the first subscription is invalid", async () => {
    vi.mocked(probeRouteForOptimization).mockImplementation(async (endpoint) => {
      if (endpoint.includes("route-jp")) {
        throw new Error("订阅为空");
      }
      return {
        inspection: { ...inspection, responseTimeMs: 1_100 },
        subscription: {
          nodes: subscriptionNodes,
          responseTimeMs: 1_200,
          subscriptionUrl: "https://example.com/sub?token=fallback",
        },
      };
    });
    const { result } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    await act(async () => {
      await result.current.actions.optimizeRoutes("primary-connection-group");
    });

    expect(probeRouteForOptimization).toHaveBeenCalledTimes(3);
    expect(result.current.state.connectionGroups[0].selectedRouteId).toBe(
      "test-route-hk",
    );
  });

  it("prefers a two-sample route when the preferred route fails confirmation", async () => {
    const callsByEndpoint = new Map<string, number>();
    vi.mocked(probeRouteForOptimization).mockImplementation(async (endpoint) => {
      const callCount = (callsByEndpoint.get(endpoint) ?? 0) + 1;
      callsByEndpoint.set(endpoint, callCount);
      if (endpoint.includes("route-jp") && callCount === 2) {
        throw new Error("confirmation failed");
      }
      return {
        inspection: {
          ...inspection,
          responseTimeMs: endpoint.includes("route-jp") ? 500 : 800,
        },
        subscription: {
          nodes: subscriptionNodes,
          responseTimeMs: endpoint.includes("route-jp") ? 550 : 850,
          subscriptionUrl: "https://example.com/sub?token=confirmed",
        },
      };
    });
    const { result } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    let optimizationResult: RouteOptimizationResult | undefined;
    await act(async () => {
      optimizationResult = await result.current.actions.optimizeRoutes(
        "primary-connection-group",
      );
    });

    expect(optimizationResult).toMatchObject({
      routeId: "test-route-hk",
      verificationSamples: 2,
    });
    expect(result.current.state.connectionGroups[0].selectedRouteId).toBe(
      "test-route-hk",
    );
  });

  it("limits concurrent probes while confirming every small route group", async () => {
    const routes = createRouteFixtures().map((route) => ({
      ...route,
      adminEndpoint: `https://${route.id}.example.com/admin`,
      credentialReference: `legacy-admin:${route.id}`,
      managementState: "connected" as const,
      subscriptionReady: true,
    }));
    vi.mocked(loadWorkspaceState).mockResolvedValue({
      ...initialState,
      connectionGroups: [
        {
          ...initialState.connectionGroups[0],
          routes,
        },
      ],
    });
    let activeProbes = 0;
    let maximumActiveProbes = 0;
    vi.mocked(probeRouteForOptimization).mockImplementation(async () => {
      activeProbes += 1;
      maximumActiveProbes = Math.max(maximumActiveProbes, activeProbes);
      await new Promise((resolve) => window.setTimeout(resolve, 5));
      activeProbes -= 1;
      return {
        inspection,
        subscription: {
          nodes: subscriptionNodes,
          responseTimeMs: 700,
          subscriptionUrl: "https://example.com/sub?token=test",
        },
      };
    });
    const { result } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    let optimizationResult;
    await act(async () => {
      optimizationResult = await result.current.actions.optimizeRoutes(
        "primary-connection-group",
      );
    });

    expect(probeRouteForOptimization).toHaveBeenCalledTimes(10);
    expect(maximumActiveProbes).toBe(4);
    expect(optimizationResult).toMatchObject({
      availableCount: 5,
      verificationSamples: 2,
    });
  });

  it("does not report success when every real probe fails", async () => {
    vi.mocked(probeRouteForOptimization).mockRejectedValue(
      new Error("temporary failure"),
    );
    const { result } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    await expect(
      result.current.actions.optimizeRoutes("primary-connection-group"),
    ).rejects.toThrow("自动低并发重试后仍未通过");
    expect(probeRouteForOptimization).toHaveBeenCalledTimes(4);
  });

  it("automatically recovers with lower concurrency after a transient total failure", async () => {
    let attemptCount = 0;
    vi.mocked(probeRouteForOptimization).mockImplementation(async () => {
      attemptCount += 1;
      if (attemptCount <= 2) {
        throw new Error("temporary concurrency failure");
      }
      return {
        inspection,
        subscription: {
          nodes: subscriptionNodes,
          responseTimeMs: 800,
          subscriptionUrl: "https://example.com/sub?token=recovered",
        },
      };
    });
    const { result } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    let optimizationResult: RouteOptimizationResult | undefined;
    await act(async () => {
      optimizationResult = await result.current.actions.optimizeRoutes(
        "primary-connection-group",
      );
    });

    expect(probeRouteForOptimization).toHaveBeenCalledTimes(6);
    expect(optimizationResult).toMatchObject({
      availableCount: 2,
      subscriptionUrl: "https://example.com/sub?token=recovered",
    });
    expect(optimizationResult?.reason).toContain("自动低并发恢复");
  });

  it("requires one-time setup and stores one shared credential after validation", async () => {
    vi.mocked(getCredentialVaultStatus).mockResolvedValue({
      missingReferenceCount: 2,
      ready: false,
    });
    vi.mocked(inspectAdminDeployment).mockResolvedValue(inspection);
    vi.mocked(storeSharedSecret).mockResolvedValue();
    const { result } = renderHook(() => useAppState());
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    await expect(
      result.current.actions.optimizeRoutes("primary-connection-group"),
    ).rejects.toBeInstanceOf(CredentialSetupRequiredError);
    await act(async () => {
      await result.current.actions.saveSharedAdminSecret(
        "primary-connection-group",
        "local-test-password",
      );
    });

    expect(inspectAdminDeployment).toHaveBeenCalledTimes(2);
    expect(storeSharedSecret).toHaveBeenCalledWith(
      [
        "legacy-admin:test-route-hk",
        "legacy-admin:test-route-jp",
      ],
      "local-test-password",
    );
  });
});
