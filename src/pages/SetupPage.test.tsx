import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SetupPage } from "@/pages/SetupPage";
import {
  inspectAdminDeployment,
  storeSecret,
  validateAdminEndpointOnDesktop,
} from "@/services/desktop";

vi.mock("@/services/desktop", () => ({
  inspectAdminDeployment: vi.fn(),
  isDesktopRuntime: () => true,
  openOfficialUrl: vi.fn(),
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

describe("SetupPage", () => {
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
});
