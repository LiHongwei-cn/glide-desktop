import {
  ExternalLink,
  Plus,
  RefreshCw,
  ServerCog,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { RouteRow } from "@/components/RouteRow";
import { Badge, Button, Dialog } from "@/components/ui";
import type {
  AdminInspection,
  AppPage,
  ConnectionGroup,
  RouteCandidate,
} from "@/domain/models";
import {
  maximumAdminEndpointLength,
  maximumSecretLength,
  validateSecretInput,
} from "@/domain/validation";
import {
  inspectAdminDeployment,
  openAdminEndpoint,
  refreshAdminDeployment,
  storeSecret,
  userFacingDesktopError,
  validateAdminEndpointOnDesktop,
} from "@/services/desktop";

export function RoutesPage({
  group,
  onApplyAdminInspection,
  onNavigate,
  onRemoveRoute,
}: {
  group: ConnectionGroup;
  onApplyAdminInspection: (
    routeId: string,
    inspection: AdminInspection,
    credentialReference?: string,
    adminEndpoint?: string,
  ) => void;
  onNavigate: (page: AppPage) => void;
  onRemoveRoute: (routeId: string) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [managementError, setManagementError] = useState("");
  const [managementInspection, setManagementInspection] =
    useState<AdminInspection | null>(null);
  const [managementEndpoint, setManagementEndpoint] = useState("");
  const [managementLoading, setManagementLoading] = useState(false);
  const [managementPassword, setManagementPassword] = useState("");
  const [managementRepairing, setManagementRepairing] = useState(false);
  const [pendingManagement, setPendingManagement] =
    useState<RouteCandidate | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<RouteCandidate | null>(null);
  const [removing, setRemoving] = useState(false);
  const requiresCredentialInput =
    !pendingManagement?.credentialReference || managementRepairing;

  async function confirmRemoval() {
    if (!pendingRemoval) {
      return;
    }
    setError("");
    setRemoving(true);
    try {
      await onRemoveRoute(pendingRemoval.id);
      setPendingRemoval(null);
    } catch {
      setError("无法清理 Glide 本机加密目录，连接记录尚未移除。");
    } finally {
      setRemoving(false);
    }
  }

  async function openManagement(route: RouteCandidate) {
    setPendingManagement(route);
    setManagementInspection(null);
    setManagementError("");
    setManagementEndpoint(route.adminEndpoint ?? "");
    setManagementPassword("");
    setManagementRepairing(false);
    if (route.credentialReference) {
      await refreshManagement(route);
    }
  }

  async function refreshManagement(route = pendingManagement) {
    if (!route?.adminEndpoint || !route.credentialReference) {
      setManagementError("请先连接这条旧线路的管理后台。");
      return;
    }
    setManagementError("");
    setManagementLoading(true);
    try {
      const inspection = await refreshAdminDeployment(
        route.adminEndpoint,
        route.credentialReference,
      );
      setManagementInspection(inspection);
      setManagementRepairing(false);
      onApplyAdminInspection(route.id, inspection);
    } catch (refreshError) {
      const message = userFacingDesktopError(
        refreshError,
        "无法登录并读取管理配置。",
      );
      setManagementError(message);
      setManagementRepairing(shouldRepairCredential(message));
    } finally {
      setManagementLoading(false);
    }
  }

  async function connectLegacyManagement() {
    if (!pendingManagement) {
      return;
    }
    setManagementError("");
    setManagementLoading(true);
    try {
      validateSecretInput(managementPassword, "管理员密码");
      const endpoint =
        await validateAdminEndpointOnDesktop(managementEndpoint);
      if (
        group.routes.some(
          (route) =>
            route.id !== pendingManagement.id &&
            route.adminEndpoint === endpoint,
        )
      ) {
        throw new Error("这个管理入口已被另一条线路使用。");
      }
      const credentialReference = `legacy-admin:${pendingManagement.id}`;
      const inspection = await inspectAdminDeployment(
        endpoint,
        managementPassword,
      );
      await storeSecret(credentialReference, managementPassword);
      setManagementInspection(inspection);
      setManagementPassword("");
      setManagementRepairing(false);
      setPendingManagement({
        ...pendingManagement,
        adminEndpoint: endpoint,
        credentialReference,
      });
      onApplyAdminInspection(
        pendingManagement.id,
        inspection,
        credentialReference,
        endpoint,
      );
    } catch (connectionError) {
      setManagementError(
        userFacingDesktopError(connectionError, "无法登录并读取管理配置。"),
      );
    } finally {
      setManagementLoading(false);
    }
  }

  async function openRemoteManagement() {
    if (!pendingManagement?.adminEndpoint) {
      return;
    }
    setManagementError("");
    try {
      await openAdminEndpoint(pendingManagement.adminEndpoint);
    } catch (openError) {
      setManagementError(
        userFacingDesktopError(openError, "无法打开原管理后台。"),
      );
    }
  }

  return (
    <div className="page">
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
        subtitle="读取状态、更新后台密码或移除本机记录。"
        title="连接"
      />

      <section className="panel">
        <div className="panel__header">
          <div>
            <h2>已添加 {group.routes.length} 条</h2>
            <p>点击设置按钮读取最新状态；垃圾桶只移除本机记录。</p>
          </div>
        </div>
        {group.routes.length > 0 ? (
          <div className="route-list route-list--detailed">
            {[...group.routes]
              .sort((routeA, routeB) => routeB.healthScore - routeA.healthScore)
              .map((route) => (
                <RouteRow
                  key={route.id}
                  onManage={(selectedRoute) => void openManagement(selectedRoute)}
                  onRemove={setPendingRemoval}
                  route={route}
                />
              ))}
          </div>
        ) : (
          <div className="route-filter-empty" role="status">
            <strong>还没有连接</strong>
            <p>点击右上角“添加连接”开始。</p>
          </div>
        )}
      </section>

      <Dialog
        description="Glide 会临时登录并只读解析配置，密码和完整配置不会进入本地工作区。"
        onClose={() => {
          if (!managementLoading) {
            setManagementError("");
            setManagementEndpoint("");
            setManagementInspection(null);
            setManagementPassword("");
            setManagementRepairing(false);
            setPendingManagement(null);
          }
        }}
        open={Boolean(pendingManagement)}
        title={pendingManagement ? `管理 ${pendingManagement.displayName}` : "线路管理"}
      >
        <form
          className="management-dialog"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              pendingManagement?.credentialReference &&
              !managementRepairing
            ) {
              void refreshManagement();
            } else {
              void connectLegacyManagement();
            }
          }}
        >
          <div className="management-dialog__status">
            <span>
              {managementInspection ? (
                <ShieldCheck aria-hidden="true" size={22} />
              ) : (
                <ServerCog aria-hidden="true" size={22} />
              )}
            </span>
            <div>
              <strong>
                {managementLoading
                  ? "正在验证管理密码并读取配置…"
                  : managementInspection
                    ? "管理连接已验证"
                    : "尚未读取管理配置"}
              </strong>
              <p>
                {managementInspection
                  ? "cmliu/edgetunnel 适配器 · 本次会话已在读取后丢弃"
                  : "不会修改远程设置。"}
              </p>
            </div>
            <Badge tone={managementInspection ? "positive" : "info"}>
              {managementInspection ? "已认证" : "只读"}
            </Badge>
          </div>

          {managementInspection ? (
            <>
              <div className="management-grid">
                <ManagementMetric
                  label="协议 / 传输"
                  value={`${managementInspection.protocol.toUpperCase()} / ${managementInspection.transport.toUpperCase()}`}
                />
                <ManagementMetric
                  label="候选入口"
                  value={managementInspection.preferredEndpointCount}
                />
                <ManagementMetric
                  label="指定端口"
                  value={managementInspection.specifiedPort || "随机"}
                />
                <ManagementMetric
                  label="订阅状态"
                  value={managementInspection.subscriptionReady ? "已生成" : "未生成"}
                />
                <ManagementMetric
                  label="读取耗时"
                  value={`${managementInspection.responseTimeMs} ms`}
                />
              </div>
              {managementInspection.skipCertificateVerification ? (
                <p className="management-warning" role="status">
                  <ShieldAlert aria-hidden="true" size={17} />
                  节点配置当前跳过证书验证，建议在确认客户端兼容后关闭。
                </p>
              ) : null}
            </>
          ) : null}

          {!managementInspection && requiresCredentialInput ? (
            <div className="management-reconnect">
              <div>
                <strong>
                  {managementRepairing ? "更新管理凭据" : "连接旧线路"}
                </strong>
                <p>
                  验证成功后更新 Glide 本机加密目录，不删除连接，不修改远端配置。
                </p>
              </div>
              <label className="field">
                <span>管理后台地址</span>
                <input
                  autoCapitalize="none"
                  autoComplete="url"
                  disabled={managementLoading}
                  inputMode="url"
                  maxLength={maximumAdminEndpointLength}
                  onChange={(event) => setManagementEndpoint(event.target.value)}
                  placeholder="https://example.com/admin"
                  spellCheck={false}
                  value={managementEndpoint}
                />
              </label>
              <label className="field">
                <span>管理员密码</span>
                <input
                  autoComplete="current-password"
                  disabled={managementLoading}
                  maxLength={maximumSecretLength}
                  onChange={(event) => setManagementPassword(event.target.value)}
                  placeholder="验证后保存到 Glide 本机加密目录"
                  type="password"
                  value={managementPassword}
                />
              </label>
            </div>
          ) : null}

          {managementError ? (
            <p className="form-error" role="alert">
              {managementError}
            </p>
          ) : null}

          <div className="management-dialog__note">
            <ShieldCheck aria-hidden="true" size={17} />
            <p>
              Glide 兼容标准 Fake-IP，但仍校验原域名证书；需要编辑高级字段时打开原后台，
              浏览器会要求重新登录。
            </p>
          </div>

          <div className="form-actions">
            <Button
              disabled={managementLoading || !pendingManagement?.adminEndpoint}
              icon={<ExternalLink aria-hidden="true" size={16} />}
              onClick={() => void openRemoteManagement()}
            >
              打开原管理后台
            </Button>
            <Button
              disabled={
                managementLoading ||
                (requiresCredentialInput &&
                  (!managementEndpoint || !managementPassword))
              }
              icon={<RefreshCw aria-hidden="true" size={16} />}
              type="submit"
              variant="primary"
            >
              {managementLoading
                ? "正在读取…"
                : pendingManagement?.credentialReference && !managementRepairing
                  ? "重新读取"
                  : managementRepairing
                    ? "验证并更新"
                    : "验证并保存"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        description="此操作会同时删除 Glide 在本机加密目录中保存的对应管理密码。"
        onClose={() => {
          if (!removing) {
            setError("");
            setPendingRemoval(null);
          }
        }}
        open={Boolean(pendingRemoval)}
        title="移除这条线路？"
      >
        <div className="confirmation-content">
          <ShieldAlert aria-hidden="true" size={28} />
          <p>
            将从本机移除“{pendingRemoval?.displayName}”及其本地凭据，不会修改远端服务器。
          </p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <Button disabled={removing} onClick={() => setPendingRemoval(null)}>
              取消
            </Button>
            <Button
              disabled={removing}
              onClick={() => void confirmRemoval()}
              variant="danger"
            >
              {removing ? "正在安全移除…" : "移除本机线路"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function shouldRepairCredential(message: string): boolean {
  return ["密码", "凭据", "管理会话被拒绝"].some((keyword) =>
    message.includes(keyword),
  );
}

function ManagementMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
