import {
  ArrowRight,
  BadgeCheck,
  Check,
  Circle,
  Gauge,
  HardDrive,
  Laptop,
  LockKeyhole,
  Play,
  RotateCw,
  ShieldAlert,
  Waypoints,
} from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Badge, Button, HealthRing } from "@/components/ui";
import {
  findCredentialRisks,
  getIndependentCredentialCount,
  getRegionName,
} from "@/domain/health";
import type { AppPage, AppState, ConnectionGroup, RegionCode } from "@/domain/models";
import { getReadinessSteps } from "@/domain/readiness";

interface OverviewPageProps {
  group: ConnectionGroup;
  onNavigate: (page: AppPage) => void;
  onRegionChange: (region: RegionCode) => void;
  state: AppState;
}

const regionChoices: RegionCode[] = ["AUTO", "HK", "JP", "SG", "TW", "US"];

const readinessContent = {
  device: {
    action: "添加设备",
    title: "复制到客户端",
  },
  diagnostic: {
    action: "开始检查",
    title: "检查连接",
  },
  import: {
    action: "添加连接",
    title: "添加线路",
  },
};

export function OverviewPage({
  group,
  onNavigate,
  onRegionChange,
  state,
}: OverviewPageProps) {
  const risks = findCredentialRisks(group.routes);
  const readinessSteps = getReadinessSteps(state);
  const completedSteps = readinessSteps.filter((step) => step.completed).length;
  const nextStep = readinessSteps.find((step) => !step.completed);
  const verifiedRoutes = group.routes.filter(
    (route) => route.regionVerification === "verified",
  ).length;
  const activeDevices = state.devices.filter((device) => device.status === "active").length;
  const independentCredentials = getIndependentCredentialCount(group.routes);
  const ready = completedSteps === readinessSteps.length && risks.length === 0;

  return (
    <div className="page">
      <PageHeader
        actions={
          <Button
            icon={<RotateCw aria-hidden="true" size={16} />}
            onClick={() => onNavigate("diagnostics")}
          >
            快速检查
          </Button>
        }
        eyebrow="数据只留在本机"
        subtitle="添加线路、检查状态、复制订阅。"
        title="连接状态"
      />

      <section className={`hero-card${ready ? "" : " hero-card--warning"}`}>
        <div className="hero-card__content">
          <Badge tone={ready ? "positive" : "warning"}>
            {ready ? "可以使用" : "需要确认"}
          </Badge>
          <h2>
            {ready
              ? `${verifiedRoutes} 条线路已就绪`
              : `${group.routes.length} 条线路，${risks.length} 项风险`}
          </h2>
          <p>
            {ready
              ? "线路、地区和设备均已完成检查。"
              : nextStep
                ? `下一步：${readinessContent[nextStep.id].title}。`
                : "请先处理共享凭据和地区冲突。"}
          </p>
          <div className="hero-card__actions">
            <Button
              icon={<Play aria-hidden="true" size={16} />}
              onClick={() => onNavigate(nextStep?.actionPage ?? "routes")}
              variant="primary"
            >
              {nextStep ? readinessContent[nextStep.id].action : "查看线路"}
            </Button>
            <Button onClick={() => onNavigate("routes")} variant="tertiary">
              线路详情
            </Button>
          </div>
        </div>
        <HealthRing score={group.healthScore} />
      </section>

      <section aria-labelledby="quick-start-heading" className="readiness-card">
        <div className="readiness-card__header">
          <div>
            <h2 id="quick-start-heading">三步开始</h2>
            <p>完成后即可复制订阅到客户端。</p>
          </div>
          <Badge tone={completedSteps === readinessSteps.length ? "positive" : "info"}>
            {completedSteps}/{readinessSteps.length}
          </Badge>
        </div>
        <div className="readiness-steps readiness-steps--compact">
          {readinessSteps.map((step, index) => {
            const content = readinessContent[step.id];
            return (
              <button
                aria-label={`${step.completed ? "已完成" : "未完成"}：${content.title}`}
                className={step.completed ? "is-complete" : ""}
                key={step.id}
                onClick={() => onNavigate(step.actionPage)}
                type="button"
              >
                <span className="readiness-steps__status">
                  {step.completed ? (
                    <Check aria-hidden="true" size={15} />
                  ) : (
                    <Circle aria-hidden="true" size={15} />
                  )}
                </span>
                <span className="readiness-steps__content">
                  <small>步骤 {index + 1}</small>
                  <strong>{content.title}</strong>
                </span>
                <ArrowRight aria-hidden="true" size={15} />
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label="连接摘要" className="summary-grid">
        <SummaryCard icon={Waypoints} label="线路" value={group.routes.length} />
        <SummaryCard icon={BadgeCheck} label="已验证" value={verifiedRoutes} />
        <SummaryCard icon={Laptop} label="设备" value={activeDevices} />
        <SummaryCard icon={HardDrive} label="遥测上传" value="0" />
      </section>

      <section aria-labelledby="region-heading" className="section-block">
        <div className="section-heading">
          <div>
            <h2 id="region-heading">优先地区</h2>
            <p>只影响推荐顺序，不会伪造线路地区。</p>
          </div>
        </div>
        <div className="segmented-control" role="group" aria-label="优先地区">
          {regionChoices.map((region) => (
            <button
              aria-pressed={group.preferredRegion === region}
              className={group.preferredRegion === region ? "is-selected" : ""}
              key={region}
              onClick={() => onRegionChange(region)}
              type="button"
            >
              {getRegionName(region)}
            </button>
          ))}
        </div>
      </section>

      <details className="advanced-details panel">
        <summary>
          <span>
            <ShieldAlert aria-hidden="true" size={18} />
            安全详情
          </span>
          <Badge tone={risks.length > 0 ? "warning" : "positive"}>
            {risks.length > 0 ? `${risks.length} 项待处理` : "无高风险"}
          </Badge>
        </summary>
        <div className="metric-grid">
          <Metric icon={ShieldAlert} label="高风险项" value={risks.length} />
          <Metric icon={Gauge} label="已验证地区" value={verifiedRoutes} />
          <Metric
            icon={LockKeyhole}
            label="独立凭据域"
            value={independentCredentials}
          />
        </div>
        <p>建议为每条线路使用独立密码、节点身份和路径，再进行真实网络检查。</p>
      </details>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ShieldAlert;
  label: string;
  value: number;
}) {
  return (
    <div>
      <Icon aria-hidden="true" size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Waypoints;
  label: string;
  value: number | string;
}) {
  return (
    <div className="summary-card">
      <Icon aria-hidden="true" size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
