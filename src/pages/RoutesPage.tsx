import { Filter, ScanSearch } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { RouteRow } from "@/components/RouteRow";
import { Badge, Button } from "@/components/ui";
import {
  filterRoutes,
  getIndependentCredentialCount,
} from "@/domain/health";
import type { RouteFilter } from "@/domain/health";
import type { AppPage, ConnectionGroup } from "@/domain/models";

const filterLabels: Record<RouteFilter, string> = {
  all: "全部线路",
  conflict: "地区冲突",
  risk: "凭据风险",
  unverified: "待验证",
  verified: "已验证",
};

export function RoutesPage({
  group,
  onNavigate,
}: {
  group: ConnectionGroup;
  onNavigate: (page: AppPage) => void;
}) {
  const [activeFilter, setActiveFilter] = useState<RouteFilter>("all");
  const conflictCount = group.routes.filter(
    (route) => route.regionVerification === "conflict",
  ).length;
  const independentCredentialCount = getIndependentCredentialCount(group.routes);
  const visibleRoutes = filterRoutes(group.routes, activeFilter);

  return (
    <div className="page">
      <PageHeader
        actions={
          <>
            <label className="route-filter">
              <Filter aria-hidden="true" size={15} />
              <span className="sr-only">筛选线路</span>
              <select
                aria-label="筛选线路"
                onChange={(event) => setActiveFilter(event.target.value as RouteFilter)}
                value={activeFilter}
              >
                {Object.entries(filterLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              icon={<ScanSearch aria-hidden="true" size={16} />}
              onClick={() => onNavigate("diagnostics")}
              variant="primary"
            >
              深度验证
            </Button>
          </>
        }
        subtitle="线路名称、实际出口、凭据状态和性能分别展示，避免虚假的国家确定性。"
        title="线路"
      />

      <section className="route-summary">
        <div>
          <span>候选线路</span>
          <strong>{group.routes.length}</strong>
        </div>
        <div>
          <span>地区冲突</span>
          <strong>{conflictCount}</strong>
        </div>
        <div>
          <span>独立节点身份</span>
          <strong>{independentCredentialCount}</strong>
        </div>
        <Badge
          tone={
            group.routes.length === 0
              ? "neutral"
              : independentCredentialCount === group.routes.length
                ? "positive"
                : "critical"
          }
        >
          {group.routes.length === 0
            ? "尚未添加线路"
            : independentCredentialCount === group.routes.length
              ? "凭据故障域已隔离"
              : "当前不具备独立线路容灾"}
        </Badge>
      </section>

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>全部候选线路</h2>
            <p>按健康度排列；共享凭据线路会被标记为同一故障域。</p>
          </div>
        </div>
        {visibleRoutes.length > 0 ? (
          <div className="route-list route-list--detailed">
            {[...visibleRoutes]
              .sort((routeA, routeB) => routeB.healthScore - routeA.healthScore)
              .map((route) => (
                <RouteRow key={route.id} route={route} />
              ))}
          </div>
        ) : (
          <div className="route-filter-empty" role="status">
            <strong>此筛选条件下没有线路</strong>
            <p>选择“全部线路”查看完整列表，或导入新的管理入口。</p>
          </div>
        )}
      </section>
    </div>
  );
}
