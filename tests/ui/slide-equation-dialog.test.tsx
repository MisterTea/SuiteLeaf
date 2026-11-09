// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SlideEquationDialog } from "../../apps/web/src/editors/slide-equation-dialog";

afterEach(cleanup);

it("previews valid LaTeX and applies it to the chosen equation", () => {
  const onSave = vi.fn();
  const { container } = render(
    <SlideEquationDialog
      equations={[
        { index: 0, count: 1, source: "x" },
        { index: 3, count: 1, source: "y" },
      ]}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  );
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
  const input = screen.getByRole("textbox", { name: "LaTeX" });
  fireEvent.change(input, { target: { value: "\\frac{x" } });
  expect(screen.getByRole("alert").textContent).toMatch(/could not be parsed/);
  expect(
    (screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.change(input, { target: { value: "\\frac{x}{2}" } });
  expect(container.querySelector("math mfrac")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(onSave).toHaveBeenCalledWith("\\frac{x}{2}", 1);
});
