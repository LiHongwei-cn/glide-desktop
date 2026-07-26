import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { initialState } from "@/data/seed";
import type {
  AppState,
  ConnectionGroup,
  DeviceCredential,
  DiagnosticRun,
  Preferences,
  RegionCode,
  RouteCandidate,
  WorkspacePersistenceStatus,
} from "@/domain/models";
import { prepareWorkspaceState, resetLocalUsage } from "@/domain/usage";
import { deleteSecret, loadWorkspaceState, saveWorkspaceState } from "@/services/desktop";

interface AppActions {
  addDevice: (device: DeviceCredential) => void;
  addRoute: (route: RouteCandidate) => void;
  appendDiagnostic: (run: DiagnosticRun) => void;
  clearDiagnostics: () => void;
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
          ? {
              ...group,
              routes: [...group.routes, route],
              updatedAt: new Date().toISOString(),
            }
          : group,
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
      appendDiagnostic,
      clearDiagnostics,
      resetUsage,
      revokeDevice,
      setPreferredRegion,
      updatePreferences,
    }),
    [
      addDevice,
      addRoute,
      appendDiagnostic,
      clearDiagnostics,
      resetUsage,
      revokeDevice,
      setPreferredRegion,
      updatePreferences,
    ],
  );

  return { actions, hydrated, persistenceStatus, state };
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
