import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "@/components/ui";

describe("Dialog", () => {
  it("focuses the first field, locks page scroll and supports Escape", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Dialog onClose={onClose} open title="测试对话框">
        <label>
          名称
          <input aria-label="名称" />
        </label>
        <button type="button">确认</button>
      </Dialog>,
    );

    expect(screen.getByLabelText("名称")).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <Dialog onClose={onClose} open={false} title="测试对话框">
        <span>关闭</span>
      </Dialog>,
    );
    expect(document.body.style.overflow).toBe("");
  });
});
