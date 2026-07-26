import { ArrowRight, CircleHelp, LoaderCircle, ShieldAlert, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui";
import { getRegionName, getVerificationLabel } from "@/domain/health";
import type { RouteCandidate } from "@/domain/models";

export function RouteRow({ route }: { route: RouteCandidate }) {
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
        <span>{credentialPresentation.label}</span>
      </div>
    </article>
  );
}
