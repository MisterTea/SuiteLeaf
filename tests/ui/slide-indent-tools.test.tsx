// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SlideFormatTools } from "../../apps/web/src/editors/slide-editor-format-tools";

afterEach(cleanup);

it("places indentation buttons after alignment and invokes both directions", () => {
  const changeIndent = vi.fn();
  const props = {
    state: { deck: {}, editingId: "text" },
    selectedElement: { id: "text", type: "text", content: "Words" },
    activeSlide: { elements: [] },
    changeIndent,
  } as unknown as Parameters<typeof SlideFormatTools>[0];
  render(<SlideFormatTools {...props} />);
  const buttons = screen.getAllByRole("button");
  const right = screen.getByRole("button", { name: "Align right" });
  const decrease = screen.getByRole("button", { name: "Decrease indent" });
  const increase = screen.getByRole("button", { name: "Increase indent" });
  expect(buttons.indexOf(decrease)).toBe(buttons.indexOf(right) + 1);
  expect(buttons.indexOf(increase)).toBe(buttons.indexOf(decrease) + 1);
  fireEvent.click(decrease);
  fireEvent.click(increase);
  expect(changeIndent.mock.calls).toEqual([[-1], [1]]);
});
