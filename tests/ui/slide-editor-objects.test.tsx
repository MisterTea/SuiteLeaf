// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DECK_THEMES } from "../../apps/web/src/editors/slide-theme";
import { box, choose, openSlides, pick, press, setupSlidesDom, words } from "./slide-editor-harness";

vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({ default: "/* @theme beam_ut */" }));

setupSlidesDom();

const shape = (id: string, x: number, extra = {}) => ({
  id,
  type: "shape" as const,
  shapeType: "rect" as const,
  x,
  y: 100,
  width: 100,
  height: 60,
  ...extra,
});

/** The stage is drawn at the deck's own width, so a pixel on screen is a point on the slide. */
function stageAtDeckSize() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const full = this.matches(".slide-stage-viewport, .slide-canvas");
    const width = full ? 960 : 0;
    const height = full ? 540 : 0;
    return { left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON() {} } as DOMRect;
  });
}

function upload(input: HTMLInputElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

function sized(file: File, size: number) {
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("inserting objects", () => {
  it("adds a text box, shapes, and word art to the slide and selects each", () => {
    const editor = openSlides();
    act(() => editor.slide().insertTextBox());
    const added = editor.elements("a").at(-1)!;
    expect(added).toMatchObject({ type: "text" });
    expect(box(added.id).className).toContain("selected");
    expect(document.activeElement).toBe(box(added.id).querySelector("textarea"));

    act(() => editor.slide().insertShape("ellipse"));
    expect(editor.elements("a").at(-1)).toMatchObject({ type: "shape", shapeType: "ellipse" });
    fireEvent.click(screen.getByRole("button", { name: "Rectangle" }));
    expect(editor.elements("a").at(-1)).toMatchObject({ shapeType: "roundRect" });
    fireEvent.click(screen.getByRole("button", { name: "Circle" }));
    fireEvent.click(screen.getByRole("button", { name: "Insert text box" }));
    expect(editor.elements("a")).toHaveLength(6);

    act(() => editor.slide().insertWordArt());
    const dialog = screen.getByRole("dialog", { name: "Word art" });
    fireEvent.submit(dialog);
    expect(screen.getByRole("dialog", { name: "Word art" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "  Big news " } });
    fireEvent.submit(dialog);
    expect(screen.queryByRole("dialog", { name: "Word art" })).toBeNull();
    expect(editor.elements("a").at(-1)).toMatchObject({ content: "Big news", wordArt: expect.any(String) });

    act(() => editor.slide().insertWordArt());
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Word art" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Word art" })).toBeNull();
  });

  it("puts a chosen picture on the slide and turns away one that is too large", async () => {
    const editor = openSlides();
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept^="image"]')!;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    act(() => editor.slide().insertImage());
    expect(click).toHaveBeenCalled();

    upload(input, sized(new File(["x"], "huge.png", { type: "image/png" }), 6 * 1024 * 1024));
    expect(editor.onError).toHaveBeenCalledWith("Please choose an image smaller than 5 MB.");
    fireEvent.change(input, { target: { files: [] } });

    upload(input, new File(["png"], "logo.png", { type: "image/png" }));
    await waitFor(() => expect(editor.elements("a").at(-1)).toMatchObject({ type: "image", alt: "logo.png" }));
    expect(editor.elements("a").at(-1)?.src).toMatch(/^data:image\/png;base64,/);
  });

  it("adds sound and video, and explains files it cannot use", async () => {
    const editor = openSlides();
    const audio = document.querySelector<HTMLInputElement>('input[type="file"][accept^="audio"]')!;
    const video = document.querySelector<HTMLInputElement>('input[type="file"][accept^="video"]')!;
    const clicks = [vi.spyOn(audio, "click").mockImplementation(() => {}), vi.spyOn(video, "click").mockImplementation(() => {})];
    act(() => editor.slide().insertAudio());
    act(() => editor.slide().insertVideo());
    expect(clicks.map((spy) => spy.mock.calls.length)).toEqual([1, 1]);

    upload(audio, new File(["x"], "notes.txt", { type: "text/plain" }));
    expect(editor.onError).toHaveBeenLastCalledWith("Choose a WAV, MP3, or Ogg audio file.");
    upload(video, new File(["x"], "clip.avi", { type: "video/avi" }));
    expect(editor.onError).toHaveBeenLastCalledWith("Choose an MP4 or WebM video.");
    upload(audio, sized(new File(["x"], "long.mp3", { type: "audio/mpeg" }), 6 * 1024 * 1024));
    expect(editor.onError).toHaveBeenLastCalledWith("Please choose an audio file smaller than 5 MB.");
    upload(video, sized(new File(["x"], "long.mp4", { type: "video/mp4" }), 6 * 1024 * 1024));
    expect(editor.onError).toHaveBeenLastCalledWith("Please choose a video smaller than 5 MB.");
    fireEvent.change(audio, { target: { files: [] } });

    upload(audio, new File(["ID3"], "chime.mp3", { type: "audio/mpeg" }));
    await waitFor(() => expect(editor.elements("a").at(-1)).toMatchObject({ type: "audio" }));
    upload(video, new File(["webm"], "clip.webm", { type: "" }));
    await waitFor(() => expect(editor.elements("a").at(-1)).toMatchObject({ type: "video" }));
    expect(editor.elements("a").at(-1)?.src).toMatch(/^data:video\/webm/);

    const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
    read.mockImplementationOnce(function (this: FileReader) {
      this.onerror?.(new ProgressEvent("error") as ProgressEvent<FileReader>);
    });
    upload(video, new File(["x"], "bad.mp4", { type: "video/mp4" }));
    expect(editor.onError).toHaveBeenLastCalledWith("Could not read that video.");
    read.mockImplementationOnce(function (this: FileReader) {
      Object.defineProperty(this, "result", { value: null });
      this.onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    });
    upload(audio, new File(["x"], "odd.ogg", { type: "audio/ogg" }));
    expect(editor.onError).toHaveBeenLastCalledWith("Could not read that audio file.");
    expect(editor.elements("a")).toHaveLength(3);
  });
});

describe("arranging objects", () => {
  it("aligns, locks, orders, groups, and distributes the selection from the Align menu", () => {
    const editor = openSlides({
      slides: { a: [shape("one", 100), shape("two", 300, { y: 200 }), shape("three", 700)] },
    });
    pick("two");
    choose("Align", "Align left");
    expect(editor.elements("a").find((el) => el.id === "two")?.x).toBe(0);
    choose("Align", "Align top");
    choose("Align", "Align center");
    choose("Align", "Align right");
    choose("Align", "Align middle");
    choose("Align", "Align bottom");
    expect(editor.elements("a").find((el) => el.id === "two")?.y).toBe(480);

    choose("Align", "Lock");
    expect(editor.elements("a").find((el) => el.id === "two")?.locked).toBe(true);
    choose("Align", "Unlock");
    expect(editor.elements("a").find((el) => el.id === "two")?.locked).toBe(false);

    choose("Align", "Bring to front");
    expect(editor.elements("a").map((el) => el.id)).toEqual(["one", "three", "two"]);
    choose("Align", "Bring to front");
    choose("Align", "Send backward");
    expect(editor.elements("a").map((el) => el.id)).toEqual(["one", "two", "three"]);
    choose("Align", "Send to back");
    choose("Align", "Bring forward");
    expect(editor.elements("a").map((el) => el.id)).toEqual(["one", "two", "three"]);

    pick("one");
    pick("three", { shiftKey: true });
    pick("two", { shiftKey: true });
    choose("Align", "Distribute horizontally");
    choose("Align", "Distribute vertically");
    choose("Align", "Group");
    const grouped = editor.elements("a");
    expect(new Set(grouped.map((el) => el.groupId)).size).toBe(1);
    expect(grouped[0].groupId).toMatch(/^group-/);
    pick("one");
    choose("Align", "Ungroup");
    expect(editor.elements("a").every((el) => !el.groupId)).toBe(true);

    pick("three", { shiftKey: true });
    pick("three", { shiftKey: true });
    choose("Align", "Size and position");
    expect(document.querySelector(".slide-geometry-panel, [aria-label='Size and position']")).not.toBeNull();
  });

  it("moves an object with the mouse, snapping to the slide, and Undo puts it back", () => {
    stageAtDeckSize();
    const editor = openSlides({ slides: { a: [shape("one", 100)] } });
    fireEvent.mouseDown(box("one"), { clientX: 150, clientY: 130 });
    fireEvent.mouseMove(window, { clientX: 153, clientY: 131 });
    expect(editor.onChange).not.toHaveBeenCalled();
    fireEvent.mouseMove(window, { clientX: 213, clientY: 171 });
    expect(editor.elements("a")[0]).toMatchObject({ x: 163, y: 141 });
    fireEvent.mouseMove(window, { clientX: 480, clientY: 130 });
    expect(editor.elements("a")[0].x).toBe(430);
    expect(document.querySelector(".slide-snap-guide")).not.toBeNull();
    fireEvent.mouseUp(window);
    expect(document.querySelector(".slide-snap-guide")).toBeNull();
    act(() => editor.slide().undo());
    expect(editor.elements("a")[0]).toMatchObject({ x: 100, y: 100 });
  });

  it("resizes from each handle without going below the smallest size", () => {
    stageAtDeckSize();
    const editor = openSlides({ slides: { a: [shape("one", 100)] } });
    pick("one");
    const drag = (handle: string, dx: number, dy: number) => {
      fireEvent.mouseDown(document.querySelector(`.handle-${handle}`)!, { clientX: 0, clientY: 0 });
      fireEvent.mouseMove(window, { clientX: dx, clientY: dy });
      fireEvent.mouseUp(window);
      const { x, y, width, height } = editor.elements("a")[0];
      return { x, y, width, height };
    };
    expect(drag("se", 40, 20)).toEqual({ x: 100, y: 100, width: 140, height: 80 });
    expect(drag("nw", 20, 10)).toEqual({ x: 120, y: 110, width: 120, height: 70 });
    expect(drag("w", 500, 0)).toEqual({ x: 210, y: 110, width: 30, height: 70 });
    expect(drag("n", 0, 500)).toEqual({ x: 210, y: 160, width: 30, height: 20 });
    drag("e", 70, 0);
    drag("s", 0, 30);
    drag("ne", 10, -10);
    expect(drag("sw", -10, 10)).toEqual({ x: 200, y: 150, width: 120, height: 70 });
  });

  it("moves a group together and leaves locked objects where they are", () => {
    stageAtDeckSize();
    const editor = openSlides({
      slides: { a: [shape("one", 100, { groupId: "g" }), shape("two", 300, { groupId: "g" }), shape("pin", 600, { locked: true })] },
    });
    fireEvent.mouseDown(box("one"), { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 30, clientY: 20 });
    fireEvent.mouseUp(window);
    expect(editor.elements("a").map((el) => [el.x, el.y])).toEqual([[130, 120], [330, 120], [600, 100]]);
    fireEvent.mouseDown(box("pin"), { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 30, clientY: 20 });
    fireEvent.mouseUp(window);
    expect(editor.elements("a")[2]).toMatchObject({ x: 600, y: 100 });
  });

  it("does not move anything for a viewer, and a press that goes nowhere changes nothing", () => {
    stageAtDeckSize();
    const viewer = openSlides({ readOnly: true, slides: { a: [shape("one", 100)] } });
    fireEvent.mouseDown(box("one"), { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(window, { clientX: 50, clientY: 50 });
    fireEvent.mouseUp(window);
    expect(viewer.elements("a")[0].x).toBe(100);
  });
});

describe("formatting the selection", () => {
  it("fills, outlines, and deletes a shape", () => {
    const editor = openSlides({ slides: { a: [shape("one", 100)] } });
    pick("one");
    choose("Fill", "Light blue");
    expect(editor.elements("a")[0].fill).toBe("#d2e3fc");
    choose("Border", "Dark");
    expect(editor.elements("a")[0]).toMatchObject({ stroke: "#202124", strokeWidth: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Delete element" }));
    expect(editor.elements("a")).toEqual([]);
  });

  it("sets the font, size, autofit, emphasis, accent, alignment, and bullets of a text box", () => {
    const editor = openSlides({ slides: { a: [words("t", "Hello", { fontFamily: "Comic Sans" })] } });
    pick("t");
    const text = () => editor.elements("a")[0];
    const family = screen.getByLabelText("Font family") as HTMLSelectElement;
    expect(family.value).toBe("Comic Sans");
    fireEvent.change(family, { target: { value: "Roboto" } });
    expect(text().fontFamily).toBe("Roboto");
    fireEvent.click(screen.getByRole("button", { name: "Autofit" }));
    expect(text().autofit).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Increase font size" }));
    expect(text().fontSize).toBe(21);
    fireEvent.click(screen.getByRole("button", { name: "Decrease font size" }));
    fireEvent.click(screen.getByRole("button", { name: "Decrease font size" }));
    expect(text().fontSize).toBe(19);
    fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Font size"), { target: { value: "44" } });
    expect(text().fontSize).toBe(44);

    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    fireEvent.click(screen.getByRole("button", { name: "Underline" }));
    expect(text()).toMatchObject({ bold: true, italic: true, underline: true });
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Accent colour for the selection" }));
    expect(text().color).toBe("#188038");

    for (const where of ["center", "right", "left"] as const) {
      fireEvent.click(screen.getByRole("button", { name: `Align ${where}` }));
      expect(text().align).toBe(where);
    }
    act(() => editor.slide().align("center"));
    expect(text().align).toBe("center");
    fireEvent.click(screen.getByRole("button", { name: "Bullet list" }));
    expect(text().bullet).toBe(true);
  });

  it("styles only the selected words while a box is being typed in", () => {
    const editor = openSlides({ slides: { a: [words("t", "Hello world")] } });
    pick("t");
    const area = box("t").querySelector("textarea")!;
    area.focus();
    area.setSelectionRange(0, 5);
    act(() => editor.slide().toggleBold());
    expect(editor.elements("a")[0].runs).toEqual([{ text: "Hello", bold: true }, { text: " world" }]);
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
    act(() => editor.slide().toggleItalic());
    expect(editor.elements("a")[0].runs?.[0]).toMatchObject({ bold: true, italic: true });
    fireEvent.click(screen.getByRole("button", { name: "Accent colour for the selection" }));
    expect(editor.elements("a")[0].runs?.[0]).toMatchObject({ color: "#188038" });
    act(() => editor.slide().toggleBold());
    expect(editor.elements("a")[0].runs?.[0].bold).toBeFalsy();
  });

  it("marks table cells bold and italic", () => {
    const editor = openSlides({
      slides: { a: [{ id: "tbl", type: "table", x: 40, y: 40, width: 400, height: 120, rows: [["a", "b"], ["c", "d"]] }] },
    });
    const cell = box("tbl").querySelectorAll("td, .slide-table-cell")[3] as HTMLElement;
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(window);
    expect(cell.className).toContain("slide-cell-selected");
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    fireEvent.click(screen.getByRole("button", { name: "Italic" }));
    expect(editor.elements("a")[0].cellMarks?.[1]?.[1]).toEqual({ bold: true, italic: true });
    expect(screen.getByRole("button", { name: "Bold" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("paints the background of a slide or every slide and changes its layout", () => {
    const editor = openSlides();
    choose("Background", "Warm sand");
    expect(editor.deck().slides.a.background?.color).toBe("#fef3c7");
    expect(editor.deck().slides.b.background?.color).not.toBe("#fef3c7");
    choose("Background", "Apply to all slides");
    expect(editor.deck().slides.c.background?.color).toBe("#fef3c7");
    choose("Layout", "Two columns");
    expect(editor.deck().slides.a.layout).toBe("two-column");
    act(() => editor.slide().applyLayout("section"));
    expect(editor.deck().slides.a.layout).toBe("section");
  });

  it("puts an object that overrides the theme back to the theme's look", () => {
    const theme = DECK_THEMES.find((item) => item.id !== "beam_ut")!;
    const editor = openSlides({
      slides: { a: [words("t", "Own look", { themeOverride: true, color: "#ff0000" })] },
      edit: (deck) => {
        deck.theme = theme;
      },
    });
    pick("t");
    fireEvent.click(screen.getByRole("button", { name: "Reset to theme" }));
    expect(editor.elements("a")[0].themeOverride).toBeFalsy();
    expect(screen.getByText("Double-click a word to format just that word.")).toBeTruthy();
  });
});

describe("the canvas", () => {
  it("types into a box with styled words and keeps its runs", () => {
    const editor = openSlides({ slides: { a: [words("t", "Hi there", { runs: [{ text: "Hi", bold: true }, { text: " there" }] })] } });
    fireEvent.doubleClick(box("t"));
    const editable = box("t").querySelector<HTMLElement>("[contenteditable='true']")!;
    expect(document.activeElement).toBe(editable);
    editable.lastElementChild!.lastElementChild!.textContent = " there now";
    fireEvent.input(editable);
    expect(editor.elements("a")[0]).toMatchObject({ content: "Hi there now", bold: false });
    expect(editor.elements("a")[0].runs?.[0]).toMatchObject({ text: "Hi", bold: true });
    editable.textContent = "plain";
    fireEvent.input(editable);
    expect(editor.elements("a")[0].runs).toBeUndefined();
  });

  it("selects linked pictures, media, and table cells without following links or playing", () => {
    const editor = openSlides({
      slides: {
        a: [
          { id: "pic", type: "image", x: 0, y: 0, width: 50, height: 50, src: "data:image/png;base64,AA==", href: "https://example.com" },
          { id: "song", type: "audio", x: 100, y: 0, width: 200, height: 60, src: "data:audio/mpeg;base64,AA==" },
          words("link", "See", { y: 200, runs: [{ text: "See", href: "https://example.com" }] }),
        ],
      },
    });
    fireEvent.mouseDown(box("pic").querySelector("a")!);
    expect(box("pic").className).not.toContain("selected");
    fireEvent.mouseDown(box("pic"));
    expect(box("pic").className).toContain("selected");
    fireEvent.mouseDown(box("song").querySelector(".slide-media-play")!);
    expect(box("song").className).not.toContain("selected");
    fireEvent.mouseDown(box("song"));
    expect(box("song").className).toContain("selected");
    fireEvent.mouseDown(box("link").querySelector("a[href]")!);
    expect(box("link").className).not.toContain("selected");
    fireEvent.click(box("pic"));
    expect(editor.onChange).not.toHaveBeenCalled();
  });

  it("explains an SVG picture of a MARP deck whose file did not come in", () => {
    const editor = openSlides({
      slides: { a: [{ id: "svg", type: "image", x: 0, y: 0, width: 50, height: 50, src: "art/logo.svg" }] },
      edit: (deck) => {
        deck.marp = true;
        deck.marpFit = 5;
      },
    });
    fireEvent.doubleClick(box("svg"));
    expect(editor.onError).toHaveBeenCalledWith(expect.stringContaining("art/logo.svg did not come in with the deck"));
    const broken = openSlides({
      slides: { b: [{ id: "bad", type: "image", x: 0, y: 0, width: 50, height: 50, src: "data:image/svg+xml;base64,%%%" }] },
    });
    fireEvent.doubleClick(box("bad"));
    expect(broken.onError).toHaveBeenCalledWith("This picture's SVG could not be read.");
  });

  it("tracks which box has focus on the stage", () => {
    openSlides();
    const area = box("a-words").querySelector("textarea")!;
    fireEvent.focus(area);
    expect(box("a-words").className).toContain("selected");
    fireEvent.blur(area, { relatedTarget: box("b-words") });
    fireEvent.blur(area);
    expect(document.querySelector(".marp-live")).toBeNull();
  });

  it("places the selection exactly from the size and position panel", () => {
    const editor = openSlides({ slides: { a: [shape("one", 100), shape("pin", 300, { locked: true })] } });
    choose("Align", "Size and position");
    const panel = screen.getByRole("region", { name: "Size and position" });
    fireEvent.click(within(panel).getByRole("button", { name: "Apply position" }));
    expect(panel.textContent).toContain("Select one object.");
    pick("one");
    fireEvent.change(within(panel).getByLabelText("Object x"), { target: { value: "250" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Apply position" }));
    expect(editor.elements("a")[0].x).toBe(250);
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Size and position" })).toBeNull();
  });
});

describe("typing in a box", () => {
  it("writes the words, starts a list from a dash, and continues it on Enter", async () => {
    const editor = openSlides({ slides: { a: [words("t", "")] } });
    const area = box("t").querySelector("textarea")!;
    fireEvent.focus(area);
    fireEvent.change(area, { target: { value: "Plan", selectionStart: 4, selectionEnd: 4 } });
    expect(editor.elements("a")[0].content).toBe("Plan");
    fireEvent.change(area, { target: { value: "- ", selectionStart: 2, selectionEnd: 2 } });
    expect(editor.elements("a")[0]).toMatchObject({ bullet: true });
    fireEvent.change(area, { target: { value: "• one", selectionStart: 5, selectionEnd: 5 } });
    area.setSelectionRange(5, 5);
    fireEvent.keyDown(area, { key: "Enter" });
    expect(editor.elements("a")[0].content).toBe("• one\n• ");
    fireEvent.keyDown(area, { key: "Enter", shiftKey: true });
    fireEvent.select(area);
    fireEvent.blur(area);
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(editor.elements("a")[0].content).toBe("• one\n• ");
  });

  it("types the notes for the slide and folds them away", () => {
    const editor = openSlides();
    fireEvent.change(screen.getByPlaceholderText("Click to add speaker notes"), { target: { value: "Say hi" } });
    expect(editor.deck().slides.a.notes).toBe("Say hi");
    fireEvent.click(screen.getByTitle("Collapse speaker notes"));
    expect(screen.queryByPlaceholderText("Click to add speaker notes")).toBeNull();
    fireEvent.click(screen.getByTitle("Expand speaker notes"));
    expect(screen.getByPlaceholderText("Click to add speaker notes")).toBeTruthy();
  });

  it("drops the selection on a click on the empty slide", () => {
    openSlides();
    pick("a-words");
    expect(box("a-words").className).toContain("selected");
    fireEvent.click(document.querySelector(".slide-stage-viewport")!);
    expect(box("a-words").className).not.toContain("selected");
    press("Escape");
  });
});
