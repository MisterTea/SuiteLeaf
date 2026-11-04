/** @vitest-environment jsdom */
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { croppableImage } from "../apps/web/src/editors/doc-image-crop";
import { inlineImage } from "../apps/web/src/editors/doc-image-inline";
import { applyImageWrap, syncImageWrap } from "../apps/web/src/editors/doc-image-wrap";
import { liftInlineImage, placeImageInline } from "../apps/web/src/editors/doc-image-place";
import { insertDocDrawing, insertDocImage } from "../apps/web/src/editors/doc-image-insert";
import { applyImageAlt, imageAlt, selectedImage } from "../apps/web/src/editors/doc-image-alt";
import { click, frameQueue, key, layoutBoxes, mousedown } from "./doc-editor-harness";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let frames: ReturnType<typeof frameQueue>;
let restore: (() => void) | null = null;
const editors: Editor[] = [];

beforeEach(() => {
  frames = frameQueue();
  restore = layoutBoxes((el) => {
    if (el.tagName !== "IMG") return undefined;
    const style = (el as HTMLElement).style;
    return { top: 100, left: 100, width: parseFloat(style.width) || 200, height: parseFloat(style.height) || 100 };
  });
  document.elementFromPoint = () => null;
});

afterEach(() => {
  restore?.();
  while (editors.length) editors.pop()?.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function make(content: JSONContent | string, host?: HTMLElement) {
  const element = host ?? document.createElement("div");
  if (!element.isConnected) document.body.append(element);
  const editor = new Editor({ element, extensions: [StarterKit, croppableImage, inlineImage], content });
  editors.push(editor);
  return editor;
}

const p = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const image = (attrs: Record<string, unknown> = {}): JSONContent => ({ type: "image", attrs: { src: PNG, ...attrs } });

function pointer(type: string, init: { clientX?: number; clientY?: number; pointerId?: number; button?: number }) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX, clientY: init.clientY, button: init.button ?? 0 });
  Object.defineProperty(event, "pointerId", { value: init.pointerId ?? 1 });
  return event;
}

function loaded(editor: Editor) {
  for (const img of editor.view.dom.querySelectorAll("img")) img.onload?.(new Event("load"));
}

function attrsAt(editor: Editor, pos: number) {
  return editor.state.doc.nodeAt(pos)?.attrs ?? {};
}

describe("picture crop", () => {
  it("waits for the photo before showing it, then shows the crop tools", () => {
    const editor = make({ type: "doc", content: [p("a"), image()] });
    const host = editor.view.dom.querySelector<HTMLElement>(".doc-image-host")!;
    expect(host.style.visibility).toBe("hidden");
    loaded(editor);
    expect(host.style.visibility).toBe("");
    const control = (name: string) => host.querySelector<HTMLElement>(`[data-crop-control="${name}"]`)!;
    expect(control("crop").hidden).toBe(false);
    expect(control("done").hidden).toBe(true);
    expect(control("reset").hidden).toBe(true);
    expect(host.querySelectorAll<HTMLElement>("[data-crop-edge]")).toHaveLength(4);
    expect([...host.querySelectorAll<HTMLElement>("[data-crop-edge]")].every((edge) => edge.hidden)).toBe(true);
  });

  it("crops one edge from the keyboard and resets it", () => {
    const editor = make({ type: "doc", content: [p("a"), image()] });
    loaded(editor);
    const host = editor.view.dom.querySelector<HTMLElement>(".doc-image-host")!;
    const control = (name: string) => host.querySelector<HTMLElement>(`[data-crop-control="${name}"]`)!;
    click(control("crop"));
    expect(host.dataset.cropping).toBe("true");
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    const right = host.querySelector<HTMLElement>('[data-crop-edge="right"]')!;
    expect(document.activeElement).toBe(right);
    key(right, "ArrowLeft");
    key(right, "ArrowLeft");
    expect(attrsAt(editor, 3).cropRight).toBe(4);
    expect(right.getAttribute("aria-valuenow")).toBe("4");
    expect(control("reset").hidden).toBe(false);
    const frame = host.querySelector<HTMLElement>("[data-crop-frame]")!;
    expect(frame.dataset.cropped).toBe("true");
    expect(frame.style.width).toBe("192px");
    key(right, "ArrowUp");
    expect(attrsAt(editor, 3).cropRight).toBe(4);
    const bottom = host.querySelector<HTMLElement>('[data-crop-edge="bottom"]')!;
    key(bottom, "ArrowUp");
    expect(attrsAt(editor, 3).cropBottom).toBe(2);
    key(host.querySelector<HTMLElement>('[data-crop-edge="top"]')!, "ArrowDown");
    key(host.querySelector<HTMLElement>('[data-crop-edge="left"]')!, "ArrowRight");
    expect(attrsAt(editor, 3)).toMatchObject({ cropTop: 2, cropLeft: 2 });
    key(right, "Escape");
    expect(host.dataset.cropping).toBe("false");

    click(control("reset"));
    expect(attrsAt(editor, 3)).toMatchObject({ cropLeft: 0, cropTop: 0, cropRight: 0, cropBottom: 0 });
    expect(frame.dataset.cropped).toBe("false");
    expect(control("reset").hidden).toBe(true);
  });

  it("drags an edge, scaling for page zoom", () => {
    const editor = make({ type: "doc", content: [p("a"), image()] });
    loaded(editor);
    const host = editor.view.dom.querySelector<HTMLElement>(".doc-image-host")!;
    click(host.querySelector<HTMLElement>('[data-crop-control="crop"]')!);
    const left = host.querySelector<HTMLElement>('[data-crop-edge="left"]')!;
    left.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0, button: 2 }));
    left.dispatchEvent(pointer("pointerdown", { clientX: 0, clientY: 0 }));
    document.dispatchEvent(pointer("pointermove", { clientX: 30, pointerId: 9 }));
    document.dispatchEvent(pointer("pointermove", { clientX: 20, clientY: 0 }));
    // The picture is painted while dragging; the crop is written on release.
    expect(attrsAt(editor, 3).cropLeft).toBe(0);
    expect(host.querySelector<HTMLElement>("[data-crop-frame]")!.style.width).toBe("180px");
    document.dispatchEvent(pointer("pointerup", { pointerId: 9 }));
    document.dispatchEvent(pointer("pointerup", {}));
    expect(attrsAt(editor, 3).cropLeft).toBe(10);
    document.dispatchEvent(pointer("pointermove", { clientX: 90 }));
    expect(attrsAt(editor, 3).cropLeft).toBe(10);
  });

  it("leaves crop mode with Enter on the picture but keeps edge keys for the edges", () => {
    const editor = make({ type: "doc", content: [p("a"), image()] });
    loaded(editor);
    const host = editor.view.dom.querySelector<HTMLElement>(".doc-image-host")!;
    const crop = host.querySelector<HTMLElement>('[data-crop-control="crop"]')!;
    key(host, "Enter");
    expect(host.dataset.cropping).toBe("false");
    click(crop);
    key(document.body, "Enter");
    expect(host.dataset.cropping).toBe("true");
    key(host, "a");
    expect(host.dataset.cropping).toBe("true");
    const done = host.querySelector<HTMLElement>('[data-crop-control="done"]')!;
    key(done, "Enter");
    expect(host.dataset.cropping).toBe("false");
    click(crop);
    click(done);
    expect(host.dataset.cropping).toBe("false");
    mousedown(crop);
    expect(host.dataset.cropping).toBe("false");
  });

  it("selects the picture on a left click and paints a saved crop", () => {
    const editor = make({ type: "doc", content: [p("a"), image({ cropTop: 10, cropBottom: 10, width: 300, height: 150 })] });
    loaded(editor);
    const host = editor.view.dom.querySelector<HTMLElement>(".doc-image-host")!;
    const img = host.querySelector("img")!;
    expect(host.querySelector<HTMLElement>("[data-crop-frame]")!.style.height).toBe("120px");
    expect(img.style.marginTop).toBe("-15px");
    mousedown(img, { button: 2 });
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
    mousedown(img);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  });

  it("follows attribute changes and a corner resize", () => {
    const editor = make({ type: "doc", content: [p("a"), image({ alt: "Old", cropLeft: 5 })] });
    loaded(editor);
    const img = () => editor.view.dom.querySelector<HTMLImageElement>(".doc-image-host img")!;
    expect(img().getAttribute("alt")).toBe("Old");
    editor.chain().setNodeSelection(3).updateAttributes("image", { alt: null, title: "T", width: 120, height: 60 }).run();
    expect(img().hasAttribute("alt")).toBe(false);
    expect(img().getAttribute("title")).toBe("T");
    expect(img().style.width).toBe("120px");
    expect(img().style.height).toBe("60px");
    editor.chain().setNodeSelection(3).updateAttributes("image", { src: "" }).run();
    expect(img().hasAttribute("src")).toBe(false);
    editor.chain().setNodeSelection(3).updateAttributes("image", { src: PNG }).run();
    expect(img().getAttribute("src")).toBe(PNG);
  });

  it("writes the size from a corner resize", () => {
    const editor = make({ type: "doc", content: [p("a"), image({ cropLeft: 10 })] });
    loaded(editor);
    const handle = editor.view.dom.querySelector<HTMLElement>('[data-resize-handle="bottom-right"]')!;
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: -100, clientY: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: -100, clientY: 0 }));
    expect(attrsAt(editor, 3).width).toBe(100);
    expect(attrsAt(editor, 3).height).toBe(50);
  });

  it("sizes the wrapper during a resize of a picture in a sentence", () => {
    const editor = make({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "a" }, { type: "inlineImage", attrs: { src: PNG, width: 40, height: 20 } }] }],
    });
    loaded(editor);
    const host = editor.view.dom.querySelector<HTMLElement>(".doc-image-host")!;
    expect(host.dataset.inline).toBe("true");
    const handle = host.querySelector<HTMLElement>('[data-resize-handle="bottom-right"]')!;
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 10, clientY: 0 }));
    expect(host.style.width).toBe("50px");
    expect(host.querySelector<HTMLElement>("[data-resize-wrapper]")!.style.width).toBe("50px");
    document.dispatchEvent(new MouseEvent("mouseup", {}));
    expect(editor.getHTML()).toContain('data-inline="true"');
  });

  it("reads crop, wrap and drawing from HTML and writes only real crops", () => {
    const editor = make(`<p>a</p><img src="${PNG}" data-crop-left="12" data-crop-top="x" data-wrap="left" data-drawing="{}">`);
    expect(editor.getJSON().content?.[1].attrs).toMatchObject({ cropLeft: 12, cropTop: 0, wrap: "left", drawing: "{}" });
    const html = editor.getHTML();
    expect(html).toContain('data-crop-left="12"');
    expect(html).not.toContain("data-crop-top");
    expect(html).not.toContain("data-drawing");
  });
});

describe("wrap text menu", () => {
  function setup(content: JSONContent[]) {
    const page = document.createElement("div");
    page.className = "document-content";
    const editor = make({ type: "doc", content }, page);
    loaded(editor);
    return editor;
  }

  it("opens on the current choice and wraps the picture to the left", () => {
    const editor = setup([p("before"), image(), p("after")]);
    const host = editor.view.dom.querySelector<HTMLElement>(".doc-image-host")!;
    const open = host.querySelector<HTMLElement>('[data-wrap-control="open"]')!;
    const menu = host.querySelector<HTMLElement>(".doc-image-wrap-menu")!;
    click(open);
    expect(menu.hidden).toBe(false);
    expect(open.getAttribute("aria-expanded")).toBe("true");
    const item = (choice: string) => menu.querySelector<HTMLElement>(`[data-wrap-choice="${choice}"]`)!;
    expect(item("break").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(item("break"));
    click(item("left"));
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(open);
    expect(attrsAt(editor, 8).wrap).toBe("left");
    expect(host.dataset.wrap).toBe("left");
    expect(host.style.cssFloat).toBe("left");
    expect(host.style.width).toBe("200px");
    click(open);
    expect(item("left").getAttribute("aria-checked")).toBe("true");
    click(open);
    expect(menu.hidden).toBe(true);
  });

  it("moves through the choices from the keyboard", () => {
    const editor = setup([p("before"), image()]);
    const host = editor.view.dom.querySelector<HTMLElement>(".doc-image-host")!;
    const open = host.querySelector<HTMLElement>('[data-wrap-control="open"]')!;
    const menu = host.querySelector<HTMLElement>(".doc-image-wrap-menu")!;
    const item = (choice: string) => menu.querySelector<HTMLElement>(`[data-wrap-choice="${choice}"]`)!;
    key(open, "x");
    expect(menu.hidden).toBe(true);
    key(open, "ArrowUp");
    expect(document.activeElement).toBe(item("break"));
    key(menu, "ArrowDown");
    expect(document.activeElement).toBe(item("inline"));
    key(menu, "ArrowUp");
    expect(document.activeElement).toBe(item("break"));
    key(menu, "Home");
    expect(document.activeElement).toBe(item("inline"));
    key(menu, "End");
    expect(document.activeElement).toBe(item("break"));
    key(menu, "Escape");
    expect(menu.hidden).toBe(true);
    key(open, "ArrowDown");
    expect(document.activeElement).toBe(item("inline"));
    key(menu, "Tab");
    expect(menu.hidden).toBe(true);
    key(open, "ArrowDown");
    key(menu, "ArrowDown");
    key(menu, "ArrowDown");
    key(menu, "Enter");
    expect(attrsAt(editor, 8).wrap).toBe("right");
    key(open, "ArrowDown");
    key(menu, "q");
    expect(menu.hidden).toBe(false);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(menu.hidden).toBe(true);
  });

  it("flips the menu when there is no room below or to the right", () => {
    vi.stubGlobal("innerHeight", 300);
    vi.stubGlobal("innerWidth", 320);
    restore?.();
    restore = layoutBoxes((el) => {
      if ((el as HTMLElement).dataset?.wrapControl === "open") return { top: 250, left: 200, width: 80, height: 30 };
      if (el.classList.contains("doc-image-wrap-menu")) return { width: 168, height: 140 };
      return undefined;
    });
    const editor = setup([image()]);
    const host = editor.view.dom.querySelector<HTMLElement>(".doc-image-host")!;
    click(host.querySelector<HTMLElement>('[data-wrap-control="open"]')!);
    const menu = host.querySelector<HTMLElement>(".doc-image-wrap-menu")!;
    expect(menu.style.bottom).toBe("calc(100% + 4px)");
    expect(menu.style.right).toBe("0px");
    vi.unstubAllGlobals();
  });

  it("puts a picture in the sentence and takes it back out", () => {
    const editor = setup([p("before"), image({ width: 400, height: 200, wrap: "left" }), p("after")]);
    const host = editor.view.dom.querySelector<HTMLElement>(".doc-image-host")!;
    click(host.querySelector<HTMLElement>('[data-wrap-control="open"]')!);
    click(host.querySelector<HTMLElement>('[data-wrap-choice="inline"]')!);
    const json = editor.getJSON();
    expect(json.content).toHaveLength(1);
    expect(json.content?.[0].content?.map((node) => node.type)).toEqual(["text", "inlineImage", "text"]);
    expect(json.content?.[0].content?.[1].attrs).toMatchObject({ width: 40, height: 20 });
    expect(json.content?.[0].content?.[1].attrs?.wrap ?? null).toBeNull();

    const inlineHost = editor.view.dom.querySelector<HTMLElement>(".doc-image-host")!;
    loaded(editor);
    click(inlineHost.querySelector<HTMLElement>('[data-wrap-control="open"]')!);
    expect(inlineHost.querySelector('[data-wrap-choice="inline"]')!.getAttribute("aria-checked")).toBe("true");
    click(inlineHost.querySelector<HTMLElement>('[data-wrap-choice="inline"]')!);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    click(inlineHost.querySelector<HTMLElement>('[data-wrap-control="open"]')!);
    click(inlineHost.querySelector<HTMLElement>('[data-wrap-choice="right"]')!);
    expect(editor.getJSON().content?.map((node) => [node.type, node.attrs?.wrap ?? null])).toEqual([
      ["paragraph", null],
      ["image", "right"],
      ["paragraph", null],
    ]);
  });

  it("only places and lifts the right kind of node", () => {
    const editor = make({ type: "doc", content: [image(), p("x")] });
    expect(placeImageInline(editor, 1)).toBe(false);
    expect(liftInlineImage(editor, 0, "left")).toBe(false);
    expect(applyImageWrap(editor, 1, "left")).toBe(false);
    expect(placeImageInline(editor, 0)).toBe(true);
    expect(editor.getJSON().content?.[0].content?.map((node) => node.type)).toEqual(["inlineImage", "text"]);
    expect(liftInlineImage(editor, 1, "break")).toBe(true);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(["image", "paragraph"]);
  });

  it("pulls the next paragraph up beside a floated picture when the float is ignored", () => {
    restore?.();
    restore = layoutBoxes((el) => {
      if (el.tagName === "IMG") return { top: 0, left: 0, width: 200, height: 100 };
      if (el.tagName === "P") return { top: 120, left: 0, width: 500, height: 20 };
      if (el.classList.contains("doc-image-host")) return { height: 100 };
      if (el.classList.contains("document-content")) return { width: 800 };
      return undefined;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("document-content") ? 800 : 0;
    });
    document.createRange = () =>
      ({ setStart() {}, setEnd() {}, getBoundingClientRect: () => ({ top: 120, bottom: 140, left: 0, right: 500 }) }) as unknown as Range;
    const editor = setup([image({ wrap: "right" }), p("after")]);
    frames.flush();
    const host = editor.view.dom.querySelector<HTMLElement>(".doc-image-host")!;
    expect(host.style.cssFloat).toBe("none");
    expect(host.style.marginLeft).toBe("auto");
    expect(host.style.marginBottom).toBe("-100px");
    expect(editor.view.dom.closest<HTMLElement>(".document-content")!.style.getPropertyValue("--wrap-indent")).toBe("212px");
    applyImageWrap(editor, 0, "break");
    expect(host.dataset.wrap).toBe("break");
    expect(host.style.cssFloat).toBe("");
    expect(host.style.marginBottom).toBe("");
  });

  it("leaves a float alone when the text already runs beside it", () => {
    restore?.();
    restore = layoutBoxes((el) => {
      if (el.tagName === "IMG") return { top: 0, left: 0, width: 150, height: 100 };
      if (el.tagName === "P") return { top: 10, left: 160, width: 300, height: 20 };
      return undefined;
    });
    const editor = setup([image({ wrap: "left" }), { type: "paragraph" }]);
    frames.flush();
    const host = editor.view.dom.querySelector<HTMLElement>(".doc-image-host")!;
    expect(host.style.cssFloat).toBe("left");
    expect(host.style.width).toBe("150px");
  });

  it("paints a behind-text picture under the paragraph and clears it again", () => {
    const paragraph = document.createElement("p");
    const host = document.createElement("span");
    const wrapper = document.createElement("span");
    wrapper.dataset.resizeWrapper = "";
    const img = document.createElement("img");
    wrapper.append(img);
    host.append(wrapper);
    paragraph.append(host);
    document.body.append(paragraph);
    restore?.();
    restore = layoutBoxes((el) => {
      if (el === paragraph) return { top: 0, left: 0, width: 600, height: 40 };
      if (el === host) return { top: 10, left: 280, width: 40, height: 20 };
      return undefined;
    });
    syncImageWrap(host, { wrap: "behind" });
    expect(host.dataset.behindPaint).toBe("true");
    expect(wrapper.style.overflow).toBe("visible");
    expect(img.style.zIndex).toBe("-1");
    expect(img.style.transform).toBe("scale(15.6)");
    syncImageWrap(host, { wrap: null });
    expect(host.dataset.behindPaint).toBeUndefined();
    expect(img.style.transform).toBe("");
    expect(wrapper.style.overflow).toBe("");
    expect(host.dataset.wrap).toBeUndefined();
    // A picture too small to measure still covers the words.
    const bare = document.createElement("span");
    bare.append(document.createElement("img"));
    syncImageWrap(bare, { wrap: "behind" });
    expect(bare.querySelector("img")!.style.transform).toBe("scale(16)");
    const empty = document.createElement("span");
    syncImageWrap(empty, { wrap: "left" });
    expect(empty.style.cssFloat).toBe("");
  });
});

describe("inserting pictures", () => {
  function file(name: string, type: string, body = "x", size?: number) {
    const f = new File([body], name, { type });
    if (size != null) Object.defineProperty(f, "size", { value: size });
    return f;
  }

  it("refuses files that are not small pictures", async () => {
    const editor = make({ type: "doc", content: [p("a")] });
    const errors: string[] = [];
    await insertDocImage(editor as never, undefined, false, (s) => errors.push(s));
    await insertDocImage(editor as never, file("a.txt", "text/plain"), false, (s) => errors.push(s));
    await insertDocImage(editor as never, file("a.png", "image/png", "x", 6 * 1024 * 1024), false, (s) => errors.push(s));
    expect(errors).toEqual([
      "Choose a PNG, JPEG, GIF, WebP, or SVG image smaller than 5 MB.",
      "Choose a PNG, JPEG, GIF, WebP, or SVG image smaller than 5 MB.",
    ]);
  });

  it("puts a picture in with a paragraph after it for typing", async () => {
    const editor = make({ type: "doc", content: [p("a")] });
    editor.commands.setTextSelection(2);
    await insertDocImage(editor as never, file("cat.png", "image/png"), true, () => {});
    const json = editor.getJSON();
    const pic = json.content?.find((node) => node.type === "image");
    expect(pic?.attrs).toMatchObject({ alt: "", title: "cat.png" });
    expect(String(pic?.attrs?.src)).toMatch(/^data:image\/png;base64,/);
    expect(json.content?.[json.content.length - 1].type).toBe("paragraph");
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("reads an SVG by name and reports a file that cannot be read", async () => {
    const editor = make({ type: "doc", content: [p("a")] });
    await insertDocImage(editor as never, file("logo.svg", "", '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'), false, () => {});
    const pic = editor.getJSON().content?.find((node) => node.type === "image");
    expect(String(pic?.attrs?.src)).toMatch(/^data:image\/svg\+xml/);
    expect(pic?.attrs?.title ?? null).toBeNull();
    const broken = file("bad.png", "image/png");
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
      this.onerror?.(new ProgressEvent("error") as ProgressEvent<FileReader>);
    });
    const errors: string[] = [];
    await insertDocImage(editor as never, broken, false, (s) => errors.push(s));
    expect(errors).toEqual(["Could not read that image."]);
  });

  it("adds a drawing, then replaces it when it is selected", () => {
    const editor = make({ type: "doc", content: [p("a")] });
    editor.commands.setTextSelection(2);
    insertDocDrawing(editor as never, PNG, '{"scene":1}');
    const pos = editor.getJSON().content?.findIndex((node) => node.type === "image");
    expect(pos).toBeGreaterThan(-1);
    let found = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === "image") found = at;
    });
    expect(attrsAt(editor, found)).toMatchObject({ alt: "Drawing", drawing: '{"scene":1}' });
    editor.commands.setNodeSelection(found);
    insertDocDrawing(editor as never, `${PNG}#2`, null);
    expect(attrsAt(editor, found)).toMatchObject({ src: `${PNG}#2`, drawing: null });
    expect(editor.getJSON().content?.filter((node) => node.type === "image")).toHaveLength(1);
  });
});

describe("alt text on a picture", () => {
  it("reads and writes the description of the selected picture", () => {
    const editor = make({ type: "doc", content: [p("a"), image({ alt: "A cat", wrap: "left" })] });
    expect(selectedImage(editor.state)).toBeNull();
    editor.commands.setNodeSelection(3);
    expect(selectedImage(editor.state)).toEqual({ pos: 3, alt: "A cat", wrap: "left", inline: false });
    expect(applyImageAlt(editor, 3, "A dog")).toBe(true);
    expect(selectedImage(editor.state)?.alt).toBe("A dog");
    expect(applyImageAlt(editor, 0, "nope")).toBe(false);
    editor.commands.setNodeSelection(0);
    expect(selectedImage(editor.state)).toBeNull();
    expect(imageAlt(undefined)).toBe("");
  });
});
