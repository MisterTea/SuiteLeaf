// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  attachSheetViewLock,
  filterViewChoices,
  swallowsSheetEdit,
  watchFormulaBar,
  type SheetAccess,
} from "../../apps/web/src/editors/view-lock";

afterEach(() => {
  document.body.innerHTML = "";
});

function grid() {
  document.body.innerHTML = `
    <div class="sheet-host">
      <canvas class="grid" height="600"></canvas>
      <canvas class="reply" height="40"></canvas>
      <div data-u-comp="defined-name"><input aria-label="Name box"></div>
      <div data-u-comp="formula-editor"></div>
      <div class="thread-comment-panel"><p>Reply</p></div>
    </div>
    <input aria-label="File title">
  `;
  const q = (selector: string) => document.querySelector(selector) as HTMLElement;
  return { grid: q("canvas.grid"), reply: q("canvas.reply"), nameBox: q("[aria-label='Name box']"), comment: q(".thread-comment-panel p"), title: q("[aria-label='File title']") };
}

const press = (target: Element, init: KeyboardEventInit = { key: "x" }) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};
const fire = (target: Node, type: string) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};

describe("keeping a viewer out of the grid", () => {
  it("swallows typing, pasting, cutting, and dropping in the grid for a viewer", () => {
    const parts = grid();
    let access: SheetAccess = "view";
    const stop = attachSheetViewLock(() => true, () => access);
    expect(press(parts.grid)).toBe(true);
    expect(press(parts.grid, { key: "ArrowDown" })).toBe(false);
    expect(press(parts.grid, { key: "c", metaKey: true })).toBe(false);
    for (const type of ["paste", "cut", "drop", "beforeinput"]) expect(fire(parts.grid, type)).toBe(true);
    expect(press(parts.nameBox)).toBe(false);
    expect(press(parts.title)).toBe(false);
    access = "edit";
    expect(press(parts.grid)).toBe(false);
    stop();
    access = "view";
    expect(press(parts.grid)).toBe(false);
  });

  it("lets a commenter type a reply, in the reply box or after clicking the comment panel", () => {
    const parts = grid();
    const stop = attachSheetViewLock(() => true, () => "comment");
    expect(press(parts.reply)).toBe(false);
    expect(press(parts.grid)).toBe(true);
    parts.comment.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(press(parts.grid)).toBe(false);
    parts.grid.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(press(parts.grid)).toBe(true);
    const text = document.createTextNode("reply");
    parts.comment.append(text);
    text.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(press(parts.grid)).toBe(false);
    stop();
  });

  it("does nothing while the sheet is not locked", () => {
    const parts = grid();
    const stop = attachSheetViewLock(() => false, () => "view");
    expect(press(parts.grid)).toBe(false);
    stop();
  });

  it("leaves function keys and Alt shortcuts alone, but not F2 or Delete", () => {
    const base = { key: "F5", meta: false, ctrl: false, alt: false, kind: "key" as const, inNameBox: false, inFilter: false, inComment: false, inSheet: true, inOutsideField: false, inMenu: false, access: "view" as const };
    expect(swallowsSheetEdit(base)).toBe(false);
    expect(swallowsSheetEdit({ ...base, key: "F2" })).toBe(true);
    expect(swallowsSheetEdit({ ...base, key: "Delete" })).toBe(true);
    expect(swallowsSheetEdit({ ...base, key: "x", alt: true })).toBe(false);
    expect(swallowsSheetEdit({ ...base, key: "v", ctrl: true })).toBe(true);
    expect(swallowsSheetEdit({ ...base, inSheet: false, key: "x" })).toBe(false);
  });
});

describe("the formula bar for a viewer", () => {
  it("greys the formula editor while locked, including editors added later", async () => {
    const parts = grid();
    let locked = true;
    const root = parts.grid.parentElement!;
    const stop = watchFormulaBar(root, () => locked);
    const editor = root.querySelector<HTMLElement>("[data-u-comp='formula-editor']")!;
    expect(editor.dataset.viewLocked).toBe("");
    expect(editor.getAttribute("aria-disabled")).toBe("true");
    locked = false;
    const later = document.createElement("div");
    later.dataset.uComp = "formula-editor";
    root.append(later);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.dataset.viewLocked).toBeUndefined();
    expect(later.getAttribute("aria-disabled")).toBe("false");
    stop();
  });
});

describe("one-click filter views", () => {
  it("skips blank headers, columns of unique names, and too few rows", () => {
    expect(filterViewChoices([["Bed"], ["North"]])).toEqual([]);
    const rows = [
      ["", "Name", "Bed"],
      ["x", "Rosa", "North"],
      ["x", "Ada", "South"],
      ["y", "Sam", "North"],
    ];
    expect(filterViewChoices(rows).map((choice) => choice.label)).toEqual(["Bed: North", "Bed: South"]);
    expect(filterViewChoices([["Name"], ["Rosa"], ["Ada"], ["Sam"]])).toEqual([]);
  });
});
