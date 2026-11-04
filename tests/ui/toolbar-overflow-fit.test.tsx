// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToolbarOverflow } from "../../apps/web/src/editors/toolbar-overflow";

/** Lays the toolbar's children out left to right, 40px each with a 4px gap, ignoring folded ones. */
const geometry = { width: 0 };

function layout(bar: HTMLElement) {
  bar.getBoundingClientRect = () => new DOMRect(0, 0, geometry.width, 32);
  const children = () => [...bar.children] as HTMLElement[];
  for (const child of children()) {
    child.getBoundingClientRect = () => {
      const shown = children().filter(
        (item) => !item.classList.contains("more-tools") && !item.classList.contains("toolbar-break") && (item.dataset.overflow === undefined || bar.classList.contains("show-more")),
      );
      const index = shown.indexOf(child);
      if (index < 0) return new DOMRect(0, 0, 0, 0);
      const row = bar.classList.contains("show-more") && child.dataset.overflow !== undefined ? 40 : 0;
      return new DOMRect(index * 44, row, 40, 32);
    };
  }
  const more = bar.querySelector<HTMLElement>(".more-tools");
  if (more) Object.defineProperty(more, "offsetWidth", { value: 30, configurable: true });
}

let observers: (() => void)[] = [];

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: () => void) {
        observers.push(() => this.callback());
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("innerWidth", 1200);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Toolbar({ foldNarrow, tools, report }: { foldNarrow?: boolean; tools: string[]; report: (state: ReturnType<typeof useToolbarOverflow>) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const state = useToolbarOverflow(bar, ".pinned", foldNarrow === undefined ? undefined : { foldNarrow });
  report(state);
  return (
    <div
      ref={(node) => {
        bar.current = node;
        if (node) layout(node);
      }}
      className={state.open ? "toolbar show-more" : "toolbar"}
      style={{ paddingRight: "0px", columnGap: "4px" }}
    >
      {tools.map((tool) =>
        tool.endsWith("|") ? (
          <span key={`${tool}${Math.random()}`} className={tool.startsWith("*") ? "toolbar-divider pinned" : "toolbar-divider"} />
        ) : (
          <button key={tool} type="button" className={tool.startsWith("*") ? "pinned" : undefined}>
            {tool}
          </button>
        ),
      )}
      {state.open ? <span className="toolbar-break" /> : null}
      <button type="button" className="more-tools" onClick={() => state.setOpen(!state.open)}>
        More tools
      </button>
    </div>
  );
}

function mount(width: number, tools: string[], foldNarrow?: boolean) {
  let state: ReturnType<typeof useToolbarOverflow> | null = null;
  geometry.width = width;
  const view = render(<Toolbar tools={tools} foldNarrow={foldNarrow} report={(next) => (state = next)} />);
  const folded = () => [...view.container.querySelectorAll<HTMLElement>("[data-overflow]")].map((el) => el.textContent || "|");
  return { ...view, state: () => state!, folded, bar: () => view.container.firstElementChild as HTMLElement };
}

describe("folding toolbar controls", () => {
  it("keeps everything when it fits", () => {
    const view = mount(1000, ["Bold", "Italic", "Link"]);
    expect(view.state().overflowing).toBe(false);
    expect(view.folded()).toEqual([]);
  });

  it("folds from the right and keeps pinned tools to the end", () => {
    const view = mount(200, ["*Bold", "|", "Italic", "|", "|", "Link", "Table", "*Find", "|"]);
    expect(view.state().overflowing).toBe(true);
    expect(view.folded()).toEqual(["Italic", "|", "|", "Link", "Table", "|"]);
    expect(view.container.querySelector("[data-overflow='first']")?.textContent).toBe("Italic");
    expect(view.bar().dataset.measuring).toBeUndefined();
  });

  it("drops a divider left at the start", () => {
    const view = mount(200, ["|", "*Bold", "|", "|", "*Find", "Link", "Table"]);
    expect(view.folded()).toEqual(["|", "|", "|", "Link", "Table"]);
    expect(view.container.querySelector("[data-overflow='first']")?.textContent).toBe("Link");
  });

  it("drops dividers left next to each other or at the end", () => {
    const view = mount(200, ["*Bold", "*|", "*|", "Italic", "Link", "Table"]);
    expect(view.folded()).toEqual(["|", "|", "Italic", "Link", "Table"]);
  });

  it("places the open More row where the folded tools are", () => {
    const view = mount(200, ["*Bold", "Italic", "Link", "Table", "Chart"]);
    fireEvent.click(screen.getByRole("button", { name: "More tools" }));
    expect(view.state().open).toBe(true);
    const bar = view.bar();
    expect(bar.style.getPropertyValue("--more-top")).toBe("40px");
    expect(bar.style.getPropertyValue("--more-height")).toBe("32px");
    expect(bar.style.getPropertyValue("--more-width")).not.toBe("");
  });

  it("closes the More row on Escape or a press outside, but not inside", () => {
    const view = mount(200, ["*Bold", "Italic", "Link", "Table", "Chart"]);
    fireEvent.click(screen.getByRole("button", { name: "More tools" }));
    fireEvent.pointerDown(screen.getByText("Link"));
    expect(view.state().open).toBe(true);
    fireEvent.keyDown(document, { key: "a" });
    expect(view.state().open).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(view.state().open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "More tools" }));
    fireEvent.pointerDown(document.body);
    expect(view.state().open).toBe(false);
  });

  it("closes the More row once everything fits again", () => {
    const view = mount(200, ["*Bold", "Italic", "Link", "Table", "Chart"]);
    fireEvent.click(screen.getByRole("button", { name: "More tools" }));
    geometry.width = 2000;
    act(() => observers.forEach((refit) => refit()));
    expect(view.state().overflowing).toBe(false);
    expect(view.state().open).toBe(false);
  });

  it("scrolls instead of folding on a phone, unless asked to fold there", () => {
    vi.stubGlobal("innerWidth", 600);
    const scrolling = mount(200, ["*Bold", "Italic", "Link", "Table", "Chart"]);
    expect(scrolling.folded()).toEqual([]);
    expect(scrolling.state().overflowing).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "More tools" }));
    expect(scrolling.state().open).toBe(false);
    cleanup();
    const folding = mount(200, ["*Bold", "Italic", "Link", "Table", "Chart"], true);
    expect(folding.folded().length).toBeGreaterThan(0);
  });
});
