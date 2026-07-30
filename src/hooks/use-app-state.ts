import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { initialState } from "@/data/seed";
import { CredentialSetupRequiredError } from "@/domain/errors";
import type {
  AdminInspection,
  AppState,
  ConnectionGroup,
  DiagnosticRun,
  Preferences,
  PreparedSubscriptionNode,
  PreparedSubscription,
  RegionCode,
  RouteCandidate,
  RouteCheckUpdate,
  RouteOptimizationResult,
  WorkspacePersistenceStatus,
} from "@/domain/models";
import {
  rankRoutesForSelection,
} from "@/domain/route-selection";
import { prepareWorkspaceState } from "@/domain/workspace";
import { redactEndpoint } from "@/domain/validation";
import {
  deleteSecret,
  getCredentialVaultStatus,
  inspectAdminDeployment,
  loadWorkspaceState,
  prepareRouteSubscriptionNode,
  prepareRouteSubscription,
  probeRouteForOptimization,
  saveWorkspaceState,
  storeSharedSecret,
} from "@/services/desktop";

interface AppActions {
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
  optimizeRoutes: (groupId: string) => Promise<RouteOptimizationResult>;
  prepareSelectedSubscription: (
    groupId: string,
    routeId: string,
  ) => Promise<PreparedSubscription>;
  prepareSelectedSubscriptionNode: (
    groupId: string,
    routeId: string,
    nodeId: string,
  ) => Promise<PreparedSubscriptionNode>;
  removeRoute: (routeId: string) => Promise<void>;
  selectRoute: (groupId: string, routeId: string) => void;
  saveSharedAdminSecret: (groupId: string, secret: string) => Promise<void>;
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
const maximumConcurrentRouteProbes = 4;
const maximumConfirmationRoutes = 8;
const recoveryConcurrentRouteProbes = 2;
const recoveryRetryDelayMs = 350;

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
          const nextState = prepareWorkspaceState(storedState, initialState);
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
                ? applyInspectionToRoute(
                    route,
                    inspection,
                    managedAt,
                    credentialReference,
                    adminEndpoint,
                  )
                : route,
            ),
            updatedAt: managedAt,
          }),
        ),
      }));
    },
    [],
  );

  const optimizeRoutes = useCallback(
    async (groupId: string): Promise<RouteOptimizationResult> => {
      const group = stateReference.current.connectionGroups.find(
        (candidate) => candidate.id === groupId,
      );
      if (!group || group.routes.length === 0) {
        throw new Error("还没有可优化的节点，请先添加线路。");
      }
      await requireCredentialVault(group.routes);

      const optimizedAt = new Date().toISOString();
      const {
        failedCount,
        performance,
        probes,
        recoveryAttempted,
        refreshedRoutes,
        responseTimes,
      } = await probeRoutesForOptimization(
        group.routes,
        optimizedAt,
        group.selectionMode === "automatic" ? group.selectedRouteId : undefined,
      );
      const allRankedRoutes = rankRoutesForSelection(
        refreshedRoutes,
        responseTimes,
      );
      const confirmedResponseTimes = Object.fromEntries(
        [...performance]
          .filter(([, summary]) => summary.verificationSamples >= 2)
          .map(([routeId, summary]) => [routeId, summary.responseTimeMs]),
      );
      const confirmedRankedRoutes = rankRoutesForSelection(
        refreshedRoutes,
        confirmedResponseTimes,
      );
      const rankedRoutes =
        confirmedRankedRoutes.length > 0 ? confirmedRankedRoutes : allRankedRoutes;
      if (rankedRoutes.length === 0) {
        throw new Error(
          recoveryAttempted
            ? "全部线路在自动低并发重试后仍未通过，请检查网络或稍后重试。"
            : "没有线路同时通过后台和订阅验证，请检查网络后重试。",
        );
      }
      const selectedRank = rankedRoutes[0];
      if (!selectedRank) {
        throw new Error("优化结果与真实订阅验证不一致，请重新运行。");
      }
      const selectedRoute = refreshedRoutes.find(
        (route) => route.id === selectedRank.routeId,
      );
      const selectedProbe = probes.get(selectedRank.routeId);
      const selectedPerformance = performance.get(selectedRank.routeId);
      if (!selectedRoute || !selectedProbe || !selectedPerformance) {
        throw new Error("优化结果与本地线路不一致，请重新运行。");
      }
      const stabilityReason =
        selectedPerformance.verificationSamples >= 2
          ? selectedPerformance.stabilityDeltaMs <= 250
            ? "，两轮复测稳定"
            : "，已计入响应波动"
          : "";
      const recoveryReason = recoveryAttempted ? "，首次失败后已自动低并发恢复" : "";
      const reason = `${selectedRoute.displayName}：${selectedRank.reason}${stabilityReason}${recoveryReason}`;
      const refreshedRouteById = new Map(
        refreshedRoutes.map((route) => [route.id, route]),
      );
      const routeOptions = [...performance]
        .flatMap(([routeId, routePerformance]) => {
          const route = refreshedRouteById.get(routeId);
          const probe = probes.get(routeId);
          if (!route || !probe) {
            return [];
          }
          return [
            {
              nodes: probe.subscription.nodes,
              routeId,
              routeName: route.displayName,
              stabilityDeltaMs: routePerformance.stabilityDeltaMs,
              subscriptionUrl: probe.subscription.subscriptionUrl,
              verificationSamples: routePerformance.verificationSamples,
              verifiedInMs: routePerformance.typicalResponseTimeMs,
            },
          ];
        })
        .sort(
          (optionA, optionB) =>
            optionB.verificationSamples - optionA.verificationSamples ||
            optionA.verifiedInMs - optionB.verifiedInMs ||
            optionA.routeId.localeCompare(optionB.routeId),
        );

      setState((currentState) => ({
        ...currentState,
        connectionGroups: currentState.connectionGroups.map((candidate) =>
          candidate.id === groupId
              ? summarizeConnectionGroup({
                ...candidate,
                routes: refreshedRoutes,
                selectedRouteId: selectedRank.routeId,
                selectionMode: "automatic",
                selectionReason: reason,
                selectionUpdatedAt: optimizedAt,
                updatedAt: optimizedAt,
              })
            : candidate,
        ),
      }));
      return {
        availableCount: probes.size,
        failedCount,
        nodes: selectedProbe.subscription.nodes,
        reason,
        routeId: selectedRank.routeId,
        routeName: selectedRoute.displayName,
        routeOptions,
        stabilityDeltaMs: selectedPerformance.stabilityDeltaMs,
        subscriptionUrl: selectedProbe.subscription.subscriptionUrl,
        verificationSamples: selectedPerformance.verificationSamples,
        verifiedInMs: selectedPerformance.typicalResponseTimeMs,
      };
    },
    [],
  );

  const prepareSelectedSubscription = useCallback(
    async (groupId: string, routeId: string): Promise<PreparedSubscription> => {
      const route = findManagedRoute(
        stateReference.current.connectionGroups,
        groupId,
        routeId,
      );
      await requireCredentialVault([route]);
      return prepareRouteSubscription(
        route.adminEndpoint!,
        route.credentialReference!,
      );
    },
    [],
  );

  const prepareSelectedSubscriptionNode = useCallback(
    async (
      groupId: string,
      routeId: string,
      nodeId: string,
    ): Promise<PreparedSubscriptionNode> => {
      const route = findManagedRoute(
        stateReference.current.connectionGroups,
        groupId,
        routeId,
      );
      await requireCredentialVault([route]);
      return prepareRouteSubscriptionNode(
        route.adminEndpoint!,
        route.credentialReference!,
        nodeId,
      );
    },
    [],
  );

  const saveSharedAdminSecret = useCallback(
    async (groupId: string, secret: string): Promise<void> => {
      const group = stateReference.current.connectionGroups.find(
        (candidate) => candidate.id === groupId,
      );
      const routes = group?.routes.filter(
        (route) => route.adminEndpoint && route.credentialReference,
      );
      if (!routes?.length) {
        throw new Error("没有可以保存凭据的连接。");
      }
      const inspections = await Promise.all(
        routes.map((route) =>
          inspectAdminDeployment(route.adminEndpoint!, secret),
        ),
      );
      await storeSharedSecret(
        routes.map((route) => route.credentialReference!),
        secret,
      );
      const managedAt = new Date().toISOString();
      setState((currentState) => ({
        ...currentState,
        connectionGroups: currentState.connectionGroups.map((candidate) =>
          candidate.id === groupId
            ? summarizeConnectionGroup({
                ...candidate,
                routes: candidate.routes.map((route) => {
                  const routeIndex = routes.findIndex(
                    (candidateRoute) => candidateRoute.id === route.id,
                  );
                  return routeIndex >= 0
                    ? applyInspectionToRoute(
                        route,
                        inspections[routeIndex],
                        managedAt,
                      )
                    : route;
                }),
                updatedAt: managedAt,
              })
            : candidate,
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

  const selectRoute = useCallback((groupId: string, routeId: string) => {
    setState((currentState) => ({
      ...currentState,
      connectionGroups: currentState.connectionGroups.map((group) => {
        const selectedRoute = group.routes.find((route) => route.id === routeId);
        if (group.id !== groupId || !selectedRoute) {
          return group;
        }
        const selectedAt = new Date().toISOString();
        return {
          ...group,
          selectedRouteId: routeId,
          selectionMode: "manual",
          selectionReason: `${selectedRoute.displayName}：由你手动选择`,
          selectionUpdatedAt: selectedAt,
          updatedAt: selectedAt,
        };
      }),
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
      addRoute,
      applyAdminInspection,
      applyRouteChecks,
      appendDiagnostic,
      clearDiagnostics,
      optimizeRoutes,
      prepareSelectedSubscriptionNode,
      prepareSelectedSubscription,
      removeRoute,
      selectRoute,
      saveSharedAdminSecret,
      setPreferredRegion,
      updatePreferences,
    }),
    [
      addRoute,
      applyAdminInspection,
      applyRouteChecks,
      appendDiagnostic,
      clearDiagnostics,
      optimizeRoutes,
      prepareSelectedSubscriptionNode,
      prepareSelectedSubscription,
      removeRoute,
      selectRoute,
      saveSharedAdminSecret,
      setPreferredRegion,
      updatePreferences,
    ],
  );

  return { actions, hydrated, persistenceStatus, state };
}

function findManagedRoute(
  groups: ConnectionGroup[],
  groupId: string,
  routeId: string,
): RouteCandidate {
  const group = groups.find((candidate) => candidate.id === groupId);
  const route = group?.routes.find((candidate) => candidate.id === routeId);
  if (!route?.adminEndpoint || !route.credentialReference) {
    throw new Error("这条线路缺少管理信息，请重新导入。");
  }
  return route;
}

async function requireCredentialVault(routes: RouteCandidate[]): Promise<void> {
  const references = routes.flatMap((route) =>
    route.credentialReference ? [route.credentialReference] : [],
  );
  if (references.length === 0) {
    throw new CredentialSetupRequiredError();
  }
  const status = await getCredentialVaultStatus(references);
  if (!status.ready) {
    throw new CredentialSetupRequiredError();
  }
}

interface RouteProbeMeasurement {
  failedSamples: number;
  latestProbe: Awaited<ReturnType<typeof probeRouteForOptimization>>;
  responseTimes: number[];
}

async function probeRoutesForOptimization(
  routes: RouteCandidate[],
  optimizedAt: string,
  currentRouteId?: string,
): Promise<{
  failedCount: number;
  performance: Map<string, RoutePerformanceSummary>;
  probes: Map<string, Awaited<ReturnType<typeof probeRouteForOptimization>>>;
  recoveryAttempted: boolean;
  refreshedRoutes: RouteCandidate[];
  responseTimes: Record<string, number>;
}> {
  let firstResults = await mapWithConcurrency(
    routes,
    maximumConcurrentRouteProbes,
    probeRouteForRouteOptimization,
  );
  const recoveryAttempted = firstResults.every((result) => !result.probe);
  if (recoveryAttempted) {
    await new Promise((resolve) => window.setTimeout(resolve, recoveryRetryDelayMs));
    firstResults = await mapWithConcurrency(
      routes,
      recoveryConcurrentRouteProbes,
      probeRouteForRouteOptimization,
    );
  }
  const measurements = new Map<string, RouteProbeMeasurement>(
    firstResults.flatMap((result) =>
      result.probe
        ? [
            [
              result.routeId,
              {
                failedSamples: 0,
                latestProbe: result.probe,
                responseTimes: [result.probe.subscription.responseTimeMs],
              },
            ] as const,
          ]
        : [],
    ),
  );
  const firstResponseTimes = Object.fromEntries(
    [...measurements].map(([routeId, measurement]) => [
      routeId,
      measurement.responseTimes[0],
    ]),
  );
  const firstResultByRouteId = new Map(
    firstResults.map((result) => [result.routeId, result]),
  );
  const firstRefreshedRoutes = routes.map((route) => {
    const measurement = measurements.get(route.id);
    if (measurement) {
      return applyInspectionToRoute(
        route,
        measurement.latestProbe.inspection,
        optimizedAt,
      );
    }
    return firstResultByRouteId.get(route.id)?.attempted
      ? markRouteRefreshFailed(route, optimizedAt)
      : route;
  });
  const confirmationRouteIds = rankRoutesForSelection(
    firstRefreshedRoutes,
    firstResponseTimes,
  )
    .slice(0, maximumConfirmationRoutes)
    .map((route) => route.routeId);
  if (
    currentRouteId &&
    measurements.has(currentRouteId) &&
    !confirmationRouteIds.includes(currentRouteId)
  ) {
    if (confirmationRouteIds.length === maximumConfirmationRoutes) {
      confirmationRouteIds[confirmationRouteIds.length - 1] = currentRouteId;
    } else {
      confirmationRouteIds.push(currentRouteId);
    }
  }
  const routeById = new Map(routes.map((route) => [route.id, route]));
  const confirmationRoutes = confirmationRouteIds.flatMap((routeId) => {
    const route = routeById.get(routeId);
    return route ? [route] : [];
  });
  const confirmationResults = await mapWithConcurrency(
    confirmationRoutes,
    maximumConcurrentRouteProbes,
    probeRouteForRouteOptimization,
  );
  for (const result of confirmationResults) {
    const measurement = measurements.get(result.routeId);
    if (!measurement) {
      continue;
    }
    if (result.probe) {
      measurement.latestProbe = result.probe;
      measurement.responseTimes.push(result.probe.subscription.responseTimeMs);
    } else {
      measurement.failedSamples += 1;
    }
  }
  const probes = new Map(
    [...measurements].map(([routeId, measurement]) => [
      routeId,
      measurement.latestProbe,
    ]),
  );
  const performance = new Map(
    [...measurements].map(([routeId, measurement]) => [
      routeId,
      summarizeRoutePerformance(measurement.responseTimes, measurement.failedSamples),
    ]),
  );
  return {
    failedCount: routes.length - probes.size,
    performance,
    probes,
    recoveryAttempted,
    refreshedRoutes: routes.map((route) => {
      const measurement = measurements.get(route.id);
      if (measurement) {
        return applyInspectionToRoute(
          route,
          measurement.latestProbe.inspection,
          optimizedAt,
        );
      }
      return firstResultByRouteId.get(route.id)?.attempted
        ? markRouteRefreshFailed(route, optimizedAt)
        : route;
    }),
    responseTimes: Object.fromEntries(
      [...performance].map(([routeId, summary]) => [
        routeId,
        summary.responseTimeMs,
      ]),
    ),
  };
}

interface RoutePerformanceSummary {
  responseTimeMs: number;
  stabilityDeltaMs: number;
  typicalResponseTimeMs: number;
  verificationSamples: number;
}

function summarizeRoutePerformance(
  responseTimes: number[],
  failedSamples: number,
): RoutePerformanceSummary {
  const sortedTimes = [...responseTimes].sort((timeA, timeB) => timeA - timeB);
  const middleIndex = Math.floor(sortedTimes.length / 2);
  const typicalResponseTimeMs =
    sortedTimes.length % 2 === 0
      ? Math.round((sortedTimes[middleIndex - 1] + sortedTimes[middleIndex]) / 2)
      : sortedTimes[middleIndex];
  const stabilityDeltaMs = sortedTimes.at(-1)! - sortedTimes[0];
  return {
    responseTimeMs: Math.round(
      typicalResponseTimeMs + stabilityDeltaMs / 2 + failedSamples * 750,
    ),
    stabilityDeltaMs,
    typicalResponseTimeMs,
    verificationSamples: sortedTimes.length,
  };
}

async function mapWithConcurrency<Item, Result>(
  items: Item[],
  maximumConcurrency: number,
  mapper: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(maximumConcurrency, items.length) },
      () => worker(),
    ),
  );
  return results;
}

async function probeRouteForRouteOptimization(route: RouteCandidate): Promise<{
  attempted: boolean;
  probe?: Awaited<ReturnType<typeof probeRouteForOptimization>>;
  routeId: string;
}> {
  if (!route.adminEndpoint || !route.credentialReference) {
    return { attempted: false, routeId: route.id };
  }
  try {
    const probe = await probeRouteForOptimization(
      route.adminEndpoint,
      route.credentialReference,
    );
    return { attempted: true, probe, routeId: route.id };
  } catch {
    return { attempted: true, routeId: route.id };
  }
}

function markRouteRefreshFailed(
  route: RouteCandidate,
  checkedAt: string,
): RouteCandidate {
  return {
    ...route,
    healthScore: Math.min(route.healthScore, 45),
    lastCheckedAt: checkedAt,
    managementState: "error",
    status: "degraded",
  };
}

function summarizeConnectionGroup(group: ConnectionGroup): ConnectionGroup {
  if (group.routes.length === 0) {
    return {
      ...group,
      healthScore: 0,
      selectedRouteId: undefined,
      selectionMode: "automatic",
      selectionReason: undefined,
      selectionUpdatedAt: undefined,
      status: "draft",
    };
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
  const selectedRouteId = routes.some((route) => route.id === group.selectedRouteId)
    ? group.selectedRouteId
    : undefined;
  return {
    ...group,
    healthScore,
    routes,
    selectedRouteId,
    selectionMode:
      group.selectionMode === "manual" && selectedRouteId
        ? "manual"
        : "automatic",
    status,
  };
}

function applyInspectionToRoute(
  route: RouteCandidate,
  inspection: AdminInspection,
  managedAt: string,
  credentialReference?: string,
  adminEndpoint?: string,
): RouteCandidate {
  return {
    ...route,
    adminAdapter: inspection.adapter,
    adminEndpoint: adminEndpoint ?? route.adminEndpoint,
    credentialReference: credentialReference ?? route.credentialReference,
    credentialGroupId: `node:${inspection.credentialFingerprint}`,
    healthScore: Math.max(route.healthScore, 90),
    endpointLabel: adminEndpoint
      ? `${redactEndpoint(adminEndpoint)} · 已验证管理登录`
      : route.endpointLabel,
    lastCheckedAt: managedAt,
    lastManagedAt: managedAt,
    managementState: "connected",
    nodePathGroupId: `path:${inspection.nodePathFingerprint}`,
    preferredIpCount: inspection.preferredEndpointCount,
    status: "active",
    subscriptionReady: inspection.subscriptionReady,
    version: inspection.configUpdatedAt ?? "已读取",
  };
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
