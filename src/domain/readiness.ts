import type { AppState, AppPage } from "@/domain/models";

export type ReadinessStepId = "device" | "diagnostic" | "import";

export interface ReadinessStep {
  actionPage: AppPage;
  completed: boolean;
  id: ReadinessStepId;
}

export function getReadinessSteps(state: AppState): ReadinessStep[] {
  const routes = state.connectionGroups.flatMap((group) => group.routes);

  return [
    {
      actionPage: "setup",
      completed: routes.some((route) => Boolean(route.adminEndpoint)),
      id: "import",
    },
    {
      actionPage: "diagnostics",
      completed: state.recentDiagnostics.length > 0,
      id: "diagnostic",
    },
    {
      actionPage: "subscriptions",
      completed: state.devices.some((device) => device.status === "active"),
      id: "device",
    },
  ];
}
