import type { AppState, Preferences } from "@/domain/models";

const currentSchemaVersion = 4;

export function prepareWorkspaceState(
  storedState: unknown,
  fallbackState: AppState,
): AppState {
  const candidate = isWorkspaceState(storedState)
    ? storedState
    : structuredClone(fallbackState);
  return {
    connectionGroups: normalizeConnectionGroups(candidate.connectionGroups),
    preferences: normalizePreferences(candidate.preferences),
    recentDiagnostics: candidate.recentDiagnostics,
    schemaVersion: currentSchemaVersion,
  };
}

function isWorkspaceState(value: unknown): value is Partial<AppState> &
  Pick<AppState, "connectionGroups" | "preferences" | "recentDiagnostics"> {
  if (!isRecord(value) || !isRecord(value.preferences)) {
    return false;
  }
  return (
    Array.isArray(value.connectionGroups) &&
    value.connectionGroups.length > 0 &&
    Array.isArray(value.recentDiagnostics)
  );
}

function normalizeConnectionGroups(
  groups: AppState["connectionGroups"],
): AppState["connectionGroups"] {
  return groups.map((group) => {
    const selectedRouteId =
      typeof group.selectedRouteId === "string" &&
      group.routes.some((route) => route.id === group.selectedRouteId)
        ? group.selectedRouteId
        : undefined;
    return {
      ...group,
      selectedRouteId,
      selectionMode:
        group.selectionMode === "manual" && selectedRouteId
          ? "manual"
          : "automatic",
      selectionReason:
        typeof group.selectionReason === "string"
          ? group.selectionReason
          : undefined,
      selectionUpdatedAt:
        typeof group.selectionUpdatedAt === "string"
          ? group.selectionUpdatedAt
          : undefined,
    };
  });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
