import type { AppState, LocalUsageMetrics, Preferences } from "@/domain/models";

const currentSchemaVersion = 2;
const maximumTrackedDays = 365;

export interface LocalUsageSummary {
  activeDayCount: number;
  installDayCount: number;
  launchCount: number;
  localProfileCount: 1;
}

export function createLocalUsage(now = new Date()): LocalUsageMetrics {
  const timestamp = now.toISOString();
  return {
    activeDays: [],
    firstOpenedAt: timestamp,
    lastOpenedAt: timestamp,
    launchCount: 0,
  };
}

export function getLocalUsageSummary(
  usage: LocalUsageMetrics,
  now = new Date(),
): LocalUsageSummary {
  const firstOpenedAt = new Date(usage.firstOpenedAt).getTime();
  const elapsedDays = Number.isFinite(firstOpenedAt)
    ? Math.floor(Math.max(0, now.getTime() - firstOpenedAt) / 86_400_000) + 1
    : 1;
  return {
    activeDayCount: usage.activeDays.length,
    installDayCount: elapsedDays,
    launchCount: usage.launchCount,
    localProfileCount: 1,
  };
}

export function prepareWorkspaceState(
  storedState: unknown,
  fallbackState: AppState,
  now = new Date(),
  recordLaunch = true,
): AppState {
  const candidate = isWorkspaceState(storedState)
    ? storedState
    : structuredClone(fallbackState);
  const usage = normalizeUsage(candidate.usage, now);
  return {
    connectionGroups: candidate.connectionGroups,
    devices: candidate.devices,
    preferences: normalizePreferences(candidate.preferences),
    recentDiagnostics: candidate.recentDiagnostics,
    schemaVersion: currentSchemaVersion,
    usage: recordLaunch ? recordLocalLaunch(usage, now) : usage,
  };
}

export function resetLocalUsage(now = new Date()): LocalUsageMetrics {
  return recordLocalLaunch(createLocalUsage(now), now);
}

function isWorkspaceState(value: unknown): value is Partial<AppState> &
  Pick<AppState, "connectionGroups" | "devices" | "preferences" | "recentDiagnostics"> {
  if (!isRecord(value) || !isRecord(value.preferences)) {
    return false;
  }
  return (
    Array.isArray(value.connectionGroups) &&
    value.connectionGroups.length > 0 &&
    Array.isArray(value.devices) &&
    Array.isArray(value.recentDiagnostics)
  );
}

function normalizePreferences(value: unknown): Preferences {
  const preferences = isRecord(value) ? value : {};
  const retention = preferences.diagnosticsRetentionDays;
  const theme = preferences.theme;
  return {
    diagnosticsRetentionDays:
      retention === 14 || retention === 30 ? retention : 7,
    reduceMotion:
      typeof preferences.reduceMotion === "boolean"
        ? preferences.reduceMotion
        : false,
    theme: theme === "dark" || theme === "light" ? theme : "system",
  };
}

function normalizeUsage(value: unknown, now: Date): LocalUsageMetrics {
  if (!isRecord(value)) {
    return createLocalUsage(now);
  }
  const firstOpenedAt = normalizeTimestamp(value.firstOpenedAt, now);
  const lastOpenedAt = normalizeTimestamp(value.lastOpenedAt, now);
  const launchCount =
    typeof value.launchCount === "number" &&
    Number.isSafeInteger(value.launchCount) &&
    value.launchCount >= 0
      ? value.launchCount
      : 0;
  const activeDays = Array.isArray(value.activeDays)
    ? value.activeDays
        .filter(
          (day): day is string =>
            typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day),
        )
        .slice(-maximumTrackedDays)
    : [];
  return {
    activeDays: [...new Set(activeDays)],
    firstOpenedAt,
    lastOpenedAt,
    launchCount,
  };
}

function normalizeTimestamp(value: unknown, fallback: Date): string {
  if (typeof value !== "string" || !Number.isFinite(new Date(value).getTime())) {
    return fallback.toISOString();
  }
  return value;
}

function recordLocalLaunch(
  usage: LocalUsageMetrics,
  now: Date,
): LocalUsageMetrics {
  const activeDay = now.toISOString().slice(0, 10);
  const activeDays = [...new Set([...usage.activeDays, activeDay])].slice(
    -maximumTrackedDays,
  );
  return {
    ...usage,
    activeDays,
    lastOpenedAt: now.toISOString(),
    launchCount: usage.launchCount + 1,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
