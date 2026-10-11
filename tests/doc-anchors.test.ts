import { expect, test } from "vitest";
import {
  slugify,
  uniqueSlug,
  isInternalAnchor,
  anchorHref,
  assignHeadingAnchors,
} from "../apps/web/src/anchors";

test("slugify lowercases, hyphenates and strips punctuation", () => {
  expect(slugify("Quarterly Report")).toBe("quarterly-report");
  expect(slugify("Section 1: Intro & Details")).toBe(
    "section-1-intro-details",
  );
  expect(slugify("   Leading and trailing   ")).toBe("leading-and-trailing");
  expect(slugify("a   b   c")).toBe("a-b-c");
});

test("slugify strips accents (NFKD) and falls back for empty input", () => {
  // Unicode escapes keep the source file ASCII-safe; accents must be stripped.
  expect(slugify("R\u00e9sum\u00e9")).toBe("resume");
  expect(slugify("Caf\u00e9 na\u00efve")).toBe("cafe-naive");
  expect(slugify("!!!")).toBe("heading");
  expect(slugify("")).toBe("heading");
});

test("uniqueSlug disambiguates duplicates with -1, -2...", () => {
  const used = new Set<string>();
  expect(uniqueSlug("Intro", used)).toEqual({ slug: "intro", taken: false });
  expect(uniqueSlug("Intro", used)).toEqual({ slug: "intro-1", taken: true });
  expect(uniqueSlug("Intro", used)).toEqual({ slug: "intro-2", taken: true });
  // A base that is itself a previously generated suffix stays unique.
  expect(uniqueSlug("intro-1", used)).toEqual({
    slug: "intro-1-1",
    taken: true,
  });
});

test("isInternalAnchor recognizes in-document links only", () => {
  expect(isInternalAnchor("#quarterly-report")).toBe(true);
  expect(isInternalAnchor("#")).toBe(true);
  expect(isInternalAnchor("#a")).toBe(true);
  expect(isInternalAnchor("https://suiteleaf.dev")).toBe(false);
  expect(isInternalAnchor("https://a#frag")).toBe(false);
  expect(isInternalAnchor("#has space")).toBe(false);
});

test("anchorHref builds the href for a heading slug", () => {
  expect(anchorHref("quarterly-report")).toBe("#quarterly-report");
});

test("assignHeadingAnchors assigns document-unique ids to headings only", () => {
  const tree = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { id: null, level: 1 },
        content: [{ type: "text", text: "Intro" }],
      },
      {
        type: "heading",
        attrs: { id: null, level: 2 },
        content: [{ type: "text", text: "Intro" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "body" }] },
      { type: "heading", attrs: { id: "preexisting", level: 1 }, content: [] },
    ],
  };
  const used = new Set<string>();
  const assigned = assignHeadingAnchors(tree, used);
  expect(assigned).toBe(2); // only the two id-less headings
  expect(tree.content[0].attrs.id).toBe("intro");
  expect(tree.content[1].attrs.id).toBe("intro-1"); // deduped against the first
  expect(tree.content[3].attrs.id).toBe("preexisting"); // untouched
});
