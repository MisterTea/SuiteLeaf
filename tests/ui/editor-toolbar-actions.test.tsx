// @vitest-environment jsdom
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  EditorToolbarActionsSlot,
  EditorToolbarNavigationSlot,
  EditorToolbarNavigationTarget,
  EditorToolbarTarget,
  ToolbarActions,
} from "../../apps/web/src/editor-toolbar-actions";

afterEach(cleanup);

it("leaves standalone editors without an empty action group", () => {
  const { container } = render(
    <>
      <EditorToolbarActionsSlot />
      <EditorToolbarNavigationSlot />
    </>,
  );
  expect(container.childElementCount).toBe(0);
});

it("places Back and Main menu before the presentation editing controls", () => {
  const back = vi.fn();
  const menu = vi.fn();
  function Harness() {
    const [target, setTarget] = useState<HTMLDivElement | null>(null);
    return (
      <EditorToolbarNavigationTarget.Provider value={setTarget}>
        <header data-testid="header">
          <ToolbarActions target={target}>
            <button onClick={back}>Back</button>
            <button onClick={menu}>Main menu</button>
          </ToolbarActions>
        </header>
        <div role="toolbar">
          <EditorToolbarNavigationSlot />
          <fieldset disabled>
            <button>Theme</button>
          </fieldset>
        </div>
      </EditorToolbarNavigationTarget.Provider>
    );
  }
  render(<Harness />);
  const buttons = within(screen.getByRole("toolbar")).getAllByRole("button");
  expect(buttons.map((button) => button.textContent)).toEqual([
    "Back",
    "Main menu",
    "Theme",
  ]);
  expect(screen.getByTestId("header").childElementCount).toBe(0);
  fireEvent.click(buttons[0]);
  fireEvent.click(buttons[1]);
  expect(back).toHaveBeenCalledTimes(1);
  expect(menu).toHaveBeenCalledTimes(1);
});

it("moves working workspace actions into the toolbar outside read-only editing controls", () => {
  const download = vi.fn();
  function Harness() {
    const [target, setTarget] = useState<HTMLDivElement | null>(null);
    const [showToolbar, setShowToolbar] = useState(false);
    return (
      <EditorToolbarTarget.Provider value={setTarget}>
        <header data-testid="header">
          <ToolbarActions target={target}>
            <button onClick={download}>Download</button>
          </ToolbarActions>
        </header>
        <button onClick={() => setShowToolbar((shown) => !shown)}>
          Toggle toolbar
        </button>
        {showToolbar ? (
          <div role="toolbar" aria-label="Slides toolbar">
            <fieldset disabled>
              <button>Edit slide</button>
            </fieldset>
            <EditorToolbarActionsSlot />
          </div>
        ) : null}
      </EditorToolbarTarget.Provider>
    );
  }
  render(<Harness />);
  expect(
    within(screen.getByTestId("header")).getByRole("button", {
      name: "Download",
    }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Toggle toolbar" }));
  expect(screen.getByTestId("header").childElementCount).toBe(0);
  const button = within(screen.getByRole("toolbar")).getByRole("button", {
    name: "Download",
  });
  expect(button.closest("fieldset")).toBeNull();
  fireEvent.click(button);
  expect(download).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Toggle toolbar" }));
  expect(
    within(screen.getByTestId("header")).getByRole("button", {
      name: "Download",
    }),
  ).toBeTruthy();
});
