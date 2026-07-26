import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { initialState } from "@/data/seed";
import type {
  AdminInspection,
  AppState,
  ConnectionGroup,
  DeviceCredential,
  DiagnosticRun,
  Preferences,
  RegionCode,
  RouteCandidate,
  RouteCheckUpdate,
  WorkspacePersistenceStatus,
} from "@/domain/models";
import { prepareWorkspaceState, resetLocalUsage } from "@/domain/usage";
import { redactEndpoint } from "@/domain/validation";
import { deleteSecret, loadWorkspaceState, saveWorkspaceState } from "@/services/desktop";

interface AppActions {
  addDevice: (device: DeviceCredential) => void;
  addRoute: (route: RouteCandidate) => void;
  applyAdminInspection: (
    routeId: string,
    inspection: AdminInspection,
    credentialReference?: string,
    adminEndpoint?: string,
  ) => void;
  applyRouteChecks: (updates: RouteCheckUpdate[]) => void;
  appendDiagnostic: (run: DiagnosticRun) => void;
  clearDiagnostics: () => void;
  removeRoute: (routeId: string) => Promise<void>;
  resetUsage: () => void;
  revokeDevice: (deviceId: string) => Promise<void>;
  setPreferredRegion: (groupId: string, region: RegionCode) => void;
  updatePreferences: (preferences: Partial<Preferences>) => void;
}

interface AppStore {
  actions: AppActions;
  hydrated: boolean;
  persistenceStatus: WorkspacePersistenceStatus;
  state: AppState;
}

const cloneInitialState = (): AppState => structuredClone(initialState);
let launchRecordedInProcess = false;

export function useAppState(): AppStore {
  const [state, setState] = useState<AppState>(cloneInitialState);
  const [hydrated, setHydrated] = useState(false);
  const [persistenceStatus, setPersistenceStatus] =
    useState<WorkspacePersistenceStatus>("loading");
  const saveRevision = useRef(0);
  const stateReference = useRef(state);

  useEffect(() => {
    stateReference.current = state;
  }, [state]);

  useEffect(() => {
    let active = true;
    loadWorkspaceState()
      .then((storedState) => {
        if (active) {
          const nextState = prepareWorkspaceState(
            storedState,
            initialState,
            new Date(),
            !launchRecordedInProcess,
          );
          launchRecordedInProcess = true;
          setState(nextState);
          setPersistenceStatus("saved");
        }
      })
      .catch(() => {
        if (active) {
          setPersistenceStatus("error");
        }
      })
      .finally(() => {
        if (active) {
          setHydrated(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    const revision = ++saveRevision.current;
    setPersistenceStatus("saving");
    const timer = window.setTimeout(() => {
      void saveWorkspaceState(state)
        .then(() => {
          if (revision === saveRevision.current) {
            setPersistenceStatus("saved");
          }
        })
        .catch(() => {
          if (revision === saveRevision.current) {
            setPersistenceStatus("error");
          }
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [hydrated, state]);

  useEffect(() => {
    const theme = state.preferences.theme;
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (systemTheme.matches ? "dark" : "light") : theme;
    };
    applyTheme();
    document.documentElement.classList.toggle(
      "reduce-motion",
      state.preferences.reduceMotion,
    );
    systemTheme.addEventListener("change", applyTheme);
    return () => systemTheme.removeEventListener("change", applyTheme);
  }, [state.preferences.reduceMotion, state.preferences.theme]);

  const addDevice = useCallback((device: DeviceCredential) => {
    setState((currentState) => ({
      ...currentState,
      devices: [...currentState.devices, device],
    }));
  }, []);

  const addRoute = useCallback((route: RouteCandidate) => {
    setState((currentState) => ({
      ...currentState,
      connectionGroups: currentState.connectionGroups.map((group, index) =>
        index === 0
          ? summarizeConnectionGroup({
              ...group,
              routes: [...group.routes, route],
              updatedAt: new Date().toISOString(),
            })
          : group,
      ),
    }));
  }, []);

  const applyAdminInspection = useCallback(
    (
      routeId: string,
      inspection: AdminInspection,
      credentialReference?: string,
      adminEndpoint?: string,
    ) => {
      const managedAt = new Date().toISOString();
      setState((currentState) => ({
        ...currentState,
        connectionGroups: currentState.connectionGroups.map((group) =>
          summarizeConnectionGroup({
            ...group,
            routes: group.routes.map((route) =>
              route.id === routeId
                ? {
                    ...route,
                    adminAdapter: inspection.adapter,
                    adminEndpoint: adminEndpoint ?? route.adminEndpoint,
                    credentialReference:
                      credentialReference ?? route.credentialReference,
                    credentialGroupId: `node:${inspection.credentialFingerprint}`,
                    healthScore: Math.max(route.healthScore, 90),
                    endpointLabel: adminEndpoint
                      ? `${redactEndpoint(adminEndpoint)} · 已验证管理登录`
                      : route.endpointLabel,
                    lastManagedAt: managedAt,
                    managementState: "connected",
                    nodePathGroupId: `path:${inspection.nodePathFingerprint}`,
                    preferredIpCount: inspection.preferredEndpointCount,
                    status: "active",
                    subscriptionReady: inspection.subscriptionReady,
                    version: inspection.configUpdatedAt ?? "已读取",
                  }
                : route,
            ),
            updatedAt: managedAt,
          }),
        ),
      }));
    },
    [],
  );

  const applyRouteChecks = useCallback((updates: RouteCheckUpdate[]) => {
    const updatesByRouteId = new Map(
      updates.flatMap((update) =>
        update.routeIds.map((routeId) => [routeId, update] as const),
      ),
    );
    setState((currentState) => ({
      ...currentState,
      connectionGroups: currentState.connectionGroups.map((group) =>
        summarizeConnectionGroup({
          ...group,
          routes: group.routes.map((route) => {
            const update = updatesByRouteId.get(route.id);
            return update
              ? {
                  ...route,
                  healthScore: update.healthScore,
                  lastCheckedAt: update.checkedAt,
                  status: update.status,
                }
              : route;
          }),
          updatedAt: new Date().toISOString(),
        }),
      ),
    }));
  }, []);

  const appendDiagnostic = useCallback((run: DiagnosticRun) => {
    setState((currentState) => ({
      ...currentState,
      recentDiagnostics: retainDiagnostics(
        [run, ...currentState.recentDiagnostics],
        currentState.preferences.diagnosticsRetentionDays,
      ),
    }));
  }, []);

  const clearDiagnostics = useCallback(() => {
    setState((currentState) => ({
      ...currentState,
      recentDiagnostics: [],
    }));
  }, []);

  const resetUsage = useCallback(() => {
    setState((currentState) => ({
      ...currentState,
      usage: resetLocalUsage(),
    }));
  }, []);

  const removeRoute = useCallback(async (routeId: string) => {
    const route = stateReference.current.connectionGroups
      .flatMap((group) => group.routes)
      .find((item) => item.id === routeId);
    if (!route) {
      return;
    }
    await deleteSecret(route.credentialReference ?? `legacy-admin:${route.id}`);
    setState((currentState) => ({
      ...currentState,
      connectionGroups: currentState.connectionGroups.map((group) =>
        summarizeConnectionGroup({
          ...group,
          routes: group.routes.filter((item) => item.id !== routeId),
          updatedAt: new Date().toISOString(),
        }),
      ),
    }));
  }, []);

  const revokeDevice = useCallback(async (deviceId: string) => {
    const device = stateReference.current.devices.find((item) => item.id === deviceId);
    if (!device || device.status === "revoked") {
      return;
    }
    await deleteSecret(device.credentialReference);
    setState((currentState) => ({
      ...currentState,
      devices: currentState.devices.map((item) =>
        item.id === deviceId ? { ...item, status: "revoked" } : item,
      ),
    }));
  }, []);

  const setPreferredRegion = useCallback((groupId: string, region: RegionCode) => {
    setState((currentState) => ({
      ...currentState,
      connectionGroups: currentState.connectionGroups.map(
        (group): ConnectionGroup =>
          group.id === groupId
            ? { ...group, preferredRegion: region, updatedAt: new Date().toISOString() }
            : group,
      ),
    }));
  }, []);

  const updatePreferences = useCallback((preferences: Partial<Preferences>) => {
    setState((currentState) => {
      const nextPreferences = { ...currentState.preferences, ...preferences };
      return {
        ...currentState,
        preferences: nextPreferences,
        recentDiagnostics: retainDiagnostics(
          currentState.recentDiagnostics,
          nextPreferences.diagnosticsRetentionDays,
        ),
      };
    });
  }, []);

  const actions = useMemo<AppActions>(
    () => ({
      addDevice,
      addRoute,
      applyAdminInspection,
      applyRouteChecks,
      appendDiagnostic,
      clearDiagnostics,
      removeRoute,
      resetUsage,
      revokeDevice,
      setPreferredRegion,
      updatePreferences,
    }),
    [
      addDevice,
      addRoute,
      applyAdminInspection,
      applyRouteChecks,
      appendDiagnostic,
      clearDiagnostics,
      removeRoute,
      resetUsage,
      revokeDevice,
      setPreferredRegion,
      updatePreferences,
    ],
  );

  return { actions, hydrated, persistenceStatus, state };
}

function summarizeConnectionGroup(group: ConnectionGroup): ConnectionGroup {
  if (group.routes.length === 0) {
    return { ...group, healthScore: 0, status: "draft" };
  }
  const credentialCounts = new Map<string, number>();
  for (const route of group.routes) {
    credentialCounts.set(
      route.credentialGroupId,
      (credentialCounts.get(route.credentialGroupId) ?? 0) + 1,
    );
  }
  const routes = group.routes.map((route) => {
    const sharedCredential = (credentialCounts.get(route.credentialGroupId) ?? 0) > 1;
    if (sharedCredential) {
      return { ...route, credentialState: "at-risk" as const };
    }
    if (route.managementState === "connected") {
      return { ...route, credentialState: "healthy" as const };
    }
    return route;
  });
  const healthScore = Math.round(
    routes.reduce((total, route) => total + route.healthScore, 0) /
      routes.length,
  );
  const status = routes.some((route) => route.status === "verifying")
    ? "verifying"
    : routes.every((route) => route.status === "active")
      ? "active"
      : "degraded";
  return { ...group, healthScore, routes, status };
}

function retainDiagnostics(
  diagnostics: DiagnosticRun[],
  retentionDays: Preferences["diagnosticsRetentionDays"],
): DiagnosticRun[] {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  return diagnostics
    .filter((run) => new Date(run.startedAt).getTime() >= cutoff)
    .slice(0, 20);
}
