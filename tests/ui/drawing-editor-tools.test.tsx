// @vitest-environment jsdom
import { sourceValue, selectSourceRange } from "../../apps/web/src/editors/slide-source-control";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DrawingFile } from "../../packages/core/src";
import Drawing from "../../apps/web/src/editors/Drawing";
import { createDrawingFile } from "../../apps/web/src/editors/drawing-format";
import type { EditorActions } from "../../apps/web/src/ui";
import { memoryStorage } from "./other-editors-env";

const io = vi.hoisted(() => ({
  exportText: vi.fn(async () => {}),
  exportBinary: vi.fn(async () => {}),
  printDocument: vi.fn(async () => {}),
}));
vi.mock("../../apps/web/src/storage", () => io);

/** Mermaid lays diagrams out with real text metrics, which jsdom does not have. */
const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, source: string) => {
    if (source.includes("broken")) throw new Error("Parse error on line 2");
    const { mermaidNodes } = await import("../../apps/web/src/editors/drawing-mermaid");
    const nodes = [...new Set(mermaidNodes(source).map((node) => node.id))];
    const texts = [...source.matchAll(/:\s*(.+)$/gm)].map((match) => match[1]);
    return {
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">${nodes
        .map((id, index) => `<g class="node" id="flowchart-${id}-${index}"><rect width="20" height="20"/><text>${id}</text></g>`)
        .join("")}${texts.map((text) => `<text>${text}</text>`).join("")}</svg>`,
    };
  }),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="10" y="10" width="20" height="20" fill="#abc"/>
  <g>
    <circle cx="50" cy="50" r="5"/>
  </g>
  <text x="50" y="80">Hello</text>
</svg>
`;

beforeEach(() => {
  memoryStorage();
  HTMLElement.prototype.setPointerCapture = () => {};
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function open(file: DrawingFile, props: { readOnly?: boolean } = {}) {
  const onChange = vi.fn();
  const onError = vi.fn();
  let actions: EditorActions | null = null;
  const view = render(
    <Drawing
      file={file}
      onChange={onChange}
      onActions={(next) => {
        actions = next;
      }}
      onError={onError}
      {...props}
    />,
  );
  const host = view.container.querySelector(".drawing-host")!;
  const canvas = screen.getByRole("application", { name: "Drawing canvas" });
  const drawn = (selector: string) => host.shadowRoot?.querySelector(selector) ?? null;
  const latest = () => onChange.mock.lastCall?.[0]?.source as string;
  return { ...view, onChange, onError, canvas, drawn, latest, actions: () => actions! };
}

const press = (element: Element, extra: Record<string, unknown> = {}) => {
  fireEvent.pointerDown(element, { button: 0, bubbles: true, composed: true, ...extra });
  fireEvent.pointerUp(element, { bubbles: true, composed: true });
};
const tool = (name: string) => screen.getByRole("button", { name });

describe("drawing SVG shapes", () => {
  it("adds each kind of shape and types the new text straight away", async () => {
    const { latest } = open(createDrawingFile("svg", "Boxes", PICTURE));
    await waitFor(() => expect(tool("Add rectangle")).toHaveProperty("disabled", false));
    fireEvent.click(tool("Add rectangle"));
    expect(latest().match(/<rect/g)).toHaveLength(2);
    fireEvent.click(tool("Add ellipse"));
    expect(latest()).toContain("<ellipse");
    fireEvent.click(tool("Add line"));
    expect(latest()).toContain("<line");
    fireEvent.click(tool("Add text"));
    const label = await screen.findByLabelText("Label");
    fireEvent.change(label, { target: { value: "Shed" } });
    fireEvent.keyDown(label, { key: "Enter" });
    expect(latest()).toContain(">Shed</text>");
  });

  it("explains that shapes go inside the svg element", async () => {
    const { onError } = open(createDrawingFile("svg", "Empty", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>'));
    await waitFor(() => expect(tool("Add rectangle")).toHaveProperty("disabled", false));
    fireEvent.click(tool("Add rectangle"));
    expect(onError).toHaveBeenCalledWith("Add shapes inside the <svg> element.");
  });

  it("paints the selected shape, and quick colour changes undo as one step", async () => {
    const { drawn, latest, canvas } = open(createDrawingFile("svg", "Boxes", PICTURE));
    await waitFor(() => expect(drawn("rect")).not.toBeNull());
    expect(screen.getByLabelText("Fill colour")).toHaveProperty("disabled", true);
    press(drawn("rect")!);
    const fill = screen.getByLabelText("Fill colour") as HTMLInputElement;
    expect(fill.value).toBe("#aabbcc");
    expect((screen.getByLabelText("Line colour") as HTMLInputElement).value).toBe("#000000");
    fireEvent.input(fill, { target: { value: "#ff0000" } });
    fireEvent.input(fill, { target: { value: "#00ff00" } });
    fireEvent.input(screen.getByLabelText("Line colour"), { target: { value: "#0000ff" } });
    expect(latest()).toContain('fill="#00ff00"');
    expect(latest()).toContain('stroke="#0000ff"');
    fireEvent.keyDown(canvas, { key: "z", metaKey: true });
    expect(latest()).toContain('fill="#00ff00"');
    expect(latest()).not.toContain("stroke=");
    fireEvent.keyDown(canvas, { key: "z", metaKey: true });
    expect(latest()).toBe(PICTURE);
    fireEvent.keyDown(canvas, { key: "y", ctrlKey: true });
    expect(latest()).toContain('fill="#00ff00"');
  });

  it("edits a text label from the toolbar, with Enter, F2, and a double-click, and Escape cancels", async () => {
    const { drawn, latest, canvas } = open(createDrawingFile("svg", "Boxes", PICTURE));
    await waitFor(() => expect(drawn("text")).not.toBeNull());
    press(drawn("text")!);
    fireEvent.click(tool("Edit label (Enter)"));
    let label = await screen.findByLabelText("Label");
    expect(label).toHaveProperty("value", "Hello");
    fireEvent.keyDown(label, { key: "Escape" });
    expect(screen.queryByLabelText("Label")).toBeNull();
    fireEvent.keyDown(canvas, { key: "F2" });
    label = await screen.findByLabelText("Label");
    fireEvent.change(label, { target: { value: "Hi" } });
    fireEvent.blur(label);
    expect(latest()).toContain(">Hi</text>");
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(await screen.findByLabelText("Label")).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText("Label"), { key: "Escape" });
    await waitFor(() => expect(drawn("text")?.textContent).toBe("Hi"));
    fireEvent.doubleClick(drawn("text")!, { bubbles: true, composed: true });
    expect(await screen.findByLabelText("Label")).toHaveProperty("value", "Hi");
  });

  it("does not offer a label for a group of shapes", async () => {
    const { drawn, canvas } = open(createDrawingFile("svg", "Boxes", PICTURE));
    await waitFor(() => expect(drawn("circle")).not.toBeNull());
    press(drawn("circle")!);
    expect(tool("Edit label (Enter)")).toHaveProperty("disabled", true);
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(screen.queryByLabelText("Label")).toBeNull();
  });

  it("deletes from the toolbar, picks a whole group or Alt-picks inside it, and Escape clears", async () => {
    const { drawn, latest, canvas, container } = open(createDrawingFile("svg", "Boxes", PICTURE));
    await waitFor(() => expect(drawn("circle")).not.toBeNull());
    press(drawn("circle")!);
    fireEvent.click(tool("Delete (Delete)"));
    expect(latest()).not.toContain("<g>");
    fireEvent.click(tool("Undo (Cmd+Z)"));
    await waitFor(() => expect(drawn("circle")).not.toBeNull());
    press(drawn("circle")!, { altKey: true });
    fireEvent.keyDown(canvas, { key: "Backspace" });
    expect(latest()).toContain("<g>");
    expect(latest()).not.toContain("<circle");
    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(container.querySelector(".drawing-selection")).toBeNull();
    press(drawn("svg")!);
    expect(container.querySelector(".drawing-selection")).toBeNull();
  });

  it("moves a shape by dragging it and resizes it by its handle", async () => {
    const { drawn, latest, container } = open(createDrawingFile("svg", "Boxes", PICTURE));
    await waitFor(() => expect(drawn("rect")).not.toBeNull());
    const rect = drawn("rect")!;
    const paper = container.querySelector(".drawing-paper")!;
    fireEvent.pointerDown(rect, { button: 0, clientX: 100, clientY: 100, bubbles: true, composed: true });
    fireEvent.pointerMove(paper, { clientX: 101, clientY: 100 });
    fireEvent.pointerMove(paper, { clientX: 110, clientY: 105 });
    expect(drawn("rect")!.getAttribute("x")).toBe("20");
    fireEvent.pointerUp(paper);
    expect(latest()).toContain('<rect x="20" y="15"');

    const handle = container.querySelector(".drawing-resize-handle")!;
    expect(handle).not.toBeNull();
    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(paper, { clientX: 10, clientY: 4 });
    fireEvent.pointerUp(paper);
    expect(latest()).toContain('width="30" height="24"');
    await waitFor(() => expect(drawn("rect")!.getAttribute("width")).toBe("30"));

    fireEvent.pointerDown(drawn("rect")!, { button: 0, clientX: 0, clientY: 0, bubbles: true, composed: true });
    fireEvent.pointerMove(paper, { clientX: 50, clientY: 0 });
    fireEvent.pointerCancel(paper);
    expect(drawn("rect")!.getAttribute("x")).toBe("20");
    fireEvent.pointerUp(paper);
    expect(latest()).toContain('<rect x="20" y="15"');
  });

  it("follows the source caret to the shape on that line", async () => {
    const { container } = open(createDrawingFile("svg", "Boxes", PICTURE));
    const source = screen.getByLabelText("SVG source") as HTMLTextAreaElement;
    await waitFor(() => expect(container.querySelector(".drawing-host")!.shadowRoot?.querySelector("rect")).not.toBeNull());
    const at = PICTURE.indexOf("<text");
    selectSourceRange(source, at, at);
    fireEvent.select(source);
    await waitFor(() => expect(container.querySelector(".drawing-selection")).not.toBeNull());
    expect(tool("Edit label (Enter)")).toHaveProperty("disabled", false);
  });

  it("zooms in steps, back to fit, and hides the source pane", async () => {
    open(createDrawingFile("svg", "Boxes", PICTURE));
    const fit = screen.getByRole("button", { name: /%$/ });
    expect(fit.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(tool("Zoom in"));
    expect(screen.getByRole("button", { name: "150%" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(tool("Zoom out"));
    fireEvent.click(tool("Zoom out"));
    expect(screen.getByRole("button", { name: "75%" })).toBeTruthy();
    for (let i = 0; i < 6; i++) fireEvent.click(tool("Zoom out"));
    expect(screen.getByRole("button", { name: "25%" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "25%" }));
    expect(screen.getByRole("button", { name: "100%" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(tool("Hide the source"));
    expect(screen.queryByLabelText("SVG source")).toBeNull();
    fireEvent.click(tool("Show the source beside the drawing"));
    expect(screen.getByLabelText("SVG source")).toBeTruthy();
  });

  it("takes in a newer source saved elsewhere", async () => {
    const file = createDrawingFile("svg", "Boxes", PICTURE);
    const { rerender, drawn } = open(file);
    const next = PICTURE.replace("Hello", "Bye");
    rerender(<Drawing file={{ ...file, content: { format: "svg", source: next } }} onChange={() => {}} onActions={() => {}} onError={() => {}} />);
    expect(sourceValue(screen.getByLabelText<HTMLTextAreaElement>("SVG source"))).toBe(next);
    await waitFor(() => expect(drawn("text")?.textContent).toBe("Bye"));
  });

  it("only lets a viewer look and zoom", async () => {
    const { drawn, canvas, onChange } = open(createDrawingFile("svg", "Boxes", PICTURE), { readOnly: true });
    await waitFor(() => expect(drawn("rect")).not.toBeNull());
    press(drawn("rect")!);
    fireEvent.keyDown(canvas, { key: "Delete" });
    fireEvent.keyDown(canvas, { key: "ArrowLeft" });
    fireEvent.keyDown(canvas, { key: "z", metaKey: true });
    fireEvent.doubleClick(drawn("text")!, { bubbles: true, composed: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Label")).toBeNull();
    expect(tool("Zoom in")).toHaveProperty("disabled", false);
  });
});

describe("exporting and printing a drawing", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
    Object.defineProperty(HTMLImageElement.prototype, "decode", { value: async () => {}, configurable: true });
    HTMLCanvasElement.prototype.getContext = (() => ({ fillRect: () => {}, drawImage: () => {}, fillStyle: "" })) as never;
    HTMLCanvasElement.prototype.toBlob = function (done: BlobCallback) {
      done(new Blob([`${this.width}x${this.height}`]));
    };
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saves the source, the drawn SVG, and a PNG at twice the size", async () => {
    const { actions, drawn } = open(createDrawingFile("svg", "Boxes", PICTURE));
    await waitFor(() => expect(drawn("rect")).not.toBeNull());
    await actions().export("svg");
    expect(io.exportText).toHaveBeenCalledWith("Boxes.svg", PICTURE, "image/svg+xml");
    await actions().export("png");
    const [name, bytes, type] = io.exportBinary.mock.calls[0] as unknown as [string, Uint8Array, string];
    expect([name, type]).toEqual(["Boxes.png", "image/png"]);
    expect(new TextDecoder().decode(bytes)).toBe("200x200");
    await expect(actions().export("docx")).rejects.toThrow("Drawings cannot be exported as .docx.");
    await actions().print();
    expect(io.printDocument).toHaveBeenCalledWith("Boxes");
  });

  it("refuses a picture export while the source is broken", async () => {
    const { actions } = open(createDrawingFile("mermaid", "Flow", "flowchart LR\n  broken"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Parse error on line 2"));
    await expect(actions().export("png")).rejects.toThrow("Fix the drawing's source before exporting a picture of it.");
    await actions().export("mmd");
    expect(io.exportText).toHaveBeenCalledWith("Flow.mmd", "flowchart LR\n  broken", "text/plain");
  });
});

describe("drawing a Mermaid flowchart", () => {
  const FLOW = "flowchart LR\n  A[Seed] --> B[Sprout]\n  C[Bloom]\n";

  it("adds a node and names it", async () => {
    const { latest } = open(createDrawingFile("mermaid", "Flow", FLOW));
    await waitFor(() => expect(tool("Add node")).toHaveProperty("disabled", false));
    fireEvent.click(tool("Add node"));
    const label = await screen.findByLabelText("Label", {}, { timeout: 3000 });
    fireEvent.change(label, { target: { value: "Fruit" } });
    fireEvent.keyDown(label, { key: "Enter" });
    expect(latest()).toContain("Fruit");
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: "strict" }));
  });

  it("connects two nodes picked on the canvas", async () => {
    const { latest, drawn } = open(createDrawingFile("mermaid", "Flow", FLOW));
    await waitFor(() => expect(drawn("#flowchart-C-2")).not.toBeNull());
    fireEvent.click(tool("Connect two nodes"));
    expect(screen.getByRole("status").textContent).toBe("Click the node to connect from.");
    press(drawn("svg")!);
    press(drawn("#flowchart-B-1 rect")!);
    expect(screen.getByRole("status").textContent).toBe("Now click the node to connect “B” to.");
    press(drawn("#flowchart-C-2 rect")!);
    expect(latest()).toMatch(/B\s*-->\s*C/);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(tool("Connect two nodes"));
    fireEvent.click(tool("Stop connecting"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("deletes a node with the Delete key", async () => {
    const { latest, drawn, canvas } = open(createDrawingFile("mermaid", "Flow", FLOW));
    await waitFor(() => expect(drawn("#flowchart-C-2")).not.toBeNull());
    press(drawn("#flowchart-C-2 rect")!);
    fireEvent.keyDown(canvas, { key: "Delete" });
    expect(latest()).not.toContain("Bloom");
  });

  it("relabels text in a diagram that is not a flowchart, and says when it cannot", async () => {
    const SEQUENCE = "sequenceDiagram\n  Alice->>Bob: hi there\n";
    const { latest, drawn, onError, canvas } = open(createDrawingFile("mermaid", "Talk", SEQUENCE));
    await waitFor(() => expect(drawn("svg > text")).not.toBeNull());
    expect(tool("Add node")).toHaveProperty("disabled", true);
    press(drawn("svg > text")!);
    expect(tool("Delete (Delete)")).toHaveProperty("disabled", true);
    fireEvent.keyDown(canvas, { key: "Enter" });
    const label = await screen.findByLabelText("Label");
    fireEvent.change(label, { target: { value: "bye" } });
    fireEvent.keyDown(label, { key: "Enter" });
    expect(latest()).toBe("sequenceDiagram\n  Alice->>Bob: bye\n");
    await waitFor(() => expect(drawn("svg > text")?.textContent).toBe("bye"));
    expect(onError).not.toHaveBeenCalled();
  });

  it("says when the text is written differently in the source", async () => {
    const { drawn, onError, canvas, onChange } = open(createDrawingFile("mermaid", "Talk", "sequenceDiagram\n  Alice->>Bob: hi  there\n"));
    await waitFor(() => expect(drawn("svg > text")).not.toBeNull());
    press(drawn("svg > text")!);
    fireEvent.keyDown(canvas, { key: "Enter" });
    const label = await screen.findByLabelText("Label");
    expect(label).toHaveProperty("value", "hi there");
    fireEvent.change(label, { target: { value: "later" } });
    fireEvent.keyDown(label, { key: "Enter" });
    expect(onError).toHaveBeenCalledWith("That text is written differently in the source. Change it there instead.");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("drawing a Graphviz graph", () => {
  it("draws the graph and adds a node to it", async () => {
    const { latest, drawn, canvas } = open(createDrawingFile("graphviz", "Graph", "digraph {\n  a -> b;\n}\n"));
    await waitFor(() => expect(drawn("g.node")).not.toBeNull(), { timeout: 5000 });
    fireEvent.click(tool("Add node"));
    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(latest()).toMatch(/digraph \{\n  a -> b;\n  \w+/);
    await waitFor(() => expect(drawn("svg")?.querySelectorAll("g.node")).toHaveLength(3));
    press(drawn("g.node")!);
    expect(tool("Edit label (Enter)")).toHaveProperty("disabled", false);
  });

  it("explains a graph that cannot be drawn", async () => {
    open(createDrawingFile("graphviz", "Graph", "digraph { a -> }"));
    expect((await screen.findByRole("alert", {}, { timeout: 5000 })).textContent).toContain("The source has a problem.");
  });

  it("says when the drawing is empty", async () => {
    open(createDrawingFile("graphviz", "Graph", "  "));
    expect((await screen.findByRole("alert")).textContent).toContain("The drawing is empty.");
  });
});

describe("a shape moved with the keyboard", () => {
  it("moves ten at a time with Shift and merges into one step", async () => {
    const { drawn, canvas, latest } = open(createDrawingFile("svg", "Boxes", PICTURE));
    await waitFor(() => expect(drawn("rect")).not.toBeNull());
    press(drawn("rect")!);
    act(() => {
      fireEvent.keyDown(canvas, { key: "ArrowUp", shiftKey: true });
      fireEvent.keyDown(canvas, { key: "ArrowLeft" });
    });
    expect(latest()).toContain('<rect x="9" y="0"');
    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    expect(latest()).toBe(PICTURE);
  });
});
