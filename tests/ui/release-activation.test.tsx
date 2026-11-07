// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ReleaseDropdown } from "../../apps/web/src/release-dropdown";
import { Tool } from "../../apps/web/src/ui";

beforeEach(() => {
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("activates a tool once on release, and ignores drags and cancelled gestures", () => {
  const run = vi.fn();
  render(
    <Tool label="Insert shape" onClick={run}>
      Shape
    </Tool>,
  );
  const button = screen.getByRole("button");
  const start = { pointerId: 1, clientX: 30, clientY: 30 };
  fireEvent.pointerDown(button, start);
  expect(run).not.toHaveBeenCalled();
  fireEvent.pointerUp(button, start);
  fireEvent.click(button, { detail: 1 });
  expect(run).toHaveBeenCalledTimes(1);

  for (const [x, y] of [
    [80, 30],
    [30, 80],
  ]) {
    fireEvent.pointerDown(button, start);
    fireEvent.pointerMove(button, { ...start, clientX: x, clientY: y });
    fireEvent.pointerUp(button, start);
    fireEvent.click(button, { detail: 1 });
  }
  fireEvent.pointerDown(button, start);
  fireEvent.pointerCancel(button);
  fireEvent.click(button, { detail: 1 });
  expect(run).toHaveBeenCalledTimes(1);
  // Keyboard/assistive-technology clicks have no pointer gesture.
  fireEvent.click(button, { detail: 0 });
  expect(run).toHaveBeenCalledTimes(2);
});

it("ignores other pointers and detects movement on release even without a move event", () => {
  const run = vi.fn();
  render(
    <Tool label="Bold" onClick={run}>
      B
    </Tool>,
  );
  const button = screen.getByRole("button");
  fireEvent.pointerMove(button, { pointerId: 2, clientX: 100 });
  fireEvent.pointerDown(button, { pointerId: 1, clientX: 10 });
  fireEvent.pointerMove(button, { pointerId: 2, clientX: 100 });
  fireEvent.pointerUp(button, { pointerId: 1, clientX: 30 });
  fireEvent.click(button, { detail: 1 });
  expect(run).not.toHaveBeenCalled();
  fireEvent.pointerCancel(button);
});

it("opens a dropdown on click rather than press and keeps keyboard navigation", async () => {
  render(
    <ReleaseDropdown trigger="Layout" triggerProps={{}}>
      <Dropdown.Portal>
        <Dropdown.Content>
          <Dropdown.Item>Blank slide</Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </ReleaseDropdown>,
  );
  const button = screen.getByRole("button", { name: "Layout" });
  fireEvent.pointerDown(button, { button: 0 });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.pointerUp(button, { button: 0 });
  fireEvent.click(button, { detail: 1 });
  expect(
    await screen.findByRole("menuitem", { name: "Blank slide" }),
  ).toBeTruthy();
  await userEvent.keyboard("{Escape}");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  button.focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(
    await screen.findByRole("menuitem", { name: "Blank slide" }),
  ).toBeTruthy();
});
