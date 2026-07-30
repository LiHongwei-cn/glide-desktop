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
import { useEffect, useMemo, useRef, useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Badge, Button } from "@/components/ui";
import { getRegionName } from "@/domain/health";
import type {
  AdminInspection,
  AppPage,
  CloudflareAccount,
  CloudflareDeploymentPlan,
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
  authorizeCloudflare,
  cancelCloudflareOAuth,
  completeCloudflareOAuth,
  createCloudflareDeploymentPlan,
  deleteSecret,
  deployCloudflareConnection,
  getCloudflareOAuthConfiguration,
  inspectAdminDeployment,
  isDesktopRuntime,
  openOfficialUrl,
  startCloudflareOAuth,
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
        eyebrow="密码只进 Glide 本机加密目录"
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
                    ? "管理密码已进入 Glide 本机加密目录，工作区只保存引用。"
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
                  <span>线路标签地区（可选）</span>
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
                      ? "确认后保存到 Glide 本机加密目录，不再要求电脑密码。"
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
            <SafetyItem icon={LockKeyhole} text="密码保存在 Glide 本机加密目录" />
            <SafetyItem icon={FileSearch} text="真实登录并只读解析配置" />
            <div className="privacy-note">
              <KeyRound aria-hidden="true" size={18} />
              <p>没有遥测。密码、订阅和完整地址不会进入诊断记录。</p>
            </div>
          </aside>
        </section>
      ) : (
        <CreateConnectionPanel
          onAddRoute={onAddRoute}
          onNavigate={onNavigate}
          routes={routes}
        />
      )}
    </div>
  );
}

type CreationStatus =
  | "authorizing"
  | "configuring"
  | "deploying"
  | "idle"
  | "planning"
  | "ready"
  | "saved";

interface CreationVerification {
  nodeCount: number;
  regions: RegionCode[];
  responseTimeMs: number;
}

function CreateConnectionPanel({
  onAddRoute,
  onNavigate,
  routes,
}: SetupPageProps) {
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<CloudflareAccount[]>([]);
  const [advancedTokenOpen, setAdvancedTokenOpen] = useState(false);
  const [authorizationReference, setAuthorizationReference] = useState("");
  const [createdCount, setCreatedCount] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [latestVerification, setLatestVerification] =
    useState<CreationVerification | null>(null);
  const [plan, setPlan] = useState<CloudflareDeploymentPlan | null>(null);
  const [oauthConfiguration, setOauthConfiguration] = useState<{
    available: boolean;
    setupMessage: string;
  } | null>(null);
  const [status, setStatus] = useState<CreationStatus>("idle");
  const [token, setToken] = useState("");
  const authorizationReferenceRef = useRef("");
  const oauthFlowIdRef = useRef("");
  const desktop = isDesktopRuntime();

  const canAuthorize = desktop && token.trim().length >= 20;
  const canPlan = Boolean(
    accountId && authorizationReference && displayName.trim(),
  );

  useEffect(() => {
    let active = true;
    void getCloudflareOAuthConfiguration()
      .then((configuration) => {
        if (active) {
          setOauthConfiguration(configuration);
          setAdvancedTokenOpen(!configuration.available);
        }
      })
      .catch(() => {
        if (active) {
          setOauthConfiguration({
            available: false,
            setupMessage: "无法读取一键登录配置，请使用高级 Token 方式。",
          });
          setAdvancedTokenOpen(true);
        }
      });
    return () => {
      active = false;
      if (oauthFlowIdRef.current) {
        void cancelCloudflareOAuth(oauthFlowIdRef.current);
      }
      if (authorizationReferenceRef.current) {
        void deleteSecret(authorizationReferenceRef.current);
      }
    };
  }, []);

  function clearAuthorizationReference() {
    authorizationReferenceRef.current = "";
    setAuthorizationReference("");
  }

  function retainAuthorizationReference(reference: string) {
    authorizationReferenceRef.current = reference;
    setAuthorizationReference(reference);
  }

  async function openCloudflare(url: string) {
    setError("");
    try {
      await openOfficialUrl(url);
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : "无法打开 Cloudflare 官方页面。",
      );
    }
  }

  async function authorize() {
    setError("");
    setStatus("authorizing");
    const submittedToken = token.trim();
    setToken("");
    try {
      const authorization = await authorizeCloudflare(submittedToken);
      acceptAuthorization(authorization);
    } catch (authorizationError) {
      setError(
        userFacingDesktopError(
          authorizationError,
          "Cloudflare 授权验证失败，请检查 Token 权限。",
        ),
      );
      setStatus("idle");
    }
  }

  function acceptAuthorization(authorization: {
    accounts: CloudflareAccount[];
    credentialReference: string;
  }) {
    setAccounts(authorization.accounts);
    setAccountId(authorization.accounts[0]?.id ?? "");
    retainAuthorizationReference(authorization.credentialReference);
    setStatus("configuring");
  }

  async function authorizeWithOAuth() {
    setError("");
    setStatus("authorizing");
    try {
      const oauth = await startCloudflareOAuth();
      oauthFlowIdRef.current = oauth.flowId;
      try {
        await openOfficialUrl(oauth.authorizationUrl);
      } catch (openError) {
        await cancelCloudflareOAuth(oauth.flowId);
        throw openError;
      }
      const authorization = await completeCloudflareOAuth(oauth.flowId);
      oauthFlowIdRef.current = "";
      acceptAuthorization(authorization);
    } catch (authorizationError) {
      oauthFlowIdRef.current = "";
      setError(
        userFacingDesktopError(
          authorizationError,
          "Cloudflare 登录未完成，请重新尝试。",
        ),
      );
      setStatus("idle");
    }
  }

  async function createPlan() {
    setError("");
    setPlan(null);
    setStatus("planning");
    try {
      const normalizedName = normalizeDisplayName(displayName, "连接名称");
      const deploymentPlan = await createCloudflareDeploymentPlan(
        accountId,
        authorizationReference,
        normalizedName,
      );
      if (
        routes.some(
          (route) => route.adminEndpoint === deploymentPlan.endpointPreview,
        )
      ) {
        throw new Error("这个连接已经在 Glide 中，请直接前往线路页使用。");
      }
      setDisplayName(normalizedName);
      setPlan(deploymentPlan);
      setStatus("ready");
    } catch (planError) {
      setError(
        userFacingDesktopError(planError, "无法生成部署计划，请稍后重试。"),
      );
      setStatus("configuring");
    }
  }

  async function deploy() {
    if (!plan) {
      return;
    }
    setError("");
    setStatus("deploying");
    try {
      const deployment = await deployCloudflareConnection(
        plan.accountId,
        plan.authorizationReference,
        plan.displayName,
        plan.planHash,
      );
      if (
        routes.some(
          (route) => route.adminEndpoint === deployment.adminEndpoint,
        )
      ) {
        throw new Error("这个连接已经在 Glide 中，无需重复添加。");
      }
      const routeId = crypto.randomUUID();
      const credentialGroupId = `node:${deployment.inspection.credentialFingerprint}`;
      onAddRoute({
        adminAdapter: deployment.inspection.adapter,
        adminEndpoint: deployment.adminEndpoint,
        configuredRegion: "UNKNOWN",
        credentialGroupId,
        credentialReference: deployment.credentialReference,
        credentialState: routes.some(
          (route) => route.credentialGroupId === credentialGroupId,
        )
          ? "at-risk"
          : "healthy",
        displayName: plan.displayName,
        endpointLabel: `${redactEndpoint(deployment.adminEndpoint)} · 自动创建并验证`,
        healthScore: 94,
        id: routeId,
        lastCheckedAt: new Date().toISOString(),
        lastManagedAt: new Date().toISOString(),
        managementState: "connected",
        nodePathGroupId: `path:${deployment.inspection.nodePathFingerprint}`,
        observedRegion: "UNKNOWN",
        preferredIpCount: deployment.inspection.preferredEndpointCount,
        protocol: "VLESS",
        regionEvidence: [],
        regionVerification: "unverified",
        status: "active",
        subscriptionReady: deployment.inspection.subscriptionReady,
        transport: "WebSocket",
        version: deployment.inspection.configUpdatedAt ?? "已创建",
      });
      const verifiedRegions = [
        ...new Set(deployment.subscription.nodes.map((node) => node.region)),
      ];
      setLatestVerification({
        nodeCount: deployment.subscription.nodes.length,
        regions: verifiedRegions,
        responseTimeMs: deployment.subscription.responseTimeMs,
      });
      setCreatedCount((count) => count + 1);
      setStatus("saved");
    } catch (deploymentError) {
      setError(
        userFacingDesktopError(
          deploymentError,
          "创建失败；未完成的本次新建资源将自动回滚。",
        ),
      );
      setStatus("ready");
    }
  }

  function resetPlan() {
    setError("");
    setPlan(null);
    setStatus("configuring");
  }

  function createAnother() {
    setDisplayName("");
    setError("");
    setLatestVerification(null);
    setPlan(null);
    setStatus("configuring");
  }

  async function finishCreation(page: AppPage) {
    setError("");
    try {
      await deleteSecret(authorizationReference);
      clearAuthorizationReference();
      onNavigate(page);
    } catch (deletionError) {
      setError(
        userFacingDesktopError(
          deletionError,
          "临时授权删除失败，请关闭 Glide 并在 Cloudflare 控制台撤销 Token。",
        ),
      );
    }
  }

  async function cancelAuthorization() {
    setError("");
    try {
      await deleteSecret(authorizationReference);
      setAccountId("");
      setAccounts([]);
      clearAuthorizationReference();
      setDisplayName("");
      setPlan(null);
      setStatus("idle");
    } catch (deletionError) {
      setError(
        userFacingDesktopError(
          deletionError,
          "未能删除临时授权，请在 Cloudflare 控制台撤销该 Token。",
        ),
      );
    }
  }

  if (status === "saved") {
    return (
      <section className="panel create-panel create-panel--centered">
        <div className="success-state create-success">
          <span>
            <Check aria-hidden="true" size={28} />
          </span>
          <Badge tone="positive">云端与本机验证通过</Badge>
          <h2>当前网络验证通过</h2>
          <p>
            已成功创建并验证 {createdCount} 条线路。一次授权可以连续创建，
            无需重复登录；完成后会立即删除本机内存副本。
          </p>
          {latestVerification ? (
            <div className="permission-card">
              <strong>本次线路三项验收通过</strong>
              <span>后台登录 · 通过</span>
              <span>真实订阅 · {latestVerification.responseTimeMs} ms</span>
              <span>可选节点 · {latestVerification.nodeCount} 个</span>
              <span>
                节点标签 ·{" "}
                {latestVerification.regions.map(getRegionName).join("、")}
              </span>
              <small>真实隧道出口仍需导入客户端后测试。</small>
            </div>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <Button onClick={createAnother}>
              继续创建第 {createdCount + 1} 条
            </Button>
            <Button onClick={() => void finishCreation("routes")}>完成并查看线路</Button>
            <Button
              onClick={() => void finishCreation("overview")}
              variant="primary"
            >
              完成并返回首页
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel create-panel">
      <header className="create-panel__header">
        <div className="oauth-panel__icon">
          <Cloud aria-hidden="true" size={28} />
        </div>
        <div>
          <Badge tone="info">本地安全创建 Beta</Badge>
          <h2>创建新连接</h2>
          <p>注册由你完成，Glide 只在明确确认后创建自己的资源。</p>
        </div>
        <CreationProgress status={status} />
      </header>

      {!authorizationReference ? (
        <div className="create-step">
          <div className="create-step__intro">
            <h3>1. 登录 Cloudflare</h3>
            <p>注册完成后点一次登录并确认权限，Glide 不会看到你的账号密码。</p>
          </div>
          <div className="official-actions">
            <Button
              icon={<ExternalLink aria-hidden="true" size={16} />}
              onClick={() =>
                void openCloudflare("https://dash.cloudflare.com/sign-up")
              }
            >
              注册 Cloudflare
            </Button>
          </div>
          <Button
            disabled={
              !desktop ||
              !oauthConfiguration?.available ||
              status === "authorizing"
            }
            icon={<Cloud aria-hidden="true" size={16} />}
            onClick={() => void authorizeWithOAuth()}
            variant="primary"
          >
            {status === "authorizing"
              ? "请在浏览器完成授权…"
              : "使用 Cloudflare 登录"}
          </Button>
          <p className="oauth-status" role="status">
            {oauthConfiguration?.setupMessage ?? "正在检查一键登录配置…"}
          </p>

          <details
            className="advanced-auth"
            onToggle={(event) => setAdvancedTokenOpen(event.currentTarget.open)}
            open={advancedTokenOpen}
          >
            <summary>高级方式：使用 API Token</summary>
            <div className="advanced-auth__content">
              <p>
                仅在一键登录不可用或你明确需要自管授权时使用。不要填写账号密码或
                Global API Key。
              </p>
              <Button
                icon={<ExternalLink aria-hidden="true" size={16} />}
                onClick={() =>
                  void openCloudflare(
                    "https://dash.cloudflare.com/profile/api-tokens",
                  )
                }
              >
                创建最小权限 Token
              </Button>
              <div className="permission-card">
                <strong>只需要 3 项权限</strong>
                <span>账户设置 · 读取</span>
                <span>Workers Scripts · 编辑</span>
                <span>Workers KV Storage · 编辑</span>
                <span>有效期 · 建议 1 天</span>
              </div>
              <label className="field">
                <span>API Token</span>
                <input
                  autoCapitalize="none"
                  autoComplete="new-password"
                  disabled={!desktop || status === "authorizing"}
                  maxLength={maximumSecretLength}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={
                    desktop ? "仅在本次创建会话的内存中使用" : "请在桌面应用中完成"
                  }
                  spellCheck={false}
                  type="password"
                  value={token}
                />
                <small>只发送到 Cloudflare 官方 API，不写入工作区或日志。</small>
              </label>
              <Button
                disabled={!canAuthorize || status === "authorizing"}
                onClick={() => void authorize()}
              >
                {status === "authorizing" ? "正在验证授权…" : "验证 Token 并继续"}
              </Button>
            </div>
          </details>
        </div>
      ) : status === "ready" || status === "deploying" ? (
        <div className="create-step">
          <div className="create-step__intro">
            <Badge tone="positive">授权与资源检查通过</Badge>
            <h3>3. 确认创建范围</h3>
            <p>Glide 会再次核对计划；云端状态变化时会要求重新确认。</p>
          </div>
          <div className="deployment-summary">
            <ReviewRow label="Cloudflare 账号" value={plan?.accountName ?? "—"} />
            <ReviewRow label="连接名称" value={plan?.displayName ?? "—"} />
            <ReviewRow
              label="部署入口"
              value={plan ? redactEndpoint(plan.endpointPreview) : "—"}
            />
          </div>
          <div className="deployment-actions">
            {plan?.actions.map((action) => (
              <div key={`${action.label}-${action.resource}`}>
                <Check aria-hidden="true" size={16} />
                <span>
                  <strong>{action.label}</strong>
                  <small>{deploymentActionLabel(action.action)}</small>
                </span>
                <code>{action.resource}</code>
              </div>
            ))}
          </div>
          <div className="review-warning">
            <ShieldCheck aria-hidden="true" size={18} />
            <p>
              使用锁定版本 {plan?.sourceCommit.slice(0, 10)}；不读取账单、不删除已有资源。
              如果验证失败，将回滚本次 Worker 和配置存储
              {plan?.actions.some(
                (action) =>
                  action.label === "公共子域" && action.action === "create",
              )
                ? "；账号级公共子域会安全保留"
                : ""}
              。
            </p>
          </div>
          <div className="form-actions">
            <Button disabled={status === "deploying"} onClick={resetPlan}>
              返回修改
            </Button>
            <Button
              disabled={!plan || status === "deploying"}
              onClick={() => void deploy()}
              variant="primary"
            >
              {status === "deploying"
                ? "正在创建并验证，约 1 分钟…"
                : "确认并创建"}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="create-step"
          onSubmit={(event) => {
            event.preventDefault();
            void createPlan();
          }}
        >
          <div className="create-step__intro">
            <Badge tone="positive">授权已安全保存</Badge>
            <h3>2. 为这条线路命名</h3>
            <p>
              Cloudflare Worker 是全球线路入口；创建后可以按订阅标签选择节点，真实出口需在客户端验收。
            </p>
          </div>
          <label className="field">
            <span>Cloudflare 账号</span>
            <select
              onChange={(event) => setAccountId(event.target.value)}
              value={accountId}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>连接名称</span>
            <input
              autoComplete="off"
              maxLength={maximumDisplayNameLength}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="例如：我的私人连接"
              value={displayName}
            />
          </label>
          <div className="review-warning">
            <ShieldCheck aria-hidden="true" size={18} />
            <p>
              当前创建的是 workers.dev 试用入口。Glide 会在创建后实测当前网络，但不能保证它在其他网络或中国大陆持续可达。
            </p>
          </div>
          <Button
            disabled={!canPlan || status === "planning"}
            type="submit"
            variant="primary"
          >
            {status === "planning" ? "正在检查云端资源…" : "预览创建方案"}
          </Button>
          <Button
            disabled={status === "planning"}
            onClick={() => void cancelAuthorization()}
            type="button"
          >
            取消并删除授权
          </Button>
        </form>
      )}

      {error ? (
        <p className="form-error create-panel__error" role="alert">
          {error}
        </p>
      ) : null}
      <footer className="create-panel__footer">
        <LockKeyhole aria-hidden="true" size={15} />
        <span>无遥测 · 凭据仅保存在本机 · 云端变更前必须确认</span>
      </footer>
    </section>
  );
}

function CreationProgress({ status }: { status: CreationStatus }) {
  const current =
    status === "idle" || status === "authorizing"
      ? 1
      : status === "configuring" || status === "planning"
        ? 2
        : 3;
  return <span className="creation-progress">{current} / 3</span>;
}

function deploymentActionLabel(action: CloudflareDeploymentPlan["actions"][number]["action"]) {
  const labels = {
    create: "新建",
    enable: "启用",
    reuse: "复用本机已识别资源",
  };
  return labels[action];
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
        <ReviewRow
          label="线路标签地区"
          value={getRegionName(draft.configuredRegion)}
        />
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
          value={desktop ? "保存到 Glide 本机加密目录" : "预览模式，不保存"}
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
