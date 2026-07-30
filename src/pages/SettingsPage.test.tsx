import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { initialState } from "@/data/seed";
import { SettingsPage } from "@/pages/SettingsPage";

describe("SettingsPage", () => {
  it("explains the encrypted local vault and no-computer-password boundary", () => {
    render(
      <SettingsPage
        diagnosticCount={0}
        onClearDiagnostics={vi.fn()}
        onUpdatePreferences={vi.fn()}
        preferences={initialState.preferences}
        runtimeInfo={{
          appVersion: "0.6.1",
          architecture: "ARM64",
          desktop: true,
          operatingSystem: "macOS",
        }}
      />,
    );

    expect(screen.getByText("后台管理密码").parentElement?.parentElement).toHaveTextContent(
      "本机加密",
    );
    expect(screen.getByText("电脑登录密码").parentElement?.parentElement).toHaveTextContent(
      "不需要",
    );
    expect(screen.getByText("后台管理密码").parentElement?.parentElement).toHaveTextContent(
      "不再要求电脑密码",
    );
    expect(screen.queryByText("启动次数")).not.toBeInTheDocument();
  });
});
