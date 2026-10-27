import { describe, expect, it } from "vitest";
import {
  addDotNode,
  connectDotNodes,
  dotId,
  dotLabel,
  dotNodeLine,
  dotNodeOnLine,
  parseDot,
  removeDotNode,
  renameDotNode,
} from "../apps/web/src/editors/drawing-dot";

const graph = `// build pipeline
digraph G {
    rankdir=LR;
    node [shape=box];
    start [label="Start here"];
    build;
    "two words" [color=red];
    start -> build -> "two words" [label="go"];
    subgraph cluster_x { ship; }
    build -> ship;
}
`;

describe("reading DOT", () => {
  it("finds node statements, edges, and where each node is named", () => {
    const parsed = parseDot(graph);
    expect(parsed.directed).toBe(true);
    expect(parsed.nodes.map((n) => n.id)).toEqual(["start", "build", "two words", "ship"]);
    expect(parsed.edges.map((e) => e.ids)).toEqual([["start", "build", "two words"], ["build", "ship"]]);
    expect(graph[parsed.close]).toBe("}");
    expect(parseDot("graph { a -- b }").directed).toBe(false);
  });

  it("reads labels, falling back to the id", () => {
    expect(dotLabel(graph, "start")).toEqual({ text: "Start here", html: false });
    expect(dotLabel(graph, "build")).toEqual({ text: "build", html: false });
    expect(dotLabel(`digraph { a [label=<<b>x</b>>] }`, "a")).toEqual({ text: "<b>x</b>", html: true });
  });

  it("maps nodes to lines and lines to nodes", () => {
    expect(dotNodeLine(graph, "start")).toBe(4);
    expect(dotNodeLine(graph, "ship")).toBe(8);
    expect(dotNodeOnLine(graph, 7)).toBe("start");
    expect(dotNodeOnLine(graph, 2)).toBeNull();
  });
});

describe("editing DOT in place", () => {
  it("replaces a label that is there", () => {
    expect(renameDotNode(graph, "start", 'Say "hi"')).toContain('start [label="Say \\"hi\\""];');
  });

  it("adds a label to an attribute list, a bare statement, or a new statement", () => {
    expect(renameDotNode(graph, "two words", "Two")).toContain('"two words" [color=red, label="Two"];');
    expect(renameDotNode(graph, "build", "Build")).toContain('    build [label="Build"];\n');
    const edgesOnly = "digraph {\n  a -> b;\n}\n";
    expect(renameDotNode(edgesOnly, "a", "A")).toBe('digraph {\n  a -> b;\n  a [label="A"];\n}\n');
  });

  it("adds and connects nodes before the closing brace", () => {
    const added = addDotNode(graph);
    expect(added.id).toBe("node1");
    expect(added.source).toContain('    build -> ship;\n    node1 [label="New node"];\n}');
    expect(connectDotNodes(graph, "ship", "two words")).toContain('    ship -> "two words";\n}');
    expect(connectDotNodes("graph{}", "a", "b")).toBe("graph{\n    a -- b;\n}");
  });

  it("removes a node with every edge that touches it", () => {
    const next = removeDotNode(graph, "build");
    expect(next.replace("// build pipeline", "")).not.toMatch(/\bbuild\b/);
    expect(next).toContain('    "two words" [color=red];\n    subgraph');
  });

  it("quotes ids only when it must", () => {
    expect(dotId("abc_1")).toBe("abc_1");
    expect(dotId("node")).toBe('"node"');
    expect(dotId("a b")).toBe('"a b"');
    expect(dotId("-1.5")).toBe("-1.5");
  });
});
