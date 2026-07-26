import { describe, expect, it } from "vitest";

import { initialState } from "@/data/seed";
import {
  createLocalUsage,
  getLocalUsageSummary,
  prepareWorkspaceState,
  resetLocalUsage,
} from "@/domain/usage";

describe("local usage", () => {
  const now = new Date("2026-07-26T12:00:00.000Z");

  it("migrates an existing workspace without uploading identifiers", () => {
    const legacyState = {
      ...initialState,
      preferences: {
        ...initialState.preferences,
        telemetryEnabled: true,
      },
      schemaVersion: 1,
      usage: undefined,
    };

    const migratedState = prepareWorkspaceState(legacyState, initialState, now);

    expect(migratedState.schemaVersion).toBe(2);
    expect(migratedState.usage.launchCount).toBe(1);
    expect(migratedState.usage.activeDays).toEqual(["2026-07-26"]);
    expect(migratedState.preferences).not.toHaveProperty("telemetryEnabled");
  });

  it("keeps usage metrics local and summarizes the current profile", () => {
    const usage = {
      ...createLocalUsage(new Date("2026-07-24T12:00:00.000Z")),
      activeDays: ["2026-07-24", "2026-07-26"],
      launchCount: 4,
    };

    expect(getLocalUsageSummary(usage, now)).toEqual({
      activeDayCount: 2,
      installDayCount: 3,
      launchCount: 4,
      localProfileCount: 1,
    });
  });

  it("resets counters while retaining the current launch", () => {
    expect(resetLocalUsage(now)).toEqual({
      activeDays: ["2026-07-26"],
      firstOpenedAt: "2026-07-26T12:00:00.000Z",
      lastOpenedAt: "2026-07-26T12:00:00.000Z",
      launchCount: 1,
    });
  });

  it("falls back safely when local state is malformed", () => {
    const preparedState = prepareWorkspaceState(
      {
        connectionGroups: [],
        devices: "invalid",
        preferences: null,
        recentDiagnostics: [],
      },
      initialState,
      now,
    );

    expect(preparedState.connectionGroups).toHaveLength(1);
    expect(preparedState.usage.launchCount).toBe(1);
  });

  it("normalizes invalid local counters and supported preferences", () => {
    const preparedState = prepareWorkspaceState(
      {
        ...initialState,
        preferences: {
          diagnosticsRetentionDays: 30,
          reduceMotion: true,
          theme: "dark",
        },
        usage: {
          activeDays: ["invalid", "2026-07-26", "2026-07-26"],
          firstOpenedAt: "invalid",
          lastOpenedAt: null,
          launchCount: -1,
        },
      },
      initialState,
      now,
      false,
    );

    expect(preparedState.preferences).toEqual({
      diagnosticsRetentionDays: 30,
      reduceMotion: true,
      theme: "dark",
    });
    expect(preparedState.usage).toEqual({
      activeDays: ["2026-07-26"],
      firstOpenedAt: now.toISOString(),
      lastOpenedAt: now.toISOString(),
      launchCount: 0,
    });
  });
});
