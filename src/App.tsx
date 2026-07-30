import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import type { AppPage, RuntimeInfo } from "@/domain/models";
import { useAppState } from "@/hooks/use-app-state";
import { ClientsPage } from "@/pages/ClientsPage";
import { DiagnosticsPage } from "@/pages/DiagnosticsPage";
import { OverviewPage } from "@/pages/OverviewPage";
import { RoutesPage } from "@/pages/RoutesPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SetupPage } from "@/pages/SetupPage";
import { getRuntimeInfo } from "@/services/desktop";

const defaultRuntimeInfo: RuntimeInfo = {
  appVersion: "0.6.2",
  architecture: "检测中",
  desktop: false,
  operatingSystem: "检测中",
};

export default function App() {
  const [activePage, setActivePage] = useState<AppPage>("overview");
  const [runtimeInfo, setRuntimeInfo] = useState(defaultRuntimeInfo);
  const { actions, persistenceStatus, state } = useAppState();
  const primaryGroup = state.connectionGroups[0];

  useEffect(() => {
    let active = true;
    void getRuntimeInfo()
      .then((info) => {
        if (active) {
          setRuntimeInfo(info);
        }
      })
      .catch(() => {
        if (active) {
          setRuntimeInfo((current) => ({
            ...current,
            architecture: "检测失败",
            operatingSystem: "检测失败",
          }));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <AppShell
      activePage={activePage}
      onNavigate={setActivePage}
      persistenceStatus={persistenceStatus}
      runtimeInfo={runtimeInfo}
    >
      {activePage === "overview" ? (
        <OverviewPage
          group={primaryGroup}
          onNavigate={setActivePage}
          onOptimize={() => actions.optimizeRoutes(primaryGroup.id)}
          onPrepare={(routeId) =>
            actions.prepareSelectedSubscription(primaryGroup.id, routeId)
          }
          onPrepareNode={(routeId, nodeId) =>
            actions.prepareSelectedSubscriptionNode(
              primaryGroup.id,
              routeId,
              nodeId,
            )
          }
          onSaveCredential={(secret) =>
            actions.saveSharedAdminSecret(primaryGroup.id, secret)
          }
          onSelectRegion={(region) =>
            actions.setPreferredRegion(primaryGroup.id, region)
          }
          onSelectRoute={(routeId) => actions.selectRoute(primaryGroup.id, routeId)}
        />
      ) : null}
      {activePage === "setup" ? (
        <SetupPage
          onAddRoute={actions.addRoute}
          onNavigate={setActivePage}
          routes={primaryGroup.routes}
        />
      ) : null}
      {activePage === "routes" ? (
        <RoutesPage
          group={primaryGroup}
          onApplyAdminInspection={actions.applyAdminInspection}
          onNavigate={setActivePage}
          onRemoveRoute={actions.removeRoute}
        />
      ) : null}
      {activePage === "clients" ? <ClientsPage runtimeInfo={runtimeInfo} /> : null}
      {activePage === "diagnostics" ? (
        <DiagnosticsPage
          group={primaryGroup}
          onApplyRouteChecks={actions.applyRouteChecks}
          onAppendDiagnostic={actions.appendDiagnostic}
          recentDiagnostics={state.recentDiagnostics}
        />
      ) : null}
      {activePage === "settings" ? (
        <SettingsPage
          diagnosticCount={state.recentDiagnostics.length}
          onClearDiagnostics={actions.clearDiagnostics}
          onUpdatePreferences={actions.updatePreferences}
          preferences={state.preferences}
          runtimeInfo={runtimeInfo}
        />
      ) : null}
    </AppShell>
  );
}
