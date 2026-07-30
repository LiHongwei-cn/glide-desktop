import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppPage, RouteCandidate } from "@/domain/models";
import { SetupPage } from "@/pages/SetupPage";
import {
  authorizeCloudflare,
  completeCloudflareOAuth,
  createCloudflareDeploymentPlan,
  deleteSecret,
  deployCloudflareConnection,
  getCloudflareOAuthConfiguration,
  inspectAdminDeployment,
  openOfficialUrl,
  startCloudflareOAuth,
  storeSecret,
  validateAdminEndpointOnDesktop,
} from "@/services/desktop";

vi.mock("@/services/desktop", () => ({
  authorizeCloudflare: vi.fn(),
  cancelCloudflareOAuth: vi.fn(),
  completeCloudflareOAuth: vi.fn(),
  createCloudflareDeploymentPlan: vi.fn(),
  deleteSecret: vi.fn(),
  deployCloudflareConnection: vi.fn(),
  getCloudflareOAuthConfiguration: vi.fn(),
  inspectAdminDeployment: vi.fn(),
  isDesktopRuntime: () => true,
  openOfficialUrl: vi.fn(),
  startCloudflareOAuth: vi.fn(),
  storeSecret: vi.fn(),
  userFacingDesktopError: (error: unknown, fallback: string) =>
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : fallback,
  validateAdminEndpointOnDesktop: vi.fn(),
}));

const inspection = {
  adapter: "cmliu-edgetunnel" as const,
  authenticated: true,
  configUpdatedAt: "2026-07-27T00:00:00Z",
  credentialFingerprint: "credential-fingerprint",
  hostCount: 1,
  nodePathFingerprint: "path-fingerprint",
  preferenceMode: "random" as const,
  preferredEndpointCount: 16,
  protocol: "vless",
  responseTimeMs: 128,
  skipCertificateVerification: false,
  specifiedPort: 443,
  subscriptionReady: true,
  transport: "ws",
  usageMax: 100000,
  usageTotal: 10,
};

const cloudflareAccountId = "0123456789abcdef0123456789abcdef";
const cloudflareAuthorization = {
  accounts: [{ id: cloudflareAccountId, name: "个人账号" }],
  credentialReference: "cloudflare-auth:test-reference",
};
const deploymentPlan = {
  accountId: cloudflareAccountId,
  accountName: "个人账号",
  actions: [
    {
      action: "create" as const,
      label: "公共子域",
      resource: "glid••••.workers.dev",
    },
    {
      action: "create" as const,
      label: "配置存储",
      resource: "glide-private-route-kv",
    },
    {
      action: "create" as const,
      label: "连接服务",
      resource: "glide-private-route",
    },
    {
      action: "enable" as const,
      label: "安全入口",
      resource: "••••.workers.dev",
    },
  ],
  adminCredentialReference: "managed-admin:test-reference",
  authorizationReference: "cloudflare-auth:test-reference",
  displayName: "私人连接",
  endpointPreview: "https://glide-private-route.example.workers.dev/admin",
  kvTitle: "glide-private-route-kv",
  planHash: "a".repeat(64),
  scriptName: "glide-private-route",
  sourceCommit: "fa5a3a6022d46fb18ed251974556fd98ac0ee2f7",
  sourceSha256: "b".repeat(64),
  workersSubdomain: "glide-test-account",
};
const deploymentResult = {
  adminEndpoint: "https://glide-private-route.example.workers.dev/admin",
  credentialReference: "managed-admin:test-reference",
  inspection,
  subscription: {
    nodes: [
      {
        displayName: "日本-CF · 1/2",
        id: "0123456789ab",
        protocol: "VLESS",
        region: "JP" as const,
      },
      {
        displayName: "日本-CF · 2/2",
        id: "abcdef012345",
        protocol: "VLESS",
        region: "JP" as const,
      },
    ],
    responseTimeMs: 96,
    subscriptionUrl: "https://secret.example/subscription-token",
  },
};

function StatefulSetupPage({
  onAddRoute,
  onNavigate,
}: {
  onAddRoute: (route: RouteCandidate) => void;
  onNavigate: (page: AppPage) => void;
}) {
  const [routes, setRoutes] = useState<RouteCandidate[]>([]);

  return (
    <SetupPage
      onAddRoute={(route) => {
        setRoutes((current) => [...current, route]);
        onAddRoute(route);
      }}
      onNavigate={onNavigate}
      routes={routes}
    />
  );
}

function fillImportForm() {
  fireEvent.change(screen.getByLabelText(/^线路名称$/), {
    target: { value: "真实线路" },
  });
  fireEvent.change(screen.getByLabelText(/^管理后台地址$/), {
    target: { value: "https://private.example.com/admin" },
  });
  fireEvent.change(screen.getByLabelText(/^管理员密码/), {
    target: { value: "local-test-password" },
  });
}

async function authorizeCreation() {
  fireEvent.click(
    screen.getByRole("button", { name: /^创建新连接/ }),
  );
  fireEvent.change(screen.getByLabelText(/^API Token/), {
    target: { value: "test-token-with-at-least-twenty-characters" },
  });
  fireEvent.click(screen.getByRole("button", { name: "验证 Token 并继续" }));
  await screen.findByText("授权已安全保存");
}

describe("SetupPage", () => {
  beforeEach(() => {
    vi.mocked(getCloudflareOAuthConfiguration).mockResolvedValue({
      available: false,
      redirectUri: "http://127.0.0.1:49217/oauth/callback",
      setupMessage: "当前发行包尚未配置发布者 OAuth Client。",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("requires authenticated config reading before importing", async () => {
    const onAddRoute = vi.fn();
    vi.mocked(validateAdminEndpointOnDesktop).mockResolvedValue(
      "https://private.example.com/admin",
    );
    vi.mocked(inspectAdminDeployment).mockResolvedValue(inspection);
    vi.mocked(storeSecret).mockResolvedValue();

    render(
      <SetupPage onAddRoute={onAddRoute} onNavigate={vi.fn()} routes={[]} />,
    );
    fillImportForm();
    fireEvent.click(screen.getByRole("button", { name: "检查连接" }));

    expect(
      await screen.findByText("登录与配置读取通过"),
    ).toBeInTheDocument();
    expect(screen.getByText("VLESS")).toBeInTheDocument();
    expect(screen.getByText("1 个域名 · 128 ms")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));

    expect(await screen.findByText("已加入连接组")).toBeInTheDocument();
    expect(storeSecret).toHaveBeenCalledOnce();
    expect(onAddRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        adminAdapter: "cmliu-edgetunnel",
        credentialGroupId: "node:credential-fingerprint",
        managementState: "connected",
        nodePathGroupId: "path:path-fingerprint",
        preferredIpCount: 16,
        subscriptionReady: true,
      }),
    );
  });

  it("shows a password-specific error returned by the desktop adapter", async () => {
    vi.mocked(validateAdminEndpointOnDesktop).mockResolvedValue(
      "https://private.example.com/admin",
    );
    vi.mocked(inspectAdminDeployment).mockRejectedValue(
      "管理员密码不正确，或该后台版本不支持 Glide 的安全登录协议。",
    );

    render(
      <SetupPage onAddRoute={vi.fn()} onNavigate={vi.fn()} routes={[]} />,
    );
    fillImportForm();
    fireEvent.click(screen.getByRole("button", { name: "检查连接" }));

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("管理员密码不正确");
  });

  it("clears the API token after validating the Cloudflare authorization", async () => {
    vi.mocked(authorizeCloudflare).mockResolvedValue(cloudflareAuthorization);

    render(
      <SetupPage onAddRoute={vi.fn()} onNavigate={vi.fn()} routes={[]} />,
    );
    await authorizeCreation();

    expect(authorizeCloudflare).toHaveBeenCalledWith(
      "test-token-with-at-least-twenty-characters",
    );
    expect(screen.queryByLabelText(/^API Token/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Cloudflare 账号")).toHaveValue(
      cloudflareAccountId,
    );
  });

  it("uses Cloudflare OAuth as the primary one-click authorization when configured", async () => {
    vi.mocked(getCloudflareOAuthConfiguration).mockResolvedValue({
      available: true,
      redirectUri: "http://127.0.0.1:49217/oauth/callback",
      setupMessage: "使用 Cloudflare 官方登录授权；Glide 不会读取账号密码。",
    });
    vi.mocked(startCloudflareOAuth).mockResolvedValue({
      authorizationUrl: "https://dash.cloudflare.com/oauth2/auth?test=1",
      flowId: "safe-oauth-flow-id-12345",
    });
    vi.mocked(completeCloudflareOAuth).mockResolvedValue(
      cloudflareAuthorization,
    );

    render(
      <SetupPage onAddRoute={vi.fn()} onNavigate={vi.fn()} routes={[]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^创建新连接/ }));
    await screen.findByText(/使用 Cloudflare 官方登录授权/);
    fireEvent.click(
      screen.getByRole("button", { name: "使用 Cloudflare 登录" }),
    );

    expect(await screen.findByText("授权已安全保存")).toBeInTheDocument();
    expect(startCloudflareOAuth).toHaveBeenCalledTimes(1);
    expect(openOfficialUrl).toHaveBeenCalledWith(
      "https://dash.cloudflare.com/oauth2/auth?test=1",
    );
    expect(completeCloudflareOAuth).toHaveBeenCalledWith(
      "safe-oauth-flow-id-12345",
    );
    expect(authorizeCloudflare).not.toHaveBeenCalled();
  });

  it("clears a rejected Cloudflare token instead of retaining it in the form", async () => {
    vi.mocked(authorizeCloudflare).mockRejectedValue(
      "Cloudflare API 请求失败（HTTP 400，错误码 6003）。",
    );

    render(
      <SetupPage onAddRoute={vi.fn()} onNavigate={vi.fn()} routes={[]} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^创建新连接/ }),
    );
    fireEvent.change(screen.getByLabelText(/^API Token/), {
      target: { value: "invalid-test-token-1234567890" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "验证 Token 并继续" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("错误码 6003");
    expect(screen.getByLabelText(/^API Token/)).toHaveValue("");
  });

  it("deletes a temporary Cloudflare authorization when creation is cancelled", async () => {
    vi.mocked(authorizeCloudflare).mockResolvedValue(cloudflareAuthorization);
    vi.mocked(deleteSecret).mockResolvedValue();

    render(
      <SetupPage onAddRoute={vi.fn()} onNavigate={vi.fn()} routes={[]} />,
    );
    await authorizeCreation();
    fireEvent.click(
      screen.getByRole("button", { name: "取消并删除授权" }),
    );

    expect(deleteSecret).toHaveBeenCalledWith(
      cloudflareAuthorization.credentialReference,
    );
    expect(deleteSecret).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText(/^API Token/)).toBeInTheDocument();
  });

  it("previews every cloud change before creating a verified route", async () => {
    const onAddRoute = vi.fn();
    const onNavigate = vi.fn();
    vi.mocked(authorizeCloudflare).mockResolvedValue(cloudflareAuthorization);
    vi.mocked(createCloudflareDeploymentPlan).mockResolvedValue(deploymentPlan);
    vi.mocked(deployCloudflareConnection).mockResolvedValue(deploymentResult);

    render(
      <SetupPage
        onAddRoute={onAddRoute}
        onNavigate={onNavigate}
        routes={[]}
      />,
    );
    await authorizeCreation();
    fireEvent.change(screen.getByLabelText("连接名称"), {
      target: { value: "私人连接" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览创建方案" }));

    expect(
      await screen.findByRole("heading", { name: "3. 确认创建范围" }),
    ).toBeInTheDocument();
    expect(screen.getByText("公共子域")).toBeInTheDocument();
    expect(screen.getByText("配置存储")).toBeInTheDocument();
    expect(screen.getByText("连接服务")).toBeInTheDocument();
    expect(screen.getByText("安全入口")).toBeInTheDocument();
    expect(deployCloudflareConnection).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认并创建" }));

    expect(
      await screen.findByText("当前网络验证通过"),
    ).toBeInTheDocument();
    expect(screen.getByText("本次线路三项验收通过")).toBeInTheDocument();
    expect(screen.getByText("可选节点 · 2 个")).toBeInTheDocument();
    expect(screen.getByText("真实订阅 · 96 ms")).toBeInTheDocument();
    expect(deployCloudflareConnection).toHaveBeenCalledWith(
      cloudflareAccountId,
      cloudflareAuthorization.credentialReference,
      "私人连接",
      deploymentPlan.planHash,
    );
    expect(onAddRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        adminAdapter: "cmliu-edgetunnel",
        credentialReference: "managed-admin:test-reference",
        configuredRegion: "UNKNOWN",
        displayName: "私人连接",
        managementState: "connected",
        subscriptionReady: true,
      }),
    );
    expect(JSON.stringify(onAddRoute.mock.calls[0][0])).not.toContain(
      deploymentResult.subscription.subscriptionUrl,
    );
  });

  it("creates three unique lines with one in-memory authorization and deletes it once", async () => {
    const onAddRoute = vi.fn();
    const onNavigate = vi.fn();
    const names = ["第一条线路", "第二条线路", "第三条线路"];
    vi.mocked(authorizeCloudflare).mockResolvedValue(cloudflareAuthorization);
    vi.mocked(createCloudflareDeploymentPlan).mockImplementation(
      async (_accountId, authorizationReference, name) => {
        const index = names.indexOf(name) + 1;
        return {
          ...deploymentPlan,
          authorizationReference,
          displayName: name,
          endpointPreview: `https://glide-route-${index}.example.workers.dev/admin`,
          kvTitle: `glide-route-${index}-kv`,
          planHash: String(index).repeat(64),
          scriptName: `glide-route-${index}`,
        };
      },
    );
    vi.mocked(deployCloudflareConnection).mockImplementation(
      async (_accountId, _authorizationReference, name) => {
        const index = names.indexOf(name) + 1;
        return {
          ...deploymentResult,
          adminEndpoint: `https://glide-route-${index}.example.workers.dev/admin`,
          credentialReference: `managed-admin:route-${index}`,
          inspection: {
            ...inspection,
            credentialFingerprint: `credential-fingerprint-${index}`,
            nodePathFingerprint: `path-fingerprint-${index}`,
          },
        };
      },
    );
    vi.mocked(deleteSecret).mockResolvedValue();

    render(
      <StatefulSetupPage
        onAddRoute={onAddRoute}
        onNavigate={onNavigate}
      />,
    );
    await authorizeCreation();

    for (const [index, name] of names.entries()) {
      fireEvent.change(screen.getByLabelText("连接名称"), {
        target: { value: name },
      });
      fireEvent.click(screen.getByRole("button", { name: "预览创建方案" }));
      await screen.findByRole("heading", { name: "3. 确认创建范围" });
      fireEvent.click(screen.getByRole("button", { name: "确认并创建" }));
      await screen.findByText(
        new RegExp(`已成功创建并验证\\s*${index + 1}\\s*条线路`),
      );
      if (index < names.length - 1) {
        fireEvent.click(
          screen.getByRole("button", {
            name: `继续创建第 ${index + 2} 条`,
          }),
        );
        expect(screen.getByText("授权已安全保存")).toBeInTheDocument();
      }
    }

    fireEvent.click(screen.getByRole("button", { name: "完成并查看线路" }));

    expect(deleteSecret).toHaveBeenCalledWith(
      cloudflareAuthorization.credentialReference,
    );
    expect(deleteSecret).toHaveBeenCalledTimes(1);
    expect(authorizeCloudflare).toHaveBeenCalledTimes(1);
    expect(deployCloudflareConnection).toHaveBeenCalledTimes(3);
    expect(onAddRoute).toHaveBeenCalledTimes(3);
    expect(
      new Set(
        onAddRoute.mock.calls.map(
          (call) => (call[0] as RouteCandidate).adminEndpoint,
        ),
      ).size,
    ).toBe(3);
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("routes"));
  });

  it("stops before deployment when the planned endpoint is already imported", async () => {
    vi.mocked(authorizeCloudflare).mockResolvedValue(cloudflareAuthorization);
    vi.mocked(createCloudflareDeploymentPlan).mockResolvedValue(deploymentPlan);

    render(
      <SetupPage
        onAddRoute={vi.fn()}
        onNavigate={vi.fn()}
        routes={[
          {
            adminEndpoint: deploymentPlan.endpointPreview,
          } as RouteCandidate,
        ]}
      />,
    );
    await authorizeCreation();
    fireEvent.change(screen.getByLabelText("连接名称"), {
      target: { value: "私人连接" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览创建方案" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "已经在 Glide 中",
    );
    expect(deployCloudflareConnection).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "确认并创建" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the confirmed plan available when deployment fails", async () => {
    vi.mocked(authorizeCloudflare).mockResolvedValue(cloudflareAuthorization);
    vi.mocked(createCloudflareDeploymentPlan).mockResolvedValue(deploymentPlan);
    vi.mocked(deployCloudflareConnection).mockRejectedValue(
      "部署后验证未通过。本次新建资源已回滚。",
    );

    render(
      <SetupPage onAddRoute={vi.fn()} onNavigate={vi.fn()} routes={[]} />,
    );
    await authorizeCreation();
    fireEvent.change(screen.getByLabelText("连接名称"), {
      target: { value: "私人连接" },
    });
    fireEvent.click(screen.getByRole("button", { name: "预览创建方案" }));
    await screen.findByRole("heading", { name: "3. 确认创建范围" });
    fireEvent.click(screen.getByRole("button", { name: "确认并创建" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "本次新建资源已回滚",
    );
    expect(
      screen.getByRole("button", { name: "确认并创建" }),
    ).toBeEnabled();
  });
});
