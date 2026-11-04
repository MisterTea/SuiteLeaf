// @vitest-environment jsdom
import { act, fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { exportBinary, exportText, printDocument } from "../../apps/web/src/storage";
import { box, openSlides, pick, press, setupSlidesDom, words } from "./slide-editor-harness";

vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({ default: "/* @theme beam_ut */" }));
vi.mock("../../apps/web/src/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/web/src/storage")>()),
  exportText: vi.fn(async () => undefined),
  exportBinary: vi.fn(async () => undefined),
  printDocument: vi.fn(async () => undefined),
}));

setupSlidesDom();

const meta = { metaKey: true };
const thumbnail = (id: string) => document.querySelector<HTMLElement>(`.thumbnail-row[data-slide-id="${id}"]`)!;
const chosen = () =>
  [...document.querySelectorAll<HTMLElement>('.thumbnail-row[aria-selected="true"]')].map((row) => row.dataset.slideId);

describe("whole slides from the menus", () => {
  it("adds, duplicates, moves, deletes, and brings slides back with Undo", () => {
    const editor = openSlides();
    expect(editor.slide().undoReason()).toBe("Nothing to undo");
    expect(editor.slide().redoReason()).toBe("Nothing to redo");
    act(() => editor.slide().newSlide());
    expect(editor.order()).toHaveLength(4);
    const added = editor.order()[1];
    expect(editor.active()).toBe(added);
    expect(editor.slide().undoReason()).toBeUndefined();

    act(() => editor.slide().duplicate());
    expect(editor.order()).toHaveLength(5);
    expect(editor.order()[1]).toBe(added);

    act(() => editor.slide().move("start"));
    expect(editor.order()[0]).toBe(editor.active());

    act(() => editor.slide().deleteSlides());
    expect(editor.order()).toHaveLength(4);
    expect(screen.getByRole("status").textContent).toContain("Slide deleted");
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    expect(editor.order()).toHaveLength(5);
    expect(screen.queryByText("Slide deleted")).toBeNull();

    act(() => editor.slide().undo());
    act(() => editor.slide().undo());
    expect(editor.order()).toEqual(["a", added, "b", "c"]);
    expect(editor.slide().redoReason()).toBeUndefined();
    act(() => editor.slide().redo());
    expect(editor.order()).toHaveLength(5);
  });

  it("explains why slides cannot be deleted and keeps the last one", () => {
    const editor = openSlides({ slides: { only: [words("w", "Only")] } });
    expect(editor.slide().deleteReason()).toBe("Presentations must have at least one slide.");
    act(() => editor.slide().deleteSlides());
    expect(editor.onError).toHaveBeenCalled();
    expect(editor.order()).toEqual(["only"]);
    expect(openSlides().slide().deleteReason()).toBeUndefined();
  });

  it("turns slide numbers on and off", () => {
    const editor = openSlides();
    expect(editor.slide().slideNumbers()).toBe(false);
    act(() => editor.slide().toggleSlideNumbers());
    expect(editor.deck().slideNumbers).toBe(true);
    expect(editor.slide().slideNumbers()).toBe(true);
    act(() => editor.slide().toggleSlideNumbers());
    expect(editor.deck().slideNumbers).toBeUndefined();
  });

  it("flushes the deck to the file and saves it in each format", async () => {
    const editor = openSlides({
      title: "Quarterly",
      slides: {
        a: [words("a-words", "Intro")],
        b: [words("b-words", "Plan")],
        c: [words("c-words", "Close", { placeholder: "Click to add title" })],
      },
    });
    await act(() => editor.actions().flush());
    expect(editor.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ slideOrder: ["a", "b", "c"] }));

    await act(() => editor.actions().export("txt"));
    expect(vi.mocked(exportText).mock.lastCall?.[0]).toBe("Quarterly.txt");
    expect(vi.mocked(exportText).mock.lastCall?.[1]).toContain("Plan");
    await act(() => editor.actions().export("html"));
    expect(vi.mocked(exportText).mock.lastCall?.[0]).toBe("Quarterly.html");
    expect(vi.mocked(exportText).mock.lastCall?.[1]).toContain("<html");
    await act(() => editor.actions().export("md"));
    expect(vi.mocked(exportText).mock.lastCall?.[0]).toBe("Quarterly.md");
    expect(vi.mocked(exportText).mock.lastCall?.[1]).toContain("# Close");
    await act(() => editor.actions().export("pptx"));
    expect(vi.mocked(exportBinary).mock.lastCall?.[0]).toBe("Quarterly.pptx");
    expect(vi.mocked(exportBinary).mock.lastCall?.[1]).toBeInstanceOf(Uint8Array);
    await expect(editor.actions().export("png")).rejects.toThrow("desktop app");

    const save = vi.fn<(file: string) => Promise<undefined>>(async () => undefined);
    vi.stubGlobal("suiteleaf", { exportSlidesPng: save });
    window.suiteleaf = { exportSlidesPng: save } as unknown as typeof window.suiteleaf;
    await act(() => editor.actions().export("png"));
    expect(JSON.parse(save.mock.lastCall![0]).content.slideOrder).toEqual(["a", "b", "c"]);
    delete (window as { suiteleaf?: unknown }).suiteleaf;

    await act(() => editor.actions().print());
    expect(printDocument).toHaveBeenCalled();
  });
});

describe("the keyboard", () => {
  it("adds one slide for Cmd+M", () => {
    const editor = openSlides();
    press("m", meta);
    expect(editor.order()).toHaveLength(4);
    press("m", { ctrlKey: true });
    expect(editor.order()).toHaveLength(5);
  });

  it("copies, cuts, pastes, nudges, and deletes the selected object", () => {
    const editor = openSlides();
    pick("a-words");
    press("c", meta);
    press("v", meta);
    const pasted = editor.elements("a");
    expect(pasted).toHaveLength(2);
    expect(pasted[1]).toMatchObject({ content: "Intro" });
    expect(pasted[1].x).toBeGreaterThan(pasted[0].x);

    press("ArrowRight");
    press("ArrowDown", { shiftKey: true });
    const nudged = editor.elements("a")[1];
    expect([nudged.x - pasted[1].x, nudged.y - pasted[1].y]).toEqual([1, 10]);

    press("x", meta);
    expect(editor.elements("a")).toHaveLength(1);
    press("v", meta);
    expect(editor.elements("a")).toHaveLength(2);
    press("Delete");
    expect(editor.elements("a")).toHaveLength(1);

    pick("a-words");
    press("b", meta);
    press("i", meta);
    press("u", meta);
    expect(editor.elements("a")[0]).toMatchObject({ bold: true, italic: true, underline: true });
    press("z", meta);
    expect(editor.elements("a")[0].underline).toBeFalsy();
    press("z", { metaKey: true, shiftKey: true });
    expect(editor.elements("a")[0].underline).toBe(true);
    press("y", meta);
  });

  it("copies, cuts, pastes, duplicates, moves, and deletes whole slides when no object is selected", () => {
    const editor = openSlides();
    press("c", meta);
    press("v", meta);
    expect(editor.order()).toHaveLength(4);
    expect(editor.elements(editor.order()[1])[0].content).toBe("Intro");
    press("x", meta);
    expect(editor.order()).toEqual(["a", "b", "c"]);
    press("d", meta);
    expect(editor.order()).toHaveLength(4);
    press("ArrowDown", { metaKey: true, shiftKey: true });
    expect(editor.order().at(-1)).toBe(editor.active());
    press("ArrowUp", meta);
    expect(editor.order().at(-2)).toBe(editor.active());
    press("Backspace");
    expect(editor.order()).toEqual(["a", "b", "c"]);
  });

  it("lets a viewer copy and step but not change anything", () => {
    const editor = openSlides({ readOnly: true });
    press("d", meta);
    press("Delete");
    press("m", meta);
    expect(editor.order()).toEqual(["a", "b", "c"]);
    press("c", meta);
    press("ArrowRight");
    expect(editor.active()).toBe("b");
    expect(editor.onChange).not.toHaveBeenCalled();
  });

  it("presents from the current slide with Cmd+Enter and from the start with Shift", () => {
    const editor = openSlides();
    press("ArrowRight");
    press("Enter", meta);
    expect(screen.getByRole("dialog", { name: "Slideshow" }).textContent).toContain("Slide 2 of 3");
    press("Escape");
    expect(screen.queryByRole("dialog", { name: "Slideshow" })).toBeNull();
    press("Enter", { metaKey: true, shiftKey: true });
    expect(screen.getByRole("dialog", { name: "Slideshow" }).textContent).toContain("Slide 1 of 3");
    expect(editor.active()).toBe("b");
  });

  it("leaves typing in a box with Escape", () => {
    openSlides();
    pick("a-words");
    fireEvent.doubleClick(box("a-words"));
    expect(document.querySelector(".slide-canvas .element-editor, .slide-canvas [contenteditable]")).not.toBeNull();
    const area = box("a-words").querySelector<HTMLElement>("textarea, [contenteditable]")!;
    area.focus();
    press("Escape", {}, area);
    expect(document.activeElement).not.toBe(area);
    expect(document.querySelector(".slide-canvas [contenteditable='true']")).toBeNull();
  });
});

describe("the slide list", () => {
  it("chooses ranges with Shift, adds and removes slides with Cmd, and extends with Shift+arrows", () => {
    const editor = openSlides();
    fireEvent.click(thumbnail("c"), { shiftKey: true });
    expect(chosen()).toEqual(["a", "b", "c"]);
    fireEvent.click(thumbnail("b"), meta);
    expect(chosen()).toEqual(["a", "c"]);
    fireEvent.click(thumbnail("b"), meta);
    expect(chosen()).toEqual(["a", "b", "c"]);
    fireEvent.click(thumbnail("a"));
    expect(chosen()).toEqual(["a"]);

    const list = screen.getByRole("listbox", { name: "Slides" });
    fireEvent.keyDown(list, { key: "ArrowDown", shiftKey: true });
    expect(chosen()).toEqual(["a", "b"]);
    fireEvent.keyDown(list, { key: "ArrowDown", metaKey: true });
    fireEvent.keyDown(list, { key: "Tab" });
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(editor.active()).toBe("a");
  });

  it("moves, duplicates, deletes, and adds slides from the sidebar buttons", () => {
    const editor = openSlides();
    const button = (title: string) => screen.getByTitle(title);
    expect(button("Move slide up")).toHaveProperty("disabled", true);
    fireEvent.click(button("Move slide down"));
    expect(editor.order()).toEqual(["b", "a", "c"]);
    fireEvent.click(button("Move slide up"));
    expect(editor.order()).toEqual(["a", "b", "c"]);
    fireEvent.click(button("Duplicate slide"));
    expect(editor.order()).toHaveLength(4);
    fireEvent.click(button("Delete slide"));
    expect(editor.order()).toEqual(["a", "b", "c"]);
    fireEvent.click(button("New slide (Cmd+M)"));
    expect(editor.order()).toHaveLength(4);
    expect(screen.getByText("Slides (4)")).toBeTruthy();
  });

  it("opens a menu on right-click that duplicates, moves, and deletes, and closes on a press elsewhere", () => {
    const editor = openSlides();
    const menu = () => screen.queryByRole("menu");
    fireEvent.contextMenu(thumbnail("b"), { clientX: 20, clientY: 30 });
    expect(editor.active()).toBe("b");
    fireEvent.click(within(menu()!).getByRole("menuitem", { name: /Move to end/ }));
    expect(editor.order()).toEqual(["a", "c", "b"]);
    fireEvent.contextMenu(thumbnail("b"));
    fireEvent.click(within(menu()!).getByRole("menuitem", { name: /Move to start/ }));
    expect(editor.order()).toEqual(["b", "a", "c"]);
    fireEvent.contextMenu(thumbnail("b"));
    fireEvent.click(within(menu()!).getByRole("menuitem", { name: /Duplicate slide/ }));
    expect(editor.order()).toHaveLength(4);
    fireEvent.contextMenu(thumbnail("b"));
    fireEvent.click(within(menu()!).getByRole("menuitem", { name: /Delete slide/ }));
    expect(editor.order()).toHaveLength(3);

    fireEvent.contextMenu(thumbnail("a"));
    fireEvent.pointerDown(within(menu()!).getAllByRole("menuitem")[0]);
    expect(menu()).not.toBeNull();
    fireEvent.pointerDown(document.body);
    expect(menu()).toBeNull();
    fireEvent.contextMenu(thumbnail("a"));
    press("Escape");
    expect(menu()).toBeNull();
  });

  it("does not open the menu for a viewer", () => {
    openSlides({ readOnly: true });
    fireEvent.contextMenu(thumbnail("b"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("drags slides into a new place along the filmstrip", async () => {
    const editor = openSlides();
    expect(getComputedStyle(screen.getByRole("listbox")).flexDirection).toBe("row");
    const rows = () => [...document.querySelectorAll<HTMLElement>(".thumbnail-row")];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const index = rows().indexOf(this);
      const left = index < 0 ? 0 : index * 100;
      return { left, top: 0, width: 100, height: 60, right: left + 100, bottom: 60, x: left, y: 0, toJSON() {} } as DOMRect;
    });
    fireEvent.mouseDown(thumbnail("a"), { button: 0, clientX: 50, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 52, clientY: 10 });
    expect(document.querySelector(".thumbnails-list.dragging")).toBeNull();
    fireEvent.mouseMove(window, { clientX: 230, clientY: 10 });
    expect(document.querySelector(".thumbnails-list.dragging")).not.toBeNull();
    expect(thumbnail("a").className).toContain("drag-source");
    expect(thumbnail("c").className).toContain("drop-before");
    fireEvent.mouseMove(window, { clientX: 231, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 400, clientY: 10 });
    expect(thumbnail("c").className).toContain("drop-after");
    fireEvent.mouseUp(window);
    expect(editor.order()).toEqual(["b", "c", "a"]);
    fireEvent.click(thumbnail("b"));
    expect(editor.active()).toBe("a");
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.click(thumbnail("b"));
    expect(editor.active()).toBe("b");

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowRight" });
    expect(editor.active()).toBe("c");
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowLeft" });
    expect(editor.active()).toBe("b");

    fireEvent.mouseDown(thumbnail("c"), { button: 0, clientX: 150, clientY: 10 });
    fireEvent.mouseUp(window);
    expect(editor.active()).toBe("c");
    fireEvent.mouseDown(thumbnail("b"), { button: 0, clientX: 50, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 20, clientY: 10 });
    fireEvent.mouseUp(window);
    expect(editor.order()).toEqual(["b", "c", "a"]);
    fireEvent.mouseDown(thumbnail("a"), { button: 2 });
    const native = new Event("dragstart", { cancelable: true });
    window.dispatchEvent(native);
    expect(native.defaultPrevented).toBe(true);
    expect(editor.active()).toBe("b");
  });

  it("links each slide to its address when the file is known", () => {
    openSlides({ fileId: "deck-1" });
    expect(thumbnail("b").getAttribute("href")).toContain("deck-1");
  });
});
