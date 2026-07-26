import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { initialState } from "@/data/seed";
import { RoutesPage } from "@/pages/RoutesPage";
import { createRouteFixtures } from "@/test/fixtures";

describe("RoutesPage", () => {
  it("filters routes and opens diagnostics from deep validation", () => {
    const onNavigate = vi.fn();
    const group = {
      ...initialState.connectionGroups[0],
      routes: createRouteFixtures(),
    };
    const { container } = render(
      <RoutesPage group={group} onNavigate={onNavigate} />,
    );

    expect(container.querySelectorAll(".route-row")).toHaveLength(5);
    fireEvent.change(screen.getByLabelText("筛选线路"), {
      target: { value: "verified" },
    });
    expect(container.querySelectorAll(".route-row")).toHaveLength(1);
    expect(screen.getByText("线路 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "深度验证" }));
    expect(onNavigate).toHaveBeenCalledWith("diagnostics");
  });
});
