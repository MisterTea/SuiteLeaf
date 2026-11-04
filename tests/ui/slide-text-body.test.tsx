// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boxFont,
  restoreSelection,
  RunSpans,
  runsFromDom,
  runStyle,
  selectionOffsets,
  SlideTextBody,
} from "../../apps/web/src/editors/slide-text";

afterEach(cleanup);

function dom(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("how a run is painted", () => {
  it("turns each run mark into CSS", () => {
    expect(runStyle({ text: "a" })).toEqual({ fontWeight: 400, fontStyle: "normal", textDecoration: "none" });
    expect(
      runStyle(
        {
          text: "a",
          bold: true,
          italic: true,
          underline: true,
          strike: true,
          color: "#ff0000",
          highlight: "#ffff00",
          fontSize: 30,
          caps: "all",
          baseline: 30,
          font: "Arial",
        },
        20,
      ),
    ).toMatchObject({
      fontWeight: 700,
      fontStyle: "italic",
      textDecoration: "underline line-through",
      color: "#ff0000",
      backgroundColor: "#ffff00",
      fontSize: "1.5em",
      textTransform: "uppercase",
      position: "relative",
      top: "-0.3em",
      lineHeight: 0,
      fontFamily: "'SuiteLeaf Aspen'",
    });
    expect(runStyle({ text: "a", fontSize: 12, caps: "small" })).toMatchObject({
      fontSize: "12px",
      fontVariantCaps: "small-caps",
      fontSynthesis: "small-caps",
    });
  });

  it("uses the box's emphasis only when its words carry no marks of their own", () => {
    expect(boxFont({ bold: true, italic: true, underline: true })).toEqual({
      fontWeight: 700,
      fontStyle: "italic",
      textDecoration: "underline",
    });
    expect(boxFont({ bold: true, runs: [{ text: "a", bold: true }, { text: "b" }] })).toEqual({
      fontWeight: 400,
      fontStyle: "normal",
      textDecoration: "none",
    });
    expect(boxFont({})).toEqual({ fontWeight: 400, fontStyle: "normal", textDecoration: "none" });
  });

  it("writes plain words as they are and marked words as spans", () => {
    const plain = render(<RunSpans content="Just words" />);
    expect(plain.container.innerHTML).toBe("Just words");
    const marked = render(
      <RunSpans
        content="H2O"
        fontSize={20}
        runs={[{ text: "H", bold: true }, { text: "2", scriptScale: true, baseline: -25 }, { text: "O" }]}
      />,
    );
    const spans = marked.container.querySelectorAll(":scope > span");
    expect([...spans].map((span) => span.textContent)).toEqual(["H", "2", "O"]);
    expect((spans[0] as HTMLElement).style.fontWeight).toBe("700");
    expect((spans[1].firstElementChild as HTMLElement).style.fontSize).toBe("0.65em");
  });
});

describe("reading the editor back into runs", () => {
  it("reads tags, data marks, breaks, and paragraphs", () => {
    const root = dom(
      [
        "<b>bold</b><i>it</i><u>un</u><s>gone</s>",
        '<span data-color="#ff0000" data-highlight="#00ff00" data-font-size="30" data-font="Arial">x</span>',
        '<span data-baseline="30" data-script-scale="1">2</span>',
        '<span data-href="https://example.com">link</span><span data-href="javascript:bad()">bad</span>',
        "<br>",
        "a&nbsp;b",
        "<div>block</div>",
        '<span data-slide-line="1" data-font-size="40">big</span>',
        '<span data-slide-para="1" data-para-margin="10" data-para-hang="5" data-para-first="3" data-space-before="6" data-para-align="center" data-para-line="1.5">para</span>',
        '<span data-bullet-src="data:image/png;base64,AA=="><span>dot</span></span>',
      ].join(""),
    );
    const runs = runsFromDom(root);
    const find = (text: string) => runs.find((run) => run.text.includes(text));
    expect(find("bold")).toMatchObject({ bold: true });
    expect(find("it")).toMatchObject({ italic: true });
    expect(find("un")).toMatchObject({ underline: true });
    expect(find("gone")).toMatchObject({ strike: true });
    expect(find("x")).toMatchObject({ color: "#ff0000", highlight: "#00ff00", fontSize: 30, font: "Arial" });
    expect(find("2")).toMatchObject({ baseline: 30, scriptScale: true });
    expect(find("link")).toMatchObject({ href: "https://example.com" });
    expect(find("bad")?.href).toBeUndefined();
    expect(runs.map((run) => run.text).join("")).toBe("bolditungonex2linkbad\na b\nblock\nbig\nparadot");
    expect(runs.find((run) => run.text === "\n" && run.paragraphBreak)).toMatchObject({
      paraMargin: 10,
      paraHang: 5,
      paraFirst: 3,
      spaceBefore: 6,
      paraAlign: "center",
      paraLine: 1.5,
    });
    expect(runs.find((run) => run.fontSize === 40 && run.text === "\n")).toBeDefined();
    expect(find("dot")).toMatchObject({ bulletSrc: "data:image/png;base64,AA==" });
  });

  it("keeps the first paragraph's spacing on its first words", () => {
    const runs = runsFromDom(dom('<span data-slide-para="1" data-para-align="right" data-para-margin="12">first</span>'));
    expect(runs).toEqual([expect.objectContaining({ text: "first", paraAlign: "right", paraMargin: 12 })]);
    expect(runsFromDom(dom('<span data-slide-para="1" data-para-align="sideways">x</span>'))[0].paraAlign).toBeUndefined();
    expect(runsFromDom(dom("<!-- note -->"))).toEqual([]);
  });
});

describe("the caret in the editor", () => {
  it("measures a selection in characters and puts it back", () => {
    const root = dom("<b>Hello</b> <i>world</i>");
    restoreSelection(root, 2, 8);
    expect(selectionOffsets(root)).toEqual({ start: 2, end: 8 });
    expect(window.getSelection()!.toString()).toBe("llo wo");
    restoreSelection(root, 99, 120);
    expect(selectionOffsets(root)).toEqual({ start: 2, end: 8 });

    const selection = window.getSelection()!;
    selection.setBaseAndExtent(root.lastChild!.firstChild!, 3, root.firstChild!.firstChild!, 1);
    expect(selectionOffsets(root)).toEqual({ start: 1, end: 9 });

    const outside = dom("elsewhere");
    restoreSelection(outside, 0, 4);
    expect(selectionOffsets(root)).toBeNull();
    selection.removeAllRanges();
    expect(selectionOffsets(root)).toBeNull();
  });
});

describe("the box being typed in", () => {
  function editor(props: Partial<Parameters<typeof SlideTextBody>[0]> = {}) {
    const onText = vi.fn();
    const onCaret = vi.fn();
    const view = render(
      <SlideTextBody content="Hello world" editing onText={onText} onCaret={onCaret} placeholder="Body" {...props} />,
    );
    const node = view.container.querySelector<HTMLElement>(".element-editor")!;
    return { ...view, node, onText, onCaret };
  }

  it("shows the words without editing until it is being typed in", () => {
    const { node, rerender } = editor({ editing: false, content: "" });
    expect(node.getAttribute("contenteditable")).toBe("false");
    expect(node.getAttribute("role")).toBeNull();
    expect(node.dataset.empty).toBe("true");
    rerender(<SlideTextBody content="Now" editing onText={() => {}} onCaret={() => {}} />);
    expect(node.getAttribute("role")).toBe("textbox");
    expect(document.activeElement).toBe(node);
    expect(node.textContent).toBe("Now");
    expect(node.dataset.empty).toBe("false");
    expect(node.getAttribute("aria-label")).toBe("Slide text");
  });

  it("reports the caret and the typed words", () => {
    const { node, onText, onCaret } = editor();
    restoreSelection(node, 0, 5);
    document.dispatchEvent(new Event("selectionchange"));
    expect(onCaret).toHaveBeenLastCalledWith({ start: 0, end: 5 });
    node.firstChild!.textContent = "Hello there";
    fireEvent.input(node);
    expect(onText).toHaveBeenLastCalledWith([{ text: "Hello there" }]);
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    const stop = vi.spyOn(press, "stopPropagation");
    node.dispatchEvent(press);
    expect(stop).toHaveBeenCalled();
  });

  it("turns a typed dash into a bullet and continues the list on Enter", () => {
    const { node, onText } = editor({ content: "" });
    node.textContent = "- ";
    restoreSelection(node, 2, 2);
    fireEvent.input(node);
    expect(onText).toHaveBeenLastCalledWith([{ text: "• " }], { bullet: true });
    expect(node.textContent).toBe("• ");
    expect(selectionOffsets(node)).toEqual({ start: 2, end: 2 });

    node.textContent = "• one";
    restoreSelection(node, 5, 5);
    fireEvent.keyDown(node, { key: "Enter" });
    expect(onText).toHaveBeenLastCalledWith([{ text: "• one" }, { text: "\n• " }]);
    expect(selectionOffsets(node)).toEqual({ start: 8, end: 8 });
    const calls = onText.mock.calls.length;
    fireEvent.keyDown(node, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(node, { key: "a" });
    node.textContent = "plain";
    restoreSelection(node, 5, 5);
    fireEvent.keyDown(node, { key: "Enter" });
    restoreSelection(node, 0, 2);
    fireEvent.keyDown(node, { key: "Enter" });
    expect(onText).toHaveBeenCalledTimes(calls);
  });

  it("keeps the caret where it was when the words change underneath it", () => {
    const { node, rerender } = editor({ content: "Hello world" });
    restoreSelection(node, 3, 3);
    rerender(
      <SlideTextBody runs={[{ text: "Hello", bold: true }, { text: " world" }]} content="Hello world" editing onText={() => {}} onCaret={() => {}} />,
    );
    expect(node.querySelector("[data-bold='1'], b, strong, span")).not.toBeNull();
    expect(selectionOffsets(node)).toEqual({ start: 3, end: 3 });
  });

  it("selects the double-clicked word", () => {
    const { node } = editor({ content: "Hello brave world" });
    const text = () => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      return walker.nextNode()!;
    };
    const fromPoint = vi.fn(() => {
      const range = document.createRange();
      range.setStart(text(), 8);
      return range;
    });
    Object.assign(document, { caretRangeFromPoint: fromPoint });
    window.getSelection()!.removeAllRanges();
    fireEvent.doubleClick(node, { clientX: 5, clientY: 5 });
    expect(window.getSelection()!.toString()).toBe("brave");
    delete (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint;

    Object.assign(document, { caretPositionFromPoint: () => ({ offsetNode: text(), offset: 1 }) });
    window.getSelection()!.removeAllRanges();
    fireEvent.doubleClick(node);
    expect(window.getSelection()!.toString()).toBe("Hello");
    fireEvent.doubleClick(node);
    expect(window.getSelection()!.toString()).toBe("Hello");

    Object.assign(document, { caretPositionFromPoint: () => null });
    window.getSelection()!.removeAllRanges();
    fireEvent.doubleClick(node);
    Object.assign(document, { caretPositionFromPoint: () => ({ offsetNode: text(), offset: 6 }) });
    node.firstChild!.textContent = "Hello  world";
    fireEvent.doubleClick(node);
    expect(window.getSelection()!.toString()).toBe("");
    delete (document as { caretPositionFromPoint?: unknown }).caretPositionFromPoint;
  });

  it("ignores a double-click while it is not being typed in", () => {
    const { node } = editor({ editing: false });
    window.getSelection()!.removeAllRanges();
    fireEvent.doubleClick(node);
    expect(window.getSelection()!.toString()).toBe("");
  });
});
