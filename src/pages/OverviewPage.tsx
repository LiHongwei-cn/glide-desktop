import { HardDrive, Plus, ShieldCheck } from "lucide-react";

import { LineSelectionPanel } from "@/components/LineSelectionPanel";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui";
import type {
  AppPage,
  ConnectionGroup,
  PreparedSubscriptionNode,
  PreparedSubscription,
  RouteOptimizationResult,
} from "@/domain/models";

interface OverviewPageProps {
  group: ConnectionGroup;
  onNavigate: (page: AppPage) => void;
  onOptimize: () => Promise<RouteOptimizationResult>;
  onPrepare: (routeId: string) => Promise<PreparedSubscription>;
  onPrepareNode: (
    routeId: string,
    nodeId: string,
  ) => Promise<PreparedSubscriptionNode>;
  onSaveCredential: (secret: string) => Promise<void>;
  onSelectRegion: (region: ConnectionGroup["preferredRegion"]) => void;
  onSelectRoute: (routeId: string) => void;
}

export function OverviewPage({
  group,
  onNavigate,
  onOptimize,
  onPrepare,
  onPrepareNode,
  onSaveCredential,
  onSelectRegion,
  onSelectRoute,
}: OverviewPageProps) {
  return (
    <div className="page page--compact">
      <PageHeader
        actions={
          <Button
            icon={<Plus aria-hidden="true" size={16} />}
            onClick={() => onNavigate("setup")}
            variant="primary"
          >
            添加连接
          </Button>
        }
        eyebrow="本机运行 · 不上传个人信息"
        subtitle="点击一次完成检测、选择和真实订阅验证。"
        title="我的连接"
      />

      <LineSelectionPanel
        group={group}
        onOpenClients={() => onNavigate("clients")}
        onOptimize={onOptimize}
        onPrepare={onPrepare}
        onPrepareNode={onPrepareNode}
        onSaveCredential={onSaveCredential}
        onSelect={onSelectRoute}
        onSelectRegion={onSelectRegion}
      />

      {group.routes.length === 0 ? (
        <section className="home-empty panel">
          <span>
            <HardDrive aria-hidden="true" size={26} />
          </span>
          <div>
            <h2>先添加你的管理地址</h2>
            <p>只需名称、后台地址和后台密码。验证成功后，Glide 会记住并自动调用。</p>
          </div>
          <Button onClick={() => onNavigate("setup")} variant="primary">
            添加第一条连接
          </Button>
        </section>
      ) : (
        <section aria-label="使用步骤" className="simple-flow">
          <span>
            <strong>1</strong>
            选择并验证线路
          </span>
          <span>
            <strong>2</strong>
            按标签选择节点
          </span>
          <span>
            <strong>3</strong>
            复制到客户端连接
          </span>
        </section>
      )}

      <footer className="home-privacy">
        <ShieldCheck aria-hidden="true" size={16} />
        <span>后台密码保存在 Glide 本机加密目录；不读取，也不再要求电脑登录密码。</span>
      </footer>
    </div>
  );
}
