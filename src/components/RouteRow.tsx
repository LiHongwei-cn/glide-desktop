import {
  ArrowRight,
  CircleHelp,
  LoaderCircle,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui";
import { getRegionName, getVerificationLabel } from "@/domain/health";
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
  const verificationTone =
    route.regionVerification === "verified"
      ? "positive"
      : route.regionVerification === "conflict"
        ? "critical"
        : "warning";
  const credentialPresentation = {
    "at-risk": {
      className: "route-row__credential--critical",
      icon: ShieldAlert,
      label: "共享凭据",
    },
    healthy: {
      className: "route-row__credential--positive",
      icon: ShieldCheck,
      label: "凭据独立",
    },
    rotating: {
      className: "route-row__credential--warning",
      icon: LoaderCircle,
      label: "正在轮换",
    },
    unverified: {
      className: "route-row__credential--neutral",
      icon: CircleHelp,
      label: "凭据待验证",
    },
  }[route.credentialState];
  const CredentialIcon = credentialPresentation.icon;

  return (
    <article className="route-row">
      <div className="route-row__identity">
        <span aria-hidden="true" className={`region-mark region-mark--${route.configuredRegion}`} />
        <div>
          <strong>{route.displayName}</strong>
          <span>{route.endpointLabel}</span>
        </div>
      </div>
      <div className="route-row__region">
        <span>{getRegionName(route.configuredRegion)}</span>
        <ArrowRight aria-hidden="true" size={14} />
        <span>{getRegionName(route.observedRegion)}</span>
      </div>
      <Badge tone={verificationTone}>{getVerificationLabel(route.regionVerification)}</Badge>
      <div className="route-row__metric">
        <strong>{route.healthScore}</strong>
        <span>健康度</span>
      </div>
      <div className="route-row__metric">
        <strong>{route.preferredIpCount}</strong>
        <span>候选入口</span>
      </div>
      <div
        className={`route-row__credential ${credentialPresentation.className}`}
      >
        <CredentialIcon aria-hidden="true" size={15} />
        <span>
          {route.managementState === "connected"
            ? "管理已连接"
            : credentialPresentation.label}
        </span>
      </div>
      {onManage ? (
        <button
          aria-label={`管理线路 ${route.displayName}`}
          className="icon-button route-row__manage"
          onClick={() => onManage(route)}
          title="读取管理信息"
          type="button"
        >
          <Settings2 aria-hidden="true" size={15} />
        </button>
      ) : null}
      {onRemove ? (
        <button
          aria-label={`移除线路 ${route.displayName}`}
          className="icon-button icon-button--danger route-row__remove"
          onClick={() => onRemove(route)}
          title="移除线路"
          type="button"
        >
          <Trash2 aria-hidden="true" size={15} />
        </button>
      ) : null}
    </article>
  );
}
