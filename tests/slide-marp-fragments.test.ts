// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Presentation } from "@suiteleaf/core";
import { marpAudienceDocument, marpFragmentCounts, marpFragmentStep, setMarpFragmentStep, showBuildIds, showBuildSteps } from "../apps/web/src/editors/slide-marp-fragments";
import { nextCursor, prevCursor, startOfShow } from "../apps/web/src/editors/slide-fade-in";

describe("marpFragmentCounts", () => {
  it("counts fragmented bullet lists marked with * and ignores regular - lists", () => {
    const md = `---
marp: true
---

# Regular list
- Item 1
- Item 2
- Item 3

---

# Fragmented list
* Frag 1
* Frag 2
* Frag 3
* Frag 4
`;
    const counts = marpFragmentCounts(md);
    expect(counts).toEqual([0, 4]);
  });

  it("counts fragmented ordered lists marked with ) and ignores regular 1. lists", () => {
    const md = `---
marp: true
---

# Regular ordered
1. First
2. Second

---

# Fragmented ordered
1) First
2) Second
3) Third
`;
    const counts = marpFragmentCounts(md);
    expect(counts).toEqual([0, 3]);
  });

  it("counts nested fragmented list items in reading order", () => {
    const md = `---
marp: true
---

# Nested fragments
* Parent A
  * Child A1
  * Child A2
* Parent B
`;
    const counts = marpFragmentCounts(md);
    expect(counts).toEqual([4]);
  });

  it("handles decks with no fragmented lists", () => {
    const md = `---
marp: true
---

# Slide 1
Just text

---

# Slide 2
- Simple
- Bullets
`;
    const counts = marpFragmentCounts(md);
    expect(counts).toEqual([0, 0]);
  });
});

describe("showBuildIds and showBuildSteps", () => {
  const marpSource = `---
marp: true
---

# Slide 1
* Step A
* Step B
* Step C

---

# Slide 2
- Static A
- Static B
`;

  const deck: Presentation = {
    id: "marp-deck",
    marp: true,
    marpSource,
    slideOrder: ["s1", "s2"],
    slides: {
      s1: { id: "s1", elements: [] },
      s2: { id: "s2", elements: [] },
    },
  };

  it("builds fragment IDs and single-click steps for fragmented MARP slides", () => {
    expect(showBuildIds(deck, 0)).toEqual([
      "marp-fragment-1",
      "marp-fragment-2",
      "marp-fragment-3",
    ]);
    expect(showBuildSteps(deck, 0)).toEqual([1, 1, 1]);

    expect(showBuildIds(deck, 1)).toEqual([]);
    expect(showBuildSteps(deck, 1)).toEqual([]);
  });

  it("runs object animations first, followed by MARP fragments", () => {
    const mixedDeck: Presentation = {
      ...deck,
      slides: {
        ...deck.slides,
        s1: {
          id: "s1",
          elements: [
            {
              id: "callout",
              type: "text",
              content: "Intro",
              animation: "fade-on-click",
              animationTrigger: "click",
              animationOrder: 1,
            },
          ],
        },
      },
    };

    expect(showBuildIds(mixedDeck, 0)).toEqual([
      "callout",
      "marp-fragment-1",
      "marp-fragment-2",
      "marp-fragment-3",
    ]);
    expect(showBuildSteps(mixedDeck, 0)).toEqual([1, 1, 1, 1]);
  });

  it("returns empty arrays for non-MARP decks without animations", () => {
    const standardDeck: Presentation = {
      ...deck,
      marp: false,
    };
    expect(showBuildIds(standardDeck, 0)).toEqual([]);
    expect(showBuildSteps(standardDeck, 0)).toEqual([]);
  });
});

describe("marpFragmentStep", () => {
  const deck: Presentation = {
    id: "marp-deck",
    marp: true,
    marpSource: "# Slide\n\n* A\n* B",
    slideOrder: ["s1"],
    slides: {
      s1: { id: "s1", elements: [] },
    },
  };

  it("returns undefined outside a MARP deck", () => {
    expect(marpFragmentStep({ ...deck, marp: false }, 0, 1)).toBeUndefined();
  });

  it("maps presentation cursor revealed count to fragment step", () => {
    expect(marpFragmentStep(deck, 0, 0)).toBe(0);
    expect(marpFragmentStep(deck, 0, 1)).toBe(1);
    expect(marpFragmentStep(deck, 0, 2)).toBe(2);
  });

  it("accounts for preceding object fade-on-click elements", () => {
    const animatedDeck: Presentation = {
      ...deck,
      slides: {
        s1: {
          id: "s1",
          elements: [
            {
              id: "shape",
              type: "shape",
              animation: "fade-on-click",
              animationTrigger: "click",
              animationOrder: 1,
            },
          ],
        },
      },
    };

    // First click reveals the shape, fragment step remains 0
    expect(marpFragmentStep(animatedDeck, 0, 0)).toBe(0);
    expect(marpFragmentStep(animatedDeck, 0, 1)).toBe(0);
    // Subsequent clicks reveal the fragments
    expect(marpFragmentStep(animatedDeck, 0, 2)).toBe(1);
    expect(marpFragmentStep(animatedDeck, 0, 3)).toBe(2);
  });
});

describe("setMarpFragmentStep", () => {
  function makeFragmentDoc() {
    const doc = new DOMParser().parseFromString(
      `<!doctype html><html><head></head><body>
        <section id="1" data-marpit-fragments="3">
          <h1>Title</h1>
          <ul>
            <li data-marpit-fragment="1">One</li>
            <li data-marpit-fragment="2">Two</li>
            <li data-marpit-fragment="3">Three</li>
          </ul>
        </section>
      </body></html>`,
      "text/html",
    );
    return doc;
  }

  it("hides all fragments at step 0 without reflow", () => {
    const doc = makeFragmentDoc();
    setMarpFragmentStep(doc, 0);

    const style = doc.querySelector("style[data-suiteleaf-fragments]");
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('[data-marpit-fragment="1"]');
    expect(style?.textContent).toContain('[data-marpit-fragment="2"]');
    expect(style?.textContent).toContain('[data-marpit-fragment="3"]');
    expect(style?.textContent).toContain("visibility:hidden!important");

    const items = doc.querySelectorAll("[data-marpit-fragment]");
    for (const item of items) {
      expect(item.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("reveals fragments one by one as step increments", () => {
    const doc = makeFragmentDoc();

    // Step 1: Item 1 visible, 2 and 3 hidden
    setMarpFragmentStep(doc, 1);
    const style = doc.querySelector("style[data-suiteleaf-fragments]");
    expect(style?.textContent).not.toContain('[data-marpit-fragment="1"]');
    expect(style?.textContent).toContain('[data-marpit-fragment="2"]');
    expect(style?.textContent).toContain('[data-marpit-fragment="3"]');
    expect(doc.querySelector('[data-marpit-fragment="1"]')?.hasAttribute("aria-hidden")).toBe(false);
    expect(doc.querySelector('[data-marpit-fragment="2"]')?.getAttribute("aria-hidden")).toBe("true");

    // Step 2: Items 1 and 2 visible, 3 hidden
    setMarpFragmentStep(doc, 2);
    expect(style?.textContent).not.toContain('[data-marpit-fragment="1"]');
    expect(style?.textContent).not.toContain('[data-marpit-fragment="2"]');
    expect(style?.textContent).toContain('[data-marpit-fragment="3"]');
    expect(doc.querySelector('[data-marpit-fragment="2"]')?.hasAttribute("aria-hidden")).toBe(false);
    expect(doc.querySelector('[data-marpit-fragment="3"]')?.getAttribute("aria-hidden")).toBe("true");

    // Step 3: All visible
    setMarpFragmentStep(doc, 3);
    expect(style?.textContent).toBe("");
    expect(doc.querySelector('[data-marpit-fragment="3"]')?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("removes fragment concealing style when step is undefined", () => {
    const doc = makeFragmentDoc();
    setMarpFragmentStep(doc, 0);
    expect(doc.querySelector("style[data-suiteleaf-fragments]")).not.toBeNull();

    setMarpFragmentStep(doc, undefined);
    expect(doc.querySelector("style[data-suiteleaf-fragments]")).toBeNull();
  });
});

describe("marpAudienceDocument", () => {
  it("renders audience document with fragment concealing styles applied", () => {
    const html = `<html><head></head><body>
      <ul>
        <li data-marpit-fragment="1">A</li>
        <li data-marpit-fragment="2">B</li>
      </ul>
    </body></html>`;

    const outStep0 = marpAudienceDocument(html, 0);
    expect(outStep0).toContain("data-suiteleaf-fragments");
    expect(outStep0).toContain('[data-marpit-fragment="1"]');
    expect(outStep0).toContain('[data-marpit-fragment="2"]');

    const outStep1 = marpAudienceDocument(html, 1);
    expect(outStep1).not.toContain('[data-marpit-fragment="1"]');
    expect(outStep1).toContain('[data-marpit-fragment="2"]');
  });
});

describe("presentation mode step-by-step cursor progression", () => {
  const deck: Presentation = {
    id: "marp-deck",
    marp: true,
    marpSource: `# Slide 1
* Point 1
* Point 2

---

# Slide 2
Final
`,
    slideOrder: ["s1", "s2"],
    slides: {
      s1: { id: "s1", elements: [] },
      s2: { id: "s2", elements: [] },
    },
  };

  it("advances one fragment per click then moves to the next slide", () => {
    const idsAt = (i: number) => showBuildIds(deck, i);
    const stepsAt = (i: number) => showBuildSteps(deck, i);

    let cursor = startOfShow(0);
    expect(cursor).toEqual({ slideIndex: 0, revealed: 0, enteringId: null });
    expect(marpFragmentStep(deck, 0, cursor.revealed)).toBe(0);

    // Click 1: reveals fragment 1
    cursor = nextCursor(cursor, idsAt(0), deck.slideOrder.length, stepsAt(0));
    expect(cursor).toEqual({ slideIndex: 0, revealed: 1, enteringId: "marp-fragment-1" });
    expect(marpFragmentStep(deck, 0, cursor.revealed)).toBe(1);

    // Click 2: reveals fragment 2
    cursor = nextCursor(cursor, idsAt(0), deck.slideOrder.length, stepsAt(0));
    expect(cursor).toEqual({ slideIndex: 0, revealed: 2, enteringId: "marp-fragment-2" });
    expect(marpFragmentStep(deck, 0, cursor.revealed)).toBe(2);

    // Click 3: advances to Slide 2
    cursor = nextCursor(cursor, idsAt(0), deck.slideOrder.length, stepsAt(0));
    expect(cursor).toEqual({ slideIndex: 1, revealed: 0, enteringId: null });
    expect(marpFragmentStep(deck, 1, cursor.revealed)).toBe(0);
  });

  it("steps backward through revealed fragments before retreating slide", () => {
    const idsAt = (i: number) => showBuildIds(deck, i);
    const stepsAt = (i: number) => showBuildSteps(deck, i);

    let cursor = { slideIndex: 0, revealed: 2, enteringId: null };
    expect(marpFragmentStep(deck, 0, cursor.revealed)).toBe(2);

    // Step back 1: conceals fragment 2
    cursor = prevCursor(cursor, idsAt, stepsAt);
    expect(cursor.revealed).toBe(1);
    expect(marpFragmentStep(deck, 0, cursor.revealed)).toBe(1);

    // Step back 2: conceals fragment 1
    cursor = prevCursor(cursor, idsAt, stepsAt);
    expect(cursor.revealed).toBe(0);
    expect(marpFragmentStep(deck, 0, cursor.revealed)).toBe(0);
  });
});
