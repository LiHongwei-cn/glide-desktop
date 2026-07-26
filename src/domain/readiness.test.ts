import { describe, expect, it } from "vitest";

import { initialState } from "@/data/seed";
import { getReadinessSteps } from "@/domain/readiness";
import type { RouteCandidate } from "@/domain/models";

const importedRoute: RouteCandidate = {
  adminEndpoint: "https://example.com/admin",
  configuredRegion: "JP",
  credentialGroupId: "credential-group",
  credentialState: "unverified",
  displayName: "Test route",
  endpointLabel: "example.com",
  healthScore: 0,
  id: "00000000-0000-4000-8000-000000000010",
  nodePathGroupId: "path-group",
  observedRegion: "UNKNOWN",
  preferredIpCount: 0,
  protocol: "VLESS",
  regionEvidence: [],
  regionVerification: "unverified",
  status: "verifying",
  transport: "WebSocket",
  version: "待识别",
};

describe("getReadinessSteps", () => {
  it("starts with every setup step incomplete for the redacted baseline", () => {
    const steps = getReadinessSteps(initialState);

    expect(steps.every((step) => !step.completed)).toBe(true);
  });

  it("marks each step from persisted user-owned evidence", () => {
    const state = structuredClone(initialState);
    state.connectionGroups[0].routes.push(importedRoute);
    state.devices.push({
      createdAt: new Date().toISOString(),
      credentialReference: "device-subscription:00000000-0000-4000-8000-000000000000",
      displayName: "Test device",
      id: "00000000-0000-4000-8000-000000000000",
      status: "active",
    });
    state.recentDiagnostics.push({
      checks: [],
      completedAt: new Date().toISOString(),
      id: "00000000-0000-4000-8000-000000000001",
      startedAt: new Date().toISOString(),
    });

    expect(getReadinessSteps(state).every((step) => step.completed)).toBe(true);
  });
});
