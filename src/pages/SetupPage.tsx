import {
  ArrowRight,
  Check,
  Cloud,
  ExternalLink,
  FileSearch,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Badge, Button } from "@/components/ui";
import { getRegionName } from "@/domain/health";
import type {
  AdminInspection,
  AppPage,
  LegacyImportDraft,
  RegionCode,
  RouteCandidate,
} from "@/domain/models";
import {
  maximumAdminEndpointLength,
  maximumDisplayNameLength,
  maximumSecretLength,
  normalizeAdminEndpoint,
  normalizeDisplayName,
  redactEndpoint,
  validateSecretInput,
} from "@/domain/validation";
import {
  inspectAdminDeployment,
  isDesktopRuntime,
  openOfficialUrl,
  storeSecret,
  userFacingDesktopError,
  validateAdminEndpointOnDesktop,
} from "@/services/desktop";

interface SetupPageProps {
  onAddRoute: (route: RouteCandidate) => void;
  onNavigate: (page: AppPage) => void;
  routes: RouteCandidate[];
}

type SetupMode = "create" | "import";
type SetupStatus = "idle" | "inspecting" | "ready" | "saved";

const regionOptions: RegionCode[] = ["HK", "JP", "SG", "TW", "US", "UNKNOWN"];

const emptyDraft: LegacyImportDraft = {
  adminUrl: "",
  configuredRegion: "UNKNOWN",
  displayName: "",
  password: "",
};

export function SetupPage({ onAddRoute, onNavigate, routes }: SetupPageProps) {
  const [adminInspection, setAdminInspection] = useState<AdminInspection | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<LegacyImportDraft>(emptyDraft);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<SetupMode>("import");
  const [status, setStatus] = useState<SetupStatus>("idle");
  const [validatedUrl, setValidatedUrl] = useState("");
  const desktop = isDesktopRuntime();

  const canInspect = useMemo(
    () => Boolean(draft.adminUrl.trim() && draft.displayName.trim() && draft.password),
    [draft],
  );

  async function inspectExistingDeployment() {
    setError("");
    setStatus("inspecting");
    try {
      normalizeDisplayName(draft.displayName, "线路名称");
      validateSecretInput(draft.password, "管理员密码");
      const endpoint = await validateAdminEndpointOnDesktop(draft.adminUrl);
      if (routes.some((route) => route.adminEndpoint === endpoint)) {
        throw new Error("这个管理入口已存在，无需重复导入。");
      }
      const inspection = await inspectAdminDeployment(endpoint, draft.password);
      setAdminInspection(inspection);
      setValidatedUrl(endpoint);
      setStatus("ready");
    } catch (inspectionError) {
      setAdminInspection(null);
      setError(userFacingDesktopError(inspectionError, "只读检查失败，请稍后重试。"));
      setStatus("idle");
    }
  }

  async function confirmImport() {
    setError("");
    setConfirming(true);
    try {
      const endpoint = validatedUrl || normalizeAdminEndpoint(draft.adminUrl).normalizedUrl;
      const displayName = normalizeDisplayName(draft.displayName, "线路名称");
      validateSecretInput(draft.password, "管理员密码");
      if (routes.some((route) => route.adminEndpoint === endpoint)) {
        throw new Error("这个管理入口已存在，无需重复导入。");
      }
      if (!adminInspection?.authenticated) {
        throw new Error("请先验证管理员密码并成功读取配置。");
      }
      const routeId = crypto.randomUUID();
      const credentialReference = `legacy-admin:${routeId}`;
      const credentialGroupId = `node:${adminInspection.credentialFingerprint}`;
      if (desktop) {
        await storeSecret(credentialReference, draft.password);
      }
      onAddRoute({
        adminAdapter: adminInspection.adapter,
        adminEndpoint: endpoint,
        configuredRegion: draft.configuredRegion,
        credentialReference,
        credentialGroupId,
        credentialState: routes.some(
          (route) => route.credentialGroupId === credentialGroupId,
        )
          ? "at-risk"
          : "healthy",
        displayName,
        endpointLabel: `${redactEndpoint(endpoint)} · 已验证管理登录`,
        healthScore: 90,
        id: routeId,
        lastCheckedAt: new Date().toISOString(),
        lastManagedAt: new Date().toISOString(),
        managementState: "connected",
        nodePathGroupId: `path:${adminInspection.nodePathFingerprint}`,
        observedRegion: "UNKNOWN",
        preferredIpCount: adminInspection.preferredEndpointCount,
        protocol: "VLESS",
        regionEvidence: [],
        regionVerification: "unverified",
        status: "active",
        subscriptionReady: adminInspection.subscriptionReady,
        transport: "WebSocket",
        version: adminInspection.configUpdatedAt ?? "已读取",
      });
      setDraft(emptyDraft);
      setAdminInspection(null);
      setStatus("saved");
    } catch (importError) {
      setError(userFacingDesktopError(importError, "导入失败。"));
    } finally {
      setConfirming(false);
    }
  }

  function changeMode(nextMode: SetupMode) {
    setDraft(emptyDraft);
    setAdminInspection(null);
    setError("");
    setMode(nextMode);
    setStatus("idle");
    setValidatedUrl("");
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="密码只进系统钥匙串"
        subtitle="选择一种方式开始。检查通过后再保存。"
        title="添加连接"
      />

      <div className="setup-mode">
        <button
          aria-pressed={mode === "import"}
          className={mode === "import" ? "is-selected" : ""}
          onClick={() => changeMode("import")}
          type="button"
        >
          <FileSearch aria-hidden="true" size={19} />
          <span>
            <strong>导入已有部署</strong>
            <small>已有管理地址</small>
          </span>
        </button>
        <button
          aria-pressed={mode === "create"}
          className={mode === "create" ? "is-selected" : ""}
          onClick={() => changeMode("create")}
          type="button"
        >
          <Sparkles aria-hidden="true" size={19} />
          <span>
            <strong>创建新连接</strong>
            <small>先注册 Cloudflare</small>
          </span>
        </button>
      </div>

      {mode === "import" ? (
        <section className="setup-grid">
          <div className="panel setup-panel">
            <StepIndicator status={status} />

            {status === "saved" ? (
              <div className="success-state">
                <span>
                  <Check aria-hidden="true" size={28} />
                </span>
                <h2>已加入连接组</h2>
                <p>
                  {desktop
                    ? "管理密码已进入系统钥匙串，工作区只保存凭据引用。"
                    : "这是浏览器预览，管理密码没有被保存。"}
                </p>
                <div className="form-actions">
                  <Button onClick={() => setStatus("idle")}>继续导入</Button>
                  <Button
                    onClick={() => onNavigate("diagnostics")}
                    variant="primary"
                  >
                    运行首次检查
                  </Button>
                </div>
              </div>
            ) : status === "ready" ? (
              <ImportReview
                desktop={desktop}
                draft={draft}
                confirming={confirming}
                inspection={adminInspection}
                onBack={() => {
                  setAdminInspection(null);
                  setStatus("idle");
                  setValidatedUrl("");
                }}
                onConfirm={() => void confirmImport()}
                validatedUrl={validatedUrl}
              />
            ) : (
              <form
                className="setup-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void inspectExistingDeployment();
                }}
              >
                <div className="form-heading">
                  <Badge tone="info">只读模式</Badge>
                  <h2>填写连接信息</h2>
                  <p>验证密码并读取配置，不修改线上内容。</p>
                </div>

                <label className="field">
                  <span>线路名称</span>
                  <input
                    autoComplete="off"
                    maxLength={maximumDisplayNameLength}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, displayName: event.target.value }))
                    }
                    placeholder="例如：香港线路"
                    value={draft.displayName}
                  />
                </label>

                <label className="field">
                  <span>预期地区</span>
                  <select
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        configuredRegion: event.target.value as RegionCode,
                      }))
                    }
                    value={draft.configuredRegion}
                  >
                    {regionOptions.map((region) => (
                      <option key={region} value={region}>
                        {getRegionName(region)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>管理后台地址</span>
                  <input
                    autoCapitalize="none"
                    autoComplete="url"
                    inputMode="url"
                    maxLength={maximumAdminEndpointLength}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, adminUrl: event.target.value }))
                    }
                    placeholder="https://example.com/admin"
                    spellCheck={false}
                    value={draft.adminUrl}
                  />
                </label>

                <label className="field">
                  <span>管理员密码</span>
                  <input
                    autoComplete="current-password"
                    maxLength={maximumSecretLength}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, password: event.target.value }))
                    }
                    placeholder="只在内存中临时使用"
                    type="password"
                    value={draft.password}
                  />
                  <small>
                    {desktop
                      ? "确认后保存到系统钥匙串。"
                      : "浏览器预览不会保存密码。"}
                  </small>
                </label>

                {error ? (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                ) : null}

                <Button
                  disabled={!canInspect || status === "inspecting"}
                  icon={<FileSearch aria-hidden="true" size={16} />}
                  type="submit"
                  variant="primary"
                >
                  {status === "inspecting" ? "正在检查…" : "检查连接"}
                </Button>
              </form>
            )}
          </div>

          <aside className="setup-aside">
            <h2>安全说明</h2>
            <SafetyItem
              icon={ShieldCheck}
              text="只允许 HTTPS 公网管理地址"
            />
            <SafetyItem icon={LockKeyhole} text="密码保存在系统钥匙串" />
            <SafetyItem icon={FileSearch} text="真实登录并只读解析配置" />
            <div className="privacy-note">
              <KeyRound aria-hidden="true" size={18} />
              <p>没有遥测。密码、订阅和完整地址不会进入诊断记录。</p>
            </div>
          </aside>
        </section>
      ) : (
        <CreateConnectionPanel />
      )}
    </div>
  );
}

function CreateConnectionPanel() {
  const [openError, setOpenError] = useState("");

  async function openCloudflare(url: string) {
    setOpenError("");
    try {
      await openOfficialUrl(url);
    } catch (error) {
      setOpenError(
        error instanceof Error ? error.message : "无法打开 Cloudflare 官方页面。",
      );
    }
  }

  return (
    <section className="panel oauth-panel">
      <div className="oauth-panel__icon">
        <Cloud aria-hidden="true" size={30} />
      </div>
      <Badge tone="info">OAuth + PKCE</Badge>
      <h2>注册 Cloudflare</h2>
      <p>
        账号和密码只填写在 Cloudflare 官方页面。自动部署需要后续配置正式 OAuth。
      </p>
      <ol className="oauth-steps">
        <li>
          <span>1</span>
          <div>
            <strong>注册或登录</strong>
            <p>只使用 Cloudflare 官方页面。</p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <strong>选择最小权限</strong>
            <p>只授权部署需要的资源。</p>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <strong>确认后再创建</strong>
            <p>执行前显示所有变更。</p>
          </div>
        </li>
      </ol>
      <div className="permission-list">
        <span>
          <Check aria-hidden="true" size={15} />
          不申请账单权限
        </span>
        <span>
          <Check aria-hidden="true" size={15} />
          不使用全局 API Key
        </span>
      </div>
      <div className="form-actions">
        <Button
          icon={<ExternalLink aria-hidden="true" size={16} />}
          onClick={() => void openCloudflare("https://dash.cloudflare.com/sign-up")}
          variant="primary"
        >
          打开官方注册页
        </Button>
        <Button
          icon={<ExternalLink aria-hidden="true" size={16} />}
          onClick={() => void openCloudflare("https://dash.cloudflare.com/")}
        >
          已有账号，打开控制台
        </Button>
      </div>
      {openError ? (
        <p className="form-error" role="alert">
          {openError}
        </p>
      ) : null}
      <small>自动部署按钮会在 OAuth Client ID 与回调地址完成正式配置后开放。</small>
    </section>
  );
}

function ImportReview({
  confirming,
  desktop,
  draft,
  inspection,
  onBack,
  onConfirm,
  validatedUrl,
}: {
  confirming: boolean;
  desktop: boolean;
  draft: LegacyImportDraft;
  inspection: AdminInspection | null;
  onBack: () => void;
  onConfirm: () => void;
  validatedUrl: string;
}) {
  return (
    <div className="import-review">
      <Badge tone="positive">登录与配置读取通过</Badge>
      <h2>确认导入范围</h2>
      <div className="review-list">
        <ReviewRow label="线路名称" value={draft.displayName} />
        <ReviewRow label="预期地区" value={getRegionName(draft.configuredRegion)} />
        <ReviewRow label="管理地址" value={redactEndpoint(validatedUrl)} />
        <ReviewRow
          label="面板适配"
          value={inspection ? "cmliu/edgetunnel · 已认证" : "待验证"}
        />
        <ReviewRow
          label="协议"
          value={inspection?.protocol.toUpperCase() ?? "待识别"}
        />
        <ReviewRow
          label="传输"
          value={inspection?.transport.toUpperCase() ?? "待识别"}
        />
        <ReviewRow
          label="配置读取"
          value={
            inspection
              ? `${inspection.hostCount} 个域名 · ${inspection.responseTimeMs} ms`
              : "待读取"
          }
        />
        <ReviewRow
          label="订阅"
          value={inspection?.subscriptionReady ? "已生成" : "尚未生成"}
        />
        <ReviewRow
          label="密码处理"
          value={desktop ? "保存到系统钥匙串" : "预览模式，不保存"}
        />
        <ReviewRow label="线上变更" value="无，只读导入" />
      </div>
      <div className="review-warning">
        <ShieldCheck aria-hidden="true" size={18} />
        <p>
          {inspection?.skipCertificateVerification
            ? "检测到节点配置跳过证书验证，导入后会保留安全警告。"
            : "远程配置只读导入；任何后续修改都会单独确认。"}
        </p>
      </div>
      <div className="form-actions">
        <Button disabled={confirming} onClick={onBack}>
          返回修改
        </Button>
        <Button
          disabled={confirming}
          icon={<ArrowRight aria-hidden="true" size={16} />}
          onClick={onConfirm}
          variant="primary"
        >
          {confirming ? "正在安全保存…" : "确认导入"}
        </Button>
      </div>
    </div>
  );
}

function StepIndicator({ status }: { status: SetupStatus }) {
  const currentStep = status === "saved" ? 3 : status === "ready" ? 2 : 1;
  const labels = ["连接信息", "确认范围", "导入完成"];

  return (
    <div aria-label="导入进度" className="step-indicator" role="list">
      {labels.map((label, index) => {
        const step = index + 1;
        const isCurrent = step === currentStep;
        return (
          <span
            aria-current={isCurrent ? "step" : undefined}
            className={
              isCurrent ? "is-current" : step < currentStep ? "is-complete" : ""
            }
            key={label}
            role="listitem"
          >
            {step < currentStep ? <Check aria-hidden="true" size={13} /> : step}
          </span>
        );
      })}
      <p>
        步骤 {currentStep}/3 · {labels[currentStep - 1]}
      </p>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SafetyItem({ icon: Icon, text }: { icon: typeof ShieldCheck; text: string }) {
  return (
    <div className="safety-item">
      <span>
        <Icon aria-hidden="true" size={17} />
      </span>
      <p>{text}</p>
    </div>
  );
}
