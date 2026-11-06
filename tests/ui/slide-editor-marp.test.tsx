// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";
import type { Presentation } from "../../packages/core/src";
import { connectDocs } from "../../packages/core/src/collab";
import { exportText } from "../../apps/web/src/storage";
import { buildMarpFile } from "../../apps/web/src/editors/slide-marp-import";
import { fitMarpDeck, MARP_FIT_REVISION } from "../../apps/web/src/editors/slide-marp-fit";
import { mirrorSlides } from "../../apps/web/src/collab/slide-room";
import { noteSlideEdit } from "../../apps/web/src/collab/slide-undo";
import { box, openSlides, setupSlidesDom, words, type OpenOptions } from "./slide-editor-harness";

vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({ default: "/* @theme beam_ut */" }));
vi.mock("../../apps/web/src/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/web/src/storage")>()),
  exportText: vi.fn(async () => undefined),
}));
vi.mock("../../apps/web/src/editors/slide-marp-fit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/web/src/editors/slide-marp-fit")>()),
  fitMarpDeck: vi.fn(async (deck: Presentation) => (await import("../marp-fixtures")).fakeFit(deck)),
}));

setupSlidesDom();

const SOURCE = `---
marp: true
---

# Launch plan

Ship the beta in May.

Then tell everyone.

<div class="note">Raw HTML</div>

---

# Risks

- Hiring
`;

function openMarp(markdown = SOURCE, options: OpenOptions & { change?: (deck: Presentation) => void } = {}) {
  const built = buildMarpFile("Plan", markdown).content;
  return openSlides({
    ...options,
    slides: {},
    edit: (deck) => {
      for (const key of Object.keys(deck)) delete (deck as Record<string, unknown>)[key];
      Object.assign(deck, structuredClone(built));
      options.change?.(deck);
    },
  });
}

const markdown = () => screen.getByLabelText("Presentation markdown") as HTMLTextAreaElement;
const fitted = (editor: ReturnType<typeof openSlides>) =>
  waitFor(() => expect(editor.deck().marpFit).toBe(MARP_FIT_REVISION), { timeout: 5000 });

describe("a MARP deck in the editor", () => {
  it("switches mobile views and commits pending markdown before returning to the slide", async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      const editor = openMarp();
      await fitted(editor);
      expect(screen.queryByLabelText("Presentation markdown")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Show markdown", exact: true }));
      expect(markdown().value).toBe(SOURCE);
      fireEvent.change(markdown(), { target: { value: SOURCE.replace("Ship the beta", "Ship the gamma") } });
      fireEvent.click(screen.getByRole("button", { name: "Show slide editor", exact: true }));
      expect(screen.queryByLabelText("Presentation markdown")).toBeNull();
      await waitFor(() => expect(editor.deck().marpSource).toContain("Ship the gamma"));
      fireEvent.click(screen.getByRole("button", { name: "Show markdown", exact: true }));
      expect(markdown().value).toContain("Ship the gamma");
      editor.unmount();
      openMarp(SOURCE, { readOnly: true });
      fireEvent.click(screen.getByRole("button", { name: "Show markdown", exact: true }));
      expect(markdown().readOnly).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Show slide editor", exact: true }));
      expect(screen.queryByLabelText("Presentation markdown")).toBeNull();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    }
  });
  it("exports the markdown that was typed but not yet followed by the slides", async () => {
    const editor = openMarp();
    fireEvent.change(markdown(), { target: { value: SOURCE.replace("Ship the beta", "Ship the gamma") } });
    await act(() => editor.actions().export("txt"));
    expect(vi.mocked(exportText).mock.lastCall?.[1]).toContain("Ship the gamma");
    fireEvent.change(markdown(), { target: { value: SOURCE.replace("Ship the beta", "Ship the delta") } });
    await act(() => editor.actions().export("html"));
    expect(vi.mocked(exportText).mock.lastCall?.[1]).toContain("Ship the delta");
  });

  it("writes markdown for a MARP deck saved before its markdown was kept", async () => {
    const editor = openMarp(SOURCE, { change: (deck) => delete deck.marpSource });
    expect(markdown().value).toContain("# Launch plan");
    expect(editor.onChange).toHaveBeenCalledWith(expect.objectContaining({ marpSource: expect.stringContaining("# Risks") }), expect.anything());
    const viewer = openMarp(SOURCE, { readOnly: true, change: (deck) => delete deck.marpSource });
    await fitted(viewer);
    expect(viewer.deck().marpSource).toContain("# Launch plan");
    expect(viewer.onChange).not.toHaveBeenCalled();
  });

  it("still settles the layout when measuring the slides fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fitMarpDeck).mockRejectedValueOnce(new Error("No frame to measure in"));
    const editor = openMarp();
    await fitted(editor);
    expect(error).toHaveBeenCalledWith("No frame to measure in");
  });

  it("selects the lines of an HTML block in the markdown on a double-click", async () => {
    const editor = openMarp();
    await fitted(editor);
    fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
    expect(screen.queryByLabelText("Presentation markdown")).toBeNull();
    const html = editor.elements().find((el) => el.marpHtml)!;
    fireEvent.doubleClick(box(html.id));
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const area = markdown();
    expect(document.activeElement).toBe(area);
    expect(area.value.slice(area.selectionStart, area.selectionEnd)).toBe('<div class="note">Raw HTML</div>');
  });

  it("shows where a chosen slide is written in the markdown", async () => {
    const editor = openMarp();
    await fitted(editor);
    fireEvent.click(document.querySelector(`.thumbnail-row[data-slide-id="${editor.order()[1]}"]`)!);
    const area = markdown();
    expect(area.value.slice(area.selectionStart, area.selectionStart + 12)).toBe("---\n\n# Risks");
  });

  it("moves a laid-out box to a new place in the reading order by dragging it, but not the title", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const full = this.matches(".slide-canvas, .slide-stage-viewport");
      return { left: 0, top: 0, width: full ? 960 : 0, height: full ? 540 : 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    });
    const editor = openMarp();
    const body = () => editor.elements().filter((el) => el.type === "text" && el.placeholder !== "Click to add title");
    await fitted(editor);
    const moved = body().find((el) => el.content?.includes("Ship"))!;
    fireEvent.mouseDown(box(moved.id), { clientX: 100, clientY: moved.y });
    fireEvent.mouseMove(window, { clientX: 100, clientY: moved.y + 3 });
    fireEvent.mouseMove(window, { clientX: 100, clientY: 530 });
    expect(editor.onChange).toHaveBeenCalled();
    fireEvent.mouseUp(window);
    expect(markdown().value.indexOf("Then tell everyone.")).toBeLessThan(markdown().value.indexOf("Ship the beta"));

    const title = editor.elements().find((el) => el.placeholder === "Click to add title")!;
    const before = markdown().value;
    fireEvent.mouseDown(box(title.id), { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 0, clientY: 300 });
    fireEvent.mouseUp(window);
    expect(markdown().value).toBe(before);
  });

  it("adds pictures and text to the markdown's flow, and refuses sound, which markdown cannot hold", async () => {
    const editor = openMarp();
    act(() => editor.slide().insertTextBox());
    expect(editor.elements().at(-1)).toMatchObject({ placeholder: "Click to add text", fontSize: 20 });
    const image = document.querySelector<HTMLInputElement>('input[type="file"][accept^="image"]')!;
    fireEvent.change(image, { target: { files: [new File(["png"], "chart.png", { type: "image/png" })] } });
    await waitFor(() => expect(editor.elements().some((el) => el.type === "image")).toBe(true));
    expect(editor.elements().find((el) => el.type === "image")!.y).toBeLessThan(10000);

    await fitted(editor);
    const placed = editor.elements().map(({ id, x, y }) => ({ id, x, y }));
    const audio = document.querySelector<HTMLInputElement>('input[type="file"][accept^="audio"]')!;
    fireEvent.change(audio, { target: { files: [new File(["ID3"], "chime.mp3", { type: "audio/mpeg" })] } });
    await waitFor(() =>
      expect(editor.onError).toHaveBeenCalledWith(
        "Markdown cannot describe that change, so it was not made. Make it in the markdown instead.",
      ),
    );
    expect(editor.elements().some((el) => el.type === "audio")).toBe(false);
    const after = editor.elements();
    for (const { id, x, y } of placed) expect(after.find((el) => el.id === id)).toMatchObject({ x, y });
    act(() => editor.slide().insertTextBox());
    expect(editor.elements().at(-1)?.placeholder).toBeUndefined();
  });

  it("keeps the slide pane and the markdown at the width the border is dragged to", () => {
    openMarp();
    const handle = screen.getByRole("separator", { name: "Resize the slide and markdown panes" });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const pane = this.matches(".marp-pane");
      return { left: pane ? 600 : 0, right: pane ? 1000 : 600, width: pane ? 400 : 600, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    });
    fireEvent.pointerDown(handle, { button: 2 });
    expect(handle.className).not.toContain("dragging");
    fireEvent.pointerMove(handle, { clientX: 300 });
    fireEvent.pointerDown(handle, { button: 0, clientX: 500 });
    expect(handle.className).toContain("dragging");
    expect(handle.parentElement!.className).toContain("marp-resizing");
    fireEvent.pointerMove(handle, { clientX: 700 });
    expect(handle.getAttribute("aria-valuenow")).toBe("70");
    fireEvent.pointerUp(handle);
    expect(localStorage.getItem("suiteleaf.marpSplit")).toBe("0.7");
    expect(handle.parentElement!.className).not.toContain("marp-resizing");
    fireEvent.pointerUp(handle);
    fireEvent.pointerDown(handle, { button: 0 });
    fireEvent.pointerCancel(handle);
    fireEvent.doubleClick(handle);
    expect(handle.getAttribute("aria-valuenow")).toBe("50");
    fireEvent.keyDown(handle, { key: "End" });
    expect(handle.getAttribute("aria-valuenow")).toBe("72");
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(handle.getAttribute("aria-valuenow")).toBe("62");
    fireEvent.keyDown(handle, { key: "Tab" });
    expect(handle.getAttribute("aria-valuenow")).toBe("62");
  });

  it("moves the markdown caret a screen at a time with Page Down and Page Up", () => {
    openMarp(`---\nmarp: true\n---\n\n${Array.from({ length: 40 }, (_, i) => `Line ${i}`).join("\n\n")}\n`);
    const area = markdown();
    vi.spyOn(area, "clientHeight", "get").mockReturnValue(100);
    area.focus();
    area.setSelectionRange(0, 0);
    fireEvent.keyDown(area, { key: "PageDown" });
    const down = area.selectionStart;
    expect(down).toBeGreaterThan(0);
    expect(area.selectionEnd).toBe(down);
    fireEvent.keyDown(area, { key: "PageDown", shiftKey: true });
    expect(area.selectionStart).toBe(down);
    expect(area.selectionEnd).toBeGreaterThan(down);
    fireEvent.keyDown(area, { key: "PageUp" });
    fireEvent.keyDown(area, { key: "PageUp" });
    fireEvent.keyDown(area, { key: "PageUp" });
    expect(area.selectionStart).toBe(0);
    area.setSelectionRange(area.value.length - 2, area.value.length - 2);
    for (let i = 0; i < 30; i++) fireEvent.keyDown(area, { key: "PageDown" });
    expect(area.selectionStart).toBe(area.value.length);
    area.setSelectionRange(10, 20, "backward");
    fireEvent.keyDown(area, { key: "PageUp", shiftKey: true });
    expect([area.selectionStart, area.selectionEnd]).toEqual([3, 20]);
    fireEvent.keyDown(area, { key: "PageDown", metaKey: true });
    expect([area.selectionStart, area.selectionEnd]).toEqual([3, 20]);
  });
});

describe("a shared room", () => {
  it("shows other people's slide edits and undoes only this person's own", async () => {
    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    const onUndoConflict = vi.fn();
    const editor = openSlides({ props: { collabDoc: local, onUndoConflict } });
    act(() => {
      mirrorSlides(remote, { slideOrder: ["a", "b", "c"], slides: { b: { id: "b", elements: [words("b-words", "From Ada")] } } }, { edited: ["b"] });
    });
    expect(editor.elements("b")[0].content).toBe("From Ada");
    act(() => {
      remote.getMap<string>("slideOrder").set("order", JSON.stringify(["c", "a", "b"]));
    });

    const snap = () => ({
      elements: new Map(local.getMap<string>("slideElements").entries()),
      slides: new Map(local.getMap<string>("slides").entries()),
    });
    const before = snap();
    mirrorSlides(local, { slideOrder: ["a", "b", "c"], slides: { a: { id: "a", elements: [words("a-words", "Mine")] } } }, { edited: ["a"] });
    const after = snap();
    noteSlideEdit(local, before.elements, after.elements, before.slides, after.slides);
    remote.getMap<string>("slideElements").set("a\u001fa-words", JSON.stringify(words("a-words", "Theirs")));
    act(() => editor.slide().undo());
    expect(onUndoConflict).toHaveBeenCalledWith(expect.stringContaining("changed by someone else"));
    act(() => editor.slide().redo());
    expect(onUndoConflict).toHaveBeenCalledTimes(1);
    act(() => editor.slide().newSlide());
    act(() => editor.slide().undo());
    act(() => editor.slide().redo());
  });
});
