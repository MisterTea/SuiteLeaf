import { describe, expect, it } from "vitest";
import {
  addMermaidNode,
  connectMermaidNodes,
  isFlowchart,
  lineWithText,
  mermaidLabel,
  mermaidNodeLine,
  mermaidNodeOnLine,
  mermaidNodes,
  removeMermaidNode,
  renameMermaidNode,
  replaceOnLine,
} from "../apps/web/src/editors/drawing-mermaid";

const chart = `---
title: Example
---
%% a comment
flowchart TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C([Ship it])
    B -- No --> D["Fix (it)"]
    D -.-> B & E
    style D fill:#f9f
    classDef warm fill:#fee
`;

describe("reading flowcharts", () => {
  it("tells flowcharts from other diagrams, past front matter and comments", () => {
    expect(isFlowchart(chart)).toBe(true);
    expect(isFlowchart("graph LR\n a-->b")).toBe(true);
    expect(isFlowchart("sequenceDiagram\n A->>B: hi")).toBe(false);
  });

  it("finds every node and the label it was given", () => {
    expect(mermaidNodes(chart).map((n) => n.id)).toEqual(["A", "B", "B", "C", "B", "D", "D", "B", "E"]);
    expect(mermaidLabel(chart, "A")).toBe("Start");
    expect(mermaidLabel(chart, "B")).toBe("Is it working?");
    expect(mermaidLabel(chart, "C")).toBe("Ship it");
    expect(mermaidLabel(chart, "D")).toBe("Fix (it)");
    expect(mermaidLabel(chart, "E")).toBe("E");
  });

  it("maps nodes to lines and lines to nodes", () => {
    expect(mermaidNodeLine(chart, "C")).toBe(6);
    expect(mermaidNodeLine(chart, "D")).toBe(7);
    expect(mermaidNodeOnLine(chart, 8)).toBe("D");
    expect(mermaidNodeOnLine(chart, 9)).toBeNull();
  });
});

describe("editing flowcharts in place", () => {
  it("renames a node where its label is, quoting when the text needs it", () => {
    expect(renameMermaidNode(chart, "A", "Begin")).toContain("A[Begin] --> B");
    expect(renameMermaidNode(chart, "C", "Go (now)")).toContain('C(["Go (now)"])');
    expect(renameMermaidNode(chart, "D", "Fixed")).toContain("D[Fixed]");
    expect(renameMermaidNode(chart, "E", "End")).toContain("B & E[End]");
  });

  it("adds and connects nodes at the end, at the statements' indentation", () => {
    const added = addMermaidNode(chart);
    expect(added.id).toBe("node1");
    expect(added.source.endsWith("    classDef warm fill:#fee\n    node1[New node]\n")).toBe(true);
    expect(connectMermaidNodes(chart, "E", "A").endsWith("    E --> A\n")).toBe(true);
  });

  it("removes the lines that name a node, its style included", () => {
    const next = removeMermaidNode(chart, "D");
    expect(next).not.toMatch(/\bD\b/);
    expect(next).toContain("C([Ship it])\n    classDef");
  });
});

describe("editing other diagrams through their text", () => {
  const sequence = "sequenceDiagram\n    Alice->>Bob: Hello   there\n    Bob-->>Alice: Hi\n";
  it("finds the line that shows some text", () => {
    expect(lineWithText(sequence, "Hello there")).toBe(1);
    expect(lineWithText(sequence, "Bob")).toBe(1);
    expect(lineWithText(sequence, "missing")).toBeNull();
  });

  it("replaces text on one line only", () => {
    expect(replaceOnLine(sequence, 2, "Alice", "Carol")).toBe(
      "sequenceDiagram\n    Alice->>Bob: Hello   there\n    Bob-->>Carol: Hi\n",
    );
    expect(replaceOnLine(sequence, 2, "Hello", "x")).toBe(sequence);
  });
});
