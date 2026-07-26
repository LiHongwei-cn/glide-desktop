import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { initialState } from "@/data/seed";
import { SettingsPage } from "@/pages/SettingsPage";

describe("SettingsPage", () => {
  it("explains local-only usage and privacy boundaries", () => {
    render(
      <SettingsPage
        deviceCount={2}
        diagnosticCount={0}
        onClearDiagnostics={vi.fn()}
        onResetUsage={vi.fn()}
        onUpdatePreferences={vi.fn()}
        preferences={initialState.preferences}
        runtimeInfo={{
          appVersion: "0.2.0",
          architecture: "ARM64",
          desktop: true,
          operatingSystem: "macOS",
        }}
        usage={{
          activeDays: ["2026-07-25", "2026-07-26"],
          firstOpenedAt: "2026-07-25T00:00:00.000Z",
          lastOpenedAt: "2026-07-26T00:00:00.000Z",
          launchCount: 3,
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "本机使用统计" })).toBeInTheDocument();
    expect(screen.getByText("启动次数").parentElement).toHaveTextContent("3");
    expect(screen.getByText("本机设备").parentElement).toHaveTextContent("2");
    expect(screen.getByText("遥测与用户追踪").parentElement?.parentElement).toHaveTextContent(
      "关闭",
    );
    expect(screen.getByText(/不能代表 GitHub 上的全网用户数/)).toBeInTheDocument();
  });
});
