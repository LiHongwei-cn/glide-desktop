import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { initialState } from "@/data/seed";
import { DiagnosticsPage } from "@/pages/DiagnosticsPage";
import { probeEndpoints } from "@/services/desktop";
import { createRouteFixtures } from "@/test/fixtures";

vi.mock("@/services/desktop", () => ({
  probeEndpoints: vi.fn(),
}));

describe("DiagnosticsPage", () => {
  it("keeps endpoint labels redacted and applies health updates", async () => {
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
      ]),
    );
  });
});
