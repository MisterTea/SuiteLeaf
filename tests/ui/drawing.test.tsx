// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingFile } from "../../packages/core/src";
import Drawing, { labelOf, relabel, selectionOnLine, sourceOffsetFor } from "../../apps/web/src/editors/Drawing";
import { createDrawingFile } from "../../apps/web/src/editors/drawing-format";
import { MARP_TYPING_PAUSE_MS } from "../../apps/web/src/editors/slide-marp-textarea";

const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="10" y="10" width="20" height="20"/>
  <text x="50" y="50">Hello</text>
</svg>
`;

afterEach(cleanup);

function open(file: DrawingFile) {
  const onChange = vi.fn();
  const view = render(
    <Drawing file={file} onChange={onChange} onActions={() => {}} onError={() => {}} />,
  );
  const host = view.container.querySelector(".drawing-host")!;
  const canvas = screen.getByRole("application", { name: "Drawing canvas" });
  const drawn = (selector: string) => host.shadowRoot?.querySelector(selector) ?? null;
  return { ...view, onChange, canvas, drawn, latest: () => onChange.mock.lastCall?.[0]?.source as string };
}

/** Press on something drawn inside the canvas's shadow root. */
function press(element: Element) {
  fireEvent.pointerDown(element, { button: 0, bubbles: true, composed: true });
  fireEvent.pointerUp(element, { bubbles: true, composed: true });
}

describe("the drawing editor", () => {
  it("draws an SVG file beside its source", async () => {
    const { drawn } = open(createDrawingFile("svg", "Boxes", PICTURE));
    expect(screen.getByLabelText("SVG source")).toHaveProperty("value", PICTURE);
    await waitFor(() => expect(drawn("rect")).not.toBeNull());
    expect(screen.getByRole("separator", { name: "Resize the drawing and source panes" })).toBeTruthy();
  });

  it("deletes the selected shape from the source, and Undo brings it back", async () => {
    const { drawn, canvas, latest } = open(createDrawingFile("svg", "Boxes", PICTURE));
    await waitFor(() => expect(drawn("rect")).not.toBeNull());
    press(drawn("rect")!);
    fireEvent.keyDown(canvas, { key: "Delete" });
    expect(latest()).not.toContain("<rect");
    expect(latest()).toContain("  <text");
    await waitFor(() => expect(drawn("rect")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Undo (Cmd+Z)" }));
    expect(latest()).toBe(PICTURE);
    fireEvent.keyDown(canvas, { key: "z", metaKey: true, shiftKey: true });
    expect(latest()).not.toContain("<rect");
  });

  it("nudges the selected shape with the arrow keys, as one step to undo", async () => {
    const { drawn, canvas, latest } = open(createDrawingFile("svg", "Boxes", PICTURE));
    await waitFor(() => expect(drawn("rect")).not.toBeNull());
    press(drawn("rect")!);
    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    fireEvent.keyDown(canvas, { key: "ArrowDown", shiftKey: true });
    expect(latest()).toContain('<rect x="11" y="20"');
    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });
    expect(latest()).toBe(PICTURE);
  });

  it("follows typing in the source once typing pauses", async () => {
    vi.useFakeTimers();
    try {
      const { drawn, latest } = open(createDrawingFile("svg", "Boxes", PICTURE));
      const source = screen.getByLabelText("SVG source");
      fireEvent.change(source, { target: { value: PICTURE.replace("<rect", '<circle r="5"/>\n  <rect') } });
      expect(latest()).toBeUndefined();
      await act(async () => {
        vi.advanceTimersByTime(MARP_TYPING_PAUSE_MS);
      });
      expect(latest()).toContain('<circle r="5"/>');
      vi.useRealTimers();
      await waitFor(() => expect(drawn("circle")).not.toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the last good picture and says what is wrong while the source is broken", async () => {
    const { drawn } = open(createDrawingFile("svg", "Boxes", PICTURE));
    await waitFor(() => expect(drawn("rect")).not.toBeNull());
    const source = screen.getByLabelText("SVG source");
    fireEvent.change(source, { target: { value: "<svg><rect></svg>" } });
    fireEvent.blur(source);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("shows its last good version"),
    );
    expect(drawn("rect")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Add rectangle" })).toHaveProperty("disabled", true);
  });
});

describe("matching the canvas and the source", () => {
  const svg = { format: "svg", source: PICTURE } as const;
  const mermaid = { format: "mermaid", source: "flowchart LR\n  A[One] --> B\n" } as const;
  const dot = { format: "graphviz", source: 'digraph {\n  a [label=<<b>x</b>>];\n  a -> b;\n}\n' } as const;

  it("finds where a selection is written", () => {
    expect(sourceOffsetFor(svg, { kind: "element", index: 2 })).toBe(PICTURE.indexOf("<text"));
    expect(sourceOffsetFor(mermaid, { kind: "node", id: "B" })).toBe(mermaid.source.indexOf("A[One]"));
    expect(sourceOffsetFor(dot, { kind: "node", id: "b" })).toBe(dot.source.indexOf("a -> b"));
  });

  it("selects what the caret's line draws", () => {
    expect(selectionOnLine(svg, 1)).toEqual({ kind: "element", index: 1 });
    expect(selectionOnLine(svg, 0)).toBeNull();
    expect(selectionOnLine(mermaid, 1)).toEqual({ kind: "node", id: "A" });
    expect(selectionOnLine(dot, 2)).toEqual({ kind: "node", id: "a" });
  });

  it("edits labels where they can be found, and leaves HTML labels to the source", () => {
    expect(labelOf(svg, { kind: "element", index: 2 })).toBe("Hello");
    expect(labelOf(svg, { kind: "element", index: 0 })).toBeNull();
    expect(labelOf(dot, { kind: "node", id: "a" })).toBeNull();
    expect(relabel(mermaid, { kind: "node", id: "B" }, "Two")).toBe("flowchart LR\n  A[One] --> B[Two]\n");
    const sequence = { format: "mermaid", source: "sequenceDiagram\n  A->>B: hi there\n" } as const;
    expect(relabel(sequence, { kind: "text", text: "hi there" }, "bye")).toBe("sequenceDiagram\n  A->>B: bye\n");
    expect(relabel(sequence, { kind: "text", text: "not written" }, "bye")).toBeNull();
  });
});
