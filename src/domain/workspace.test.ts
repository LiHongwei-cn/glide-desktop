import { describe, expect, it } from "vitest";

import { initialState } from "@/data/seed";
import { prepareWorkspaceState } from "@/domain/workspace";

describe("workspace migration", () => {
  it("drops obsolete local counters and telemetry preferences", () => {
    const migratedState = prepareWorkspaceState(
      {
        ...initialState,
        preferences: {
          ...initialState.preferences,
          telemetryEnabled: true,
        },
        schemaVersion: 1,
        usage: { launchCount: 99 },
      },
      initialState,
    );

    expect(migratedState.schemaVersion).toBe(4);
    expect(migratedState).not.toHaveProperty("usage");
    expect(migratedState.preferences).not.toHaveProperty("telemetryEnabled");
  });

  it("falls back safely when local state is malformed", () => {
    const preparedState = prepareWorkspaceState(
      {
        connectionGroups: [],
        preferences: null,
        recentDiagnostics: [],
      },
      initialState,
    );

    expect(preparedState.connectionGroups).toHaveLength(1);
  });

  it("keeps a valid manual node selection and clears a stale one", () => {
    const route = {
      configuredRegion: "JP" as const,
      credentialGroupId: "credential",
      credentialState: "healthy" as const,
      displayName: "日本线路",
      endpointLabel: "已隐藏",
      healthScore: 90,
      id: "route-jp",
      nodePathGroupId: "path",
      observedRegion: "JP" as const,
      preferredIpCount: 8,
      protocol: "VLESS" as const,
      regionEvidence: [],
      regionVerification: "verified" as const,
      status: "active" as const,
      transport: "WebSocket" as const,
      version: "test",
    };
    const validState = prepareWorkspaceState(
      {
        ...initialState,
        connectionGroups: [
          {
            ...initialState.connectionGroups[0],
            routes: [route],
            selectedRouteId: route.id,
            selectionMode: "manual",
          },
        ],
      },
      initialState,
    );
    const staleState = prepareWorkspaceState(
      {
        ...initialState,
        connectionGroups: [
          {
            ...initialState.connectionGroups[0],
            routes: [route],
            selectedRouteId: "missing-route",
            selectionMode: "manual",
          },
        ],
      },
      initialState,
    );

    expect(validState.connectionGroups[0]).toMatchObject({
      selectedRouteId: route.id,
      selectionMode: "manual",
    });
    expect(staleState.connectionGroups[0]).toMatchObject({
      selectedRouteId: undefined,
      selectionMode: "automatic",
    });
  });
});
