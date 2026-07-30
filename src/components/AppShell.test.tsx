import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/AppShell";

const runtimeInfo = {
  appVersion: "0.1.0",
  architecture: "ARM64",
  desktop: true,
  operatingSystem: "macOS",
};

describe("AppShell", () => {
  it("exposes navigation and local persistence state accessibly", () => {
    const onNavigate = vi.fn();

    render(
      <AppShell
        activePage="overview"
        onNavigate={onNavigate}
        persistenceStatus="saved"
        runtimeInfo={runtimeInfo}
      >
        <h1>测试概览</h1>
      </AppShell>,
    );

    expect(screen.getByRole("main")).toHaveTextContent("测试概览");
    expect(screen.getByText("本地数据已保护")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "首页" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(screen.getByRole("button", { name: "连接" }));
    expect(onNavigate).toHaveBeenCalledWith("routes");
  });
});
