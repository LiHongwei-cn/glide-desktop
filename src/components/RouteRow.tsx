import { Check, CircleHelp, Settings2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui";
import { getRegionName } from "@/domain/health";
import type { RouteCandidate } from "@/domain/models";

export function RouteRow({
  onManage,
  onRemove,
  route,
}: {
  onManage?: (route: RouteCandidate) => void;
  onRemove?: (route: RouteCandidate) => void;
  route: RouteCandidate;
}) {
  const connected = route.managementState === "connected";

  return (
    <article className="route-row">
      <div className="route-row__identity">
        <span
          aria-hidden="true"
          className={`region-mark region-mark--${route.configuredRegion}`}
        />
        <div>
          <strong>{route.displayName}</strong>
          <span>{route.endpointLabel}</span>
        </div>
      </div>
      <Badge tone={connected ? "positive" : "warning"}>
        {connected ? (
          <Check aria-hidden="true" size={12} />
        ) : (
          <CircleHelp aria-hidden="true" size={12} />
        )}
        {connected ? "后台可读" : "需要检查"}
      </Badge>
      <div className="route-row__metric">
        <strong>{getRegionName(route.configuredRegion)}</strong>
        <span>节点</span>
      </div>
      <div className="route-row__metric">
        <strong>{route.subscriptionReady === false ? "未生成" : "可生成"}</strong>
        <span>订阅</span>
      </div>
      {onManage ? (
        <button
          aria-label={`管理连接 ${route.displayName}`}
          className="icon-button route-row__manage"
          onClick={() => onManage(route)}
          title="读取连接状态"
          type="button"
        >
          <Settings2 aria-hidden="true" size={15} />
        </button>
      ) : null}
      {onRemove ? (
        <button
          aria-label={`移除连接 ${route.displayName}`}
          className="icon-button icon-button--danger route-row__remove"
          onClick={() => onRemove(route)}
          title="移除连接"
          type="button"
        >
          <Trash2 aria-hidden="true" size={15} />
        </button>
      ) : null}
    </article>
  );
}
