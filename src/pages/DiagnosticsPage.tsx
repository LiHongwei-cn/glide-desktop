import { Activity, CheckCircle2, Clock, Play, ShieldAlert, Waypoints, XCircle } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Badge, Button, StatusDot } from "@/components/ui";
import { findCredentialRisks, scoreEndpointProbe } from "@/domain/health";
import type {
  ConnectionGroup,
  DiagnosticCheck,
  DiagnosticRun,
  EndpointProbe,
  RouteCheckUpdate,
} from "@/domain/models";
import { probeEndpoints } from "@/services/desktop";

const maximumEndpointsPerRun = 100;
const probeBatchSize = 20;

export function DiagnosticsPage({
  group,
  onApplyRouteChecks,
  onAppendDiagnostic,
  recentDiagnostics,
}: {
  group: ConnectionGroup;
  onApplyRouteChecks: (updates: RouteCheckUpdate[]) => void;
  onAppendDiagnostic: (run: DiagnosticRun) => void;
  recentDiagnostics: DiagnosticRun[];
}) {
  const [running, setRunning] = useState(false);
  const latestRun = recentDiagnostics[0];

  async function runDiagnostics() {
    setRunning(true);
    const startedAt = new Date().toISOString();
    const checks: DiagnosticCheck[] = [];
    const routeUpdates: RouteCheckUpdate[] = [];
    try {
      const risks = findCredentialRisks(group.routes);
      const conflicts = group.routes.filter(
        (route) => route.regionVerification === "conflict",
      ).length;
      const endpointEntries = getEndpointEntries(group).slice(0, maximumEndpointsPerRun);

      checks.push({
        detail:
          risks.length > 0
            ? `发现 ${risks.length} 个跨线路重复凭据组。`
            : "未发现跨线路重复凭据。",
        id: crypto.randomUUID(),
        label: "凭据隔离",
        status: risks.length > 0 ? "failed" : "passed",
      });
      checks.push({
        detail:
          conflicts > 0
            ? `${conflicts} 条线路与配置地区不一致。`
            : "地区证据与配置一致。",
        id: crypto.randomUUID(),
        label: "地区证据",
        status: conflicts > 0 ? "warning" : "passed",
      });

      if (endpointEntries.length > 0) {
        const probePairs: Array<{
          entry: (typeof endpointEntries)[number];
          probe: EndpointProbe;
        }> = [];
        for (let index = 0; index < endpointEntries.length; index += probeBatchSize) {
          const batch = endpointEntries.slice(index, index + probeBatchSize);
          const endpointResults = await probeEndpoints(
            batch.map((entry) => entry.endpoint),
          );
          endpointResults.forEach((probe, resultIndex) => {
            const entry = batch[resultIndex];
            if (entry) {
              probePairs.push({ entry, probe });
            }
          });
        }
        checks.push(
          ...probePairs.map(({ probe }) => ({
            detail: probe.detail,
            durationMs: probe.durationMs,
            id: crypto.randomUUID(),
            label: `管理入口 · ${probe.endpoint}`,
            status: probe.status,
          })),
        );
        const checkedAt = new Date().toISOString();
        routeUpdates.push(
          ...probePairs
            .filter(({ probe }) => probe.durationMs !== undefined)
            .map(({ entry, probe }) => ({
              checkedAt,
              healthScore: scoreEndpointProbe(probe),
              routeIds: entry.routeIds,
              status: probe.status === "passed" ? "active" as const : "degraded" as const,
            })),
        );
        const totalEndpointCount = getEndpointEntries(group).length;
        if (totalEndpointCount > maximumEndpointsPerRun) {
          checks.push({
            detail: `本次已检查前 ${maximumEndpointsPerRun} 个入口，其余 ${
              totalEndpointCount - maximumEndpointsPerRun
            } 个将在下次检查。`,
            id: crypto.randomUUID(),
            label: "检查批次上限",
            status: "warning",
          });
        }
      } else {
        checks.push({
          detail: "脱敏基线没有完整地址，请通过设置向导逐条导入后再检查。",
          id: crypto.randomUUID(),
          label: "管理入口",
          status: "pending",
        });
      }
    } catch (diagnosticError) {
      checks.push({
        detail:
          diagnosticError instanceof Error
            ? diagnosticError.message
            : "本机网络检查未完成，请稍后重试。",
        id: crypto.randomUUID(),
        label: "本机网络检查",
        status: "failed",
      });
    } finally {
      const run: DiagnosticRun = {
        checks,
        completedAt: new Date().toISOString(),
        id: crypto.randomUUID(),
        startedAt,
      };
      if (routeUpdates.length > 0) {
        onApplyRouteChecks(routeUpdates);
      }
      onAppendDiagnostic(run);
      setRunning(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        actions={
          <Button
            disabled={running}
            icon={<Play aria-hidden="true" size={16} />}
            onClick={() => void runDiagnostics()}
            variant="primary"
          >
            {running ? "检查中…" : "运行快速检查"}
          </Button>
        }
        eyebrow="结果只保存在本机"
        subtitle="检查线路、地区和管理入口，不记录浏览历史。"
        title="检查"
      />

      <section aria-busy={running} className="diagnostic-overview">
        <div>
          <span className="diagnostic-overview__icon">
            <Activity aria-hidden="true" size={22} />
          </span>
          <div>
            <strong aria-live="polite">
              {running ? "正在执行安全检查" : latestRun ? "检查已完成" : "等待首次检查"}
            </strong>
            <p>
              {running
                ? "请保持应用打开；检查结束后会自动保存脱敏结果。"
                : latestRun?.completedAt
                ? new Date(latestRun.completedAt).toLocaleString("zh-CN")
                : "导入管理入口后可以执行 DNS、TLS 和可达性检查。"}
            </p>
          </div>
        </div>
        <Badge tone={latestRun ? "info" : "neutral"}>
          {latestRun ? `${latestRun.checks.length} 项` : "尚无结果"}
        </Badge>
      </section>

      <div className="diagnostic-layout">
        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>检查结果</h2>
              <p>错误会转换成可操作说明，不只显示原始状态码。</p>
            </div>
          </div>
          <div className="check-list">
            {(latestRun?.checks ?? defaultChecks).map((check) => (
              <div className="check-row" key={check.id}>
                <StatusDot status={check.status} />
                <div>
                  <strong>{check.label}</strong>
                  <p>{check.detail}</p>
                </div>
                {check.durationMs ? <span>{check.durationMs} ms</span> : null}
              </div>
            ))}
          </div>
        </section>

        <aside className="diagnostic-aside">
          <h2>检查范围</h2>
          <ScopeItem icon={CheckCircle2} label="本地配置与凭据重复" />
          <ScopeItem icon={Waypoints} label="配置地区与探测证据" />
          <ScopeItem icon={Clock} label="DNS、TLS 与响应时间" />
          <ScopeItem icon={ShieldAlert} label="不访问用户浏览目标" />
          <div className="diagnostic-aside__note">
            <XCircle aria-hidden="true" size={16} />
            <span>深度吞吐测试必须由用户主动触发。</span>
          </div>
        </aside>
      </div>
    </div>
  );
}

function getEndpointEntries(group: ConnectionGroup): Array<{
  endpoint: string;
  routeIds: string[];
}> {
  const routesByEndpoint = new Map<string, string[]>();
  group.routes.forEach((route) => {
    if (!route.adminEndpoint) {
      return;
    }
    routesByEndpoint.set(route.adminEndpoint, [
      ...(routesByEndpoint.get(route.adminEndpoint) ?? []),
      route.id,
    ]);
  });
  return [...routesByEndpoint.entries()].map(([endpoint, routeIds]) => ({
    endpoint,
    routeIds,
  }));
}

const defaultChecks: DiagnosticCheck[] = [
  {
    detail: "等待检查",
    id: "credentials-pending",
    label: "凭据隔离",
    status: "pending",
  },
  {
    detail: "等待检查",
    id: "region-pending",
    label: "地区证据",
    status: "pending",
  },
  {
    detail: "等待检查",
    id: "endpoint-pending",
    label: "管理入口",
    status: "pending",
  },
];

function ScopeItem({ icon: Icon, label }: { icon: typeof CheckCircle2; label: string }) {
  return (
    <div className="scope-item">
      <Icon aria-hidden="true" size={16} />
      <span>{label}</span>
    </div>
  );
}
