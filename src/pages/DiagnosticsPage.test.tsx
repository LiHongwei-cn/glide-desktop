import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initialState } from "@/data/seed";
import { DiagnosticsPage } from "@/pages/DiagnosticsPage";
import { getCredentialVaultStatus, probeEndpoints } from "@/services/desktop";
import { createRouteFixtures } from "@/test/fixtures";

vi.mock("@/services/desktop", () => ({
  getCredentialVaultStatus: vi.fn(),
  probeEndpoints: vi.fn(),
}));

describe("DiagnosticsPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps endpoint labels redacted and applies health updates", async () => {
    vi.mocked(getCredentialVaultStatus).mockResolvedValue({
      missingReferenceCount: 0,
      ready: true,
    });
    vi.mocked(probeEndpoints).mockResolvedValue([
      {
        detail: "HTTPS 入口可达且受到访问控制，状态 401。",
        durationMs: 160,
        endpoint: "••••.example.com",
        status: "passed",
      },
    ]);
    const onApplyRouteChecks = vi.fn();
    const onAppendDiagnostic = vi.fn();
    const routes = createRouteFixtures();
    routes[0] = {
      ...routes[0],
      adminEndpoint: "https://private.example.com/admin",
    };

    render(
      <DiagnosticsPage
        group={{ ...initialState.connectionGroups[0], routes }}
        onApplyRouteChecks={onApplyRouteChecks}
        onAppendDiagnostic={onAppendDiagnostic}
        recentDiagnostics={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "运行快速检查" }));

    await waitFor(() => {
      expect(onApplyRouteChecks).toHaveBeenCalledWith([
        expect.objectContaining({
          healthScore: 90,
          routeIds: ["test-route-hk"],
          status: "active",
        }),
      ]);
      expect(onAppendDiagnostic).toHaveBeenCalledOnce();
    });
    expect(onAppendDiagnostic.mock.calls[0][0].checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "管理入口 · ••••.example.com",
          status: "passed",
        }),
        expect.objectContaining({
          label: "本机凭据目录",
          status: "passed",
        }),
      ]),
    );
  });

  it("turns a damaged local vault into an actionable failed check", async () => {
    vi.mocked(getCredentialVaultStatus).mockRejectedValue(
      new Error("integrity failure"),
    );
    vi.mocked(probeEndpoints).mockResolvedValue([]);
    const onAppendDiagnostic = vi.fn();

    render(
      <DiagnosticsPage
        group={{ ...initialState.connectionGroups[0], routes: [] }}
        onApplyRouteChecks={vi.fn()}
        onAppendDiagnostic={onAppendDiagnostic}
        recentDiagnostics={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "运行快速检查" }));

    await waitFor(() => expect(onAppendDiagnostic).toHaveBeenCalledOnce());
    expect(onAppendDiagnostic.mock.calls[0][0].checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.stringContaining("磁盘空间、文件权限或凭据文件完整性"),
          label: "本机凭据目录",
          status: "failed",
        }),
      ]),
    );
  });
});
