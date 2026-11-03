import { expect, it } from "vitest";
import { pageBreakSpots, printedFromPhysical } from "../apps/web/src/editors/doc-toc-pages";

type Node = {
  type: { name: string };
  textContent: string;
  attrs?: { restartAt?: unknown };
  children?: Node[];
  pos: number;
  descendants: (visit: (node: Node, pos: number) => boolean | void) => void;
};

function node(
  name: string,
  pos: number,
  text = "",
  children: Node[] = [],
  attrs?: { restartAt?: unknown },
): Node {
  const current: Node = {
    type: { name },
    textContent: text,
    children,
    pos,
    attrs,
    descendants(visit) {
      const skip = visit(current, pos);
      if (skip === false) return;
      for (const child of children) child.descendants(visit);
    },
  };
  return current;
}

it("numbers headings from page breaks and leaves the heading text out", () => {
  const beds = node("heading", 1, "Beds");
  const breakNode = node("pageBreak", 5);
  const paths = node("heading", 10, "secret-value");
  const doc = node("doc", 0, "", [beds, breakNode, paths]);
  const spots = pageBreakSpots(doc);
  expect(spots).toEqual([
    { pos: 1, page: 1 },
    { pos: 10, page: 2 },
  ]);
  expect(JSON.stringify(spots)).not.toContain("secret-value");
  expect(JSON.stringify(spots)).not.toContain("Beds");
});

it("restarts a contents page at a section break", () => {
  const beds = node("heading", 1, "Beds");
  const section = node("sectionBreak", 5, "", [], { restartAt: 5 });
  const paths = node("heading", 10, "secret-value");
  const spots = pageBreakSpots(node("doc", 0, "", [beds, section, paths]));
  expect(spots).toEqual([
    { pos: 1, page: 1 },
    { pos: 10, page: 5 },
  ]);
  expect(printedFromPhysical(2, [{ page: 2, restartAt: 5 }])).toBe(5);
  expect(printedFromPhysical(1, [{ page: 2, restartAt: 5 }])).toBe(1);
  const continued = pageBreakSpots(
    node("doc", 0, "", [beds, node("sectionBreak", 5, "", [], { restartAt: "secret-value" }), paths]),
  );
  expect(continued).toEqual([
    { pos: 1, page: 1 },
    { pos: 10, page: 2 },
  ]);
  expect(JSON.stringify(continued)).not.toContain("secret-value");
});
