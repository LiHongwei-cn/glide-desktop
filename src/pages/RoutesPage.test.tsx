import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initialState } from "@/data/seed";
import { RoutesPage } from "@/pages/RoutesPage";
import {
  inspectAdminDeployment,
  refreshAdminDeployment,
  storeSecret,
  validateAdminEndpointOnDesktop,
} from "@/services/desktop";
import { createRouteFixtures } from "@/test/fixtures";

vi.mock("@/services/desktop", () => ({
  inspectAdminDeployment: vi.fn(),
  openAdminEndpoint: vi.fn(),
  refreshAdminDeployment: vi.fn(),
  storeSecret: vi.fn(),
  userFacingDesktopError: (error: unknown, fallback: string) =>
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : fallback,
  validateAdminEndpointOnDesktop: vi.fn(),
}));

describe("RoutesPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("filters routes and opens diagnostics from deep validation", () => {
    const onApplyAdminInspection = vi.fn();
    const onNavigate = vi.fn();
    const onRemoveRoute = vi.fn().mockResolvedValue(undefined);
    const group = {
      ...initialState.connectionGroups[0],
      routes: createRouteFixtures(),
    };
    const { container } = render(
      <RoutesPage
        group={group}
        onApplyAdminInspection={onApplyAdminInspection}
        onNavigate={onNavigate}
        onRemoveRoute={onRemoveRoute}
      />,
    );

    expect(container.querySelectorAll(".route-row")).toHaveLength(5);
    fireEvent.change(screen.getByLabelText("筛选线路"), {
      target: { value: "verified" },
    });
    expect(container.querySelectorAll(".route-row")).toHaveLength(1);
    expect(screen.getByText("线路 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "深度验证" }));
    expect(onNavigate).toHaveBeenCalledWith("diagnostics");

    fireEvent.click(screen.getByRole("button", { name: "移除线路 线路 2" }));
    expect(screen.getByRole("heading", { name: "移除这条线路？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除本机线路" }));
    expect(onRemoveRoute).toHaveBeenCalledWith("test-route-jp");
  });

  it("authenticates and renders a sanitized management summary", async () => {
    const onApplyAdminInspection = vi.fn();
    const route = {
      ...createRouteFixtures()[0],
      adminEndpoint: "https://private.example.com/admin",
      credentialReference: "legacy-admin:test-route-hk",
    };
    const inspection = {
      adapter: "cmliu-edgetunnel" as const,
      authenticated: true,
      credentialFingerprint: "credential-fingerprint",
      hostCount: 1,
      nodePathFingerprint: "path-fingerprint",
      preferenceMode: "random" as const,
      preferredEndpointCount: 16,
      protocol: "vless",
      responseTimeMs: 120,
      skipCertificateVerification: false,
      specifiedPort: 443,
      subscriptionReady: true,
      transport: "ws",
      usageMax: 100000,
      usageTotal: 12,
    };
    vi.mocked(refreshAdminDeployment).mockResolvedValue(inspection);

    render(
      <RoutesPage
        group={{ ...initialState.connectionGroups[0], routes: [route] }}
        onApplyAdminInspection={onApplyAdminInspection}
        onNavigate={vi.fn()}
        onRemoveRoute={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "管理线路 线路 1" }));

    expect(await screen.findByText("管理连接已验证")).toBeInTheDocument();
    expect(screen.getByText("VLESS / WS")).toBeInTheDocument();
    expect(screen.getByText("12 / 100,000")).toBeInTheDocument();
    expect(onApplyAdminInspection).toHaveBeenCalledWith(route.id, inspection);
  });

  it("upgrades a legacy route without deleting it", async () => {
    const onApplyAdminInspection = vi.fn();
    const route = {
      ...createRouteFixtures()[0],
      adminEndpoint: undefined,
      credentialReference: undefined,
    };
    const inspection = {
      adapter: "cmliu-edgetunnel" as const,
      authenticated: true,
      credentialFingerprint: "credential-fingerprint",
      hostCount: 1,
      nodePathFingerprint: "path-fingerprint",
      preferenceMode: "random" as const,
      preferredEndpointCount: 16,
      protocol: "vless",
      responseTimeMs: 120,
      skipCertificateVerification: false,
      specifiedPort: 443,
      subscriptionReady: true,
      transport: "ws",
      usageMax: 100000,
      usageTotal: 12,
    };
    vi.mocked(inspectAdminDeployment).mockResolvedValue(inspection);
    vi.mocked(storeSecret).mockResolvedValue();
    vi.mocked(validateAdminEndpointOnDesktop).mockResolvedValue(
      "https://private.example.com/admin",
    );

    render(
      <RoutesPage
        group={{ ...initialState.connectionGroups[0], routes: [route] }}
        onApplyAdminInspection={onApplyAdminInspection}
        onNavigate={vi.fn()}
        onRemoveRoute={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "管理线路 线路 1" }));
    fireEvent.change(screen.getByLabelText(/^管理后台地址$/), {
      target: { value: "https://private.example.com/admin" },
    });
    fireEvent.change(screen.getByLabelText(/^管理员密码$/), {
      target: { value: "local-test-password" },
    });
    fireEvent.submit(screen.getByLabelText(/^管理员密码$/).closest("form")!);

    expect(await screen.findByText("管理连接已验证")).toBeInTheDocument();
    expect(storeSecret).toHaveBeenCalledWith(
      `legacy-admin:${route.id}`,
      "local-test-password",
    );
    expect(onApplyAdminInspection).toHaveBeenCalledWith(
      route.id,
      inspection,
      `legacy-admin:${route.id}`,
      "https://private.example.com/admin",
    );
  });

  it("repairs a stale credential without deleting the route", async () => {
    const onApplyAdminInspection = vi.fn();
    const route = {
      ...createRouteFixtures()[0],
      adminEndpoint: "https://private.example.com/admin",
      credentialReference: "legacy-admin:test-route-hk",
    };
    const inspection = {
      adapter: "cmliu-edgetunnel" as const,
      authenticated: true,
      credentialFingerprint: "credential-fingerprint",
      hostCount: 1,
      nodePathFingerprint: "path-fingerprint",
      preferenceMode: "random" as const,
      preferredEndpointCount: 16,
      protocol: "vless",
      responseTimeMs: 120,
      skipCertificateVerification: false,
      specifiedPort: 443,
      subscriptionReady: true,
      transport: "ws",
      usageMax: 100000,
      usageTotal: 12,
    };
    vi.mocked(refreshAdminDeployment).mockRejectedValue(
      "管理员密码不正确，请更新管理凭据。",
    );
    vi.mocked(validateAdminEndpointOnDesktop).mockResolvedValue(
      route.adminEndpoint,
    );
    vi.mocked(inspectAdminDeployment).mockResolvedValue(inspection);
    vi.mocked(storeSecret).mockResolvedValue();

    render(
      <RoutesPage
        group={{ ...initialState.connectionGroups[0], routes: [route] }}
        onApplyAdminInspection={onApplyAdminInspection}
        onNavigate={vi.fn()}
        onRemoveRoute={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "管理线路 线路 1" }));
    expect(await screen.findByText("更新管理凭据")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^管理员密码$/), {
      target: { value: "updated-local-password" },
    });
    fireEvent.submit(screen.getByLabelText(/^管理员密码$/).closest("form")!);

    expect(await screen.findByText("管理连接已验证")).toBeInTheDocument();
    expect(storeSecret).toHaveBeenCalledWith(
      route.credentialReference,
      "updated-local-password",
    );
    expect(onApplyAdminInspection).toHaveBeenCalledWith(
      route.id,
      inspection,
      route.credentialReference,
      route.adminEndpoint,
    );
  });
});
