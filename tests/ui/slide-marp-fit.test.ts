// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Presentation, SlideElement } from "../../packages/core/src";
import { buildMarpFile } from "../../apps/web/src/editors/slide-marp-import";
import { fitMarpDeck, MARP_FIT_REVISION } from "../../apps/web/src/editors/slide-marp-fit";
import { prepareMarpDocument } from "../../apps/web/src/editors/slide-marp-runtime";

vi.mock("../../apps/web/src/editors/themes/beam_ut.css?raw", () => ({
  default: "/* @theme beam_ut */\nsection { --ut-logo-data-uri: url('data:image/png;base64,TE9HTw=='); }",
}));
vi.mock("../../apps/web/src/editors/slide-marp-runtime", () => ({
  prepareMarpDocument: vi.fn(async () => {}),
}));
vi.mock("../../apps/web/src/editors/slide-marp-render", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../apps/web/src/editors/slide-marp-render")>()),
  marpDocument: ({ html }: { html: string }) => html,
}));

type Box = { left: number; top: number; width: number; height: number };

/**
 * jsdom neither loads `srcdoc` nor lays anything out. These stand-ins load the
 * rendered slides into the frame, place every block on its own row (sections
 * fill 1280x720), and answer computed styles from per-test rules.
 */
let rectRules: [string, Partial<Box>][] = [];
let styleRules: [string, Record<string, string>][] = [];
let beforeStyle: Record<string, string> = { display: "none", content: "none" };
let rows = new WeakMap<Element, number>();
let nextRow = 0;
let slowImages = false;
const BASE_STYLE: Record<string, string> = {
  fontWeight: "400",
  fontStyle: "normal",
  color: "rgb(20, 20, 20)",
  fontSize: "32px",
  lineHeight: "40px",
  fontFamily: "Willow",
  textIndent: "0px",
  textAlign: "start",
  borderTopLeftRadius: "0px",
  backgroundColor: "rgba(0, 0, 0, 0)",
  borderTopWidth: "0px",
  borderTopColor: "rgb(0, 0, 0)",
  borderLeftWidth: "0px",
  borderLeftColor: "rgb(0, 0, 0)",
  maxHeight: "none",
};

function rectOf(this: Element): DOMRect {
  let box: Box;
  if (this.tagName === "SECTION") box = { left: 0, top: 0, width: 1280, height: 720 };
  else {
    if (!rows.has(this)) rows.set(this, nextRow++);
    box = { left: 100, top: 20 + rows.get(this)! * 120, width: 800, height: 40 };
  }
  for (const [selector, value] of rectRules) if (this.matches(selector)) box = { ...box, ...value };
  return {
    ...box,
    x: box.left,
    y: box.top,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => box,
  } as DOMRect;
}

function styleOf(el: Element, pseudo?: string | null): CSSStyleDeclaration {
  const values: Record<string, string> = { ...BASE_STYLE };
  if (pseudo) Object.assign(values, beforeStyle);
  else {
    if (/^(STRONG|TH|H[1-6])$/.test(el.tagName)) values.fontWeight = "700";
    if (el.tagName === "EM") values.fontStyle = "italic";
    for (const [selector, value] of styleRules) if (el.matches(selector)) Object.assign(values, value);
  }
  const camel = (name: string) => name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
  return { ...values, getPropertyValue: (name: string) => values[camel(name)] ?? "" } as unknown as CSSStyleDeclaration;
}

function scalingShadow(host: Element, nested: boolean) {
  if (host.shadowRoot) return;
  const root = host.attachShadow({ mode: "open" });
  const svg = '<svg><foreignObject width="800" height="100"></foreignObject></svg>';
  if (!nested) {
    root.innerHTML = svg;
    return;
  }
  root.innerHTML = "<marp-auto-scaling></marp-auto-scaling>";
  root.querySelector("marp-auto-scaling")!.attachShadow({ mode: "open" }).innerHTML = svg;
}

const srcdoc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "srcdoc");

beforeEach(() => {
  rectRules = [["svg", { width: 400, height: 100 }]];
  styleRules = [];
  beforeStyle = { display: "none", content: "none" };
  rows = new WeakMap();
  nextRow = 0;
  slowImages = false;
  let made = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:pic-${++made}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(rectOf);
  vi.spyOn(window, "getComputedStyle").mockImplementation(styleOf);
  Object.defineProperty(HTMLIFrameElement.prototype, "srcdoc", {
    configurable: true,
    set(this: HTMLIFrameElement, html: string) {
      const view = this.contentWindow as unknown as typeof globalThis;
      vi.spyOn(view.Element.prototype, "getBoundingClientRect").mockImplementation(rectOf);
      const images = view.HTMLImageElement.prototype;
      Object.defineProperty(images, "complete", { configurable: true, get: () => !slowImages });
      for (const event of ["onload", "onerror"] as const)
        Object.defineProperty(images, event, {
          configurable: true,
          set(this: HTMLImageElement, handler: () => void) {
            if ((this.alt === "broken") === (event === "onerror")) setTimeout(handler, 0);
          },
        });
      const doc = this.contentDocument!;
      doc.body.innerHTML = html;
      for (const host of doc.querySelectorAll("span[data-auto-scaling]")) scalingShadow(host, true);
      new view.MutationObserver(() => {
        for (const host of doc.querySelectorAll("marp-pre")) scalingShadow(host, false);
      }).observe(doc.body, { childList: true, subtree: true });
      setTimeout(() => this.onload?.(new Event("load")), 0);
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (srcdoc) Object.defineProperty(HTMLIFrameElement.prototype, "srcdoc", srcdoc);
  delete (navigator as { scheduling?: unknown }).scheduling;
  delete (globalThis as { scheduler?: unknown }).scheduler;
});

const PICTURE = "data:image/png;base64,iVBORw0KGgo=";

function deckOf(markdown: string, assets: Record<string, string> = {}): Presentation {
  return buildMarpFile("Deck", markdown, assets).content;
}

function elementsOf(deck: Presentation, index = 0): SlideElement[] {
  return deck.slides[deck.slideOrder[index]].elements;
}

const textOf = (elements: SlideElement[], content: string) =>
  elements.find((el) => el.type === "text" && el.content === content);

const BODY = `---
marp: true
---

# Title **bold**

Para with *it* and <u>under</u> and <span style="color: red">red</span>
line two

- one
- two
  - nested
1. first

\`\`\`js
const a = 1;
\`\`\`

> quote

$$
x^2
$$

Inline $y$ math

| a | b |
|---|---|
| \`c\` | d |

![A cat](media/a.png)

<div class="box">raw html</div>

---

## Second
`;

describe("laying a MARP deck out from its rendering", () => {
  it("places headings, styled text, lists, code, quotes, math, tables, pictures, and raw HTML", async () => {
    styleRules = [
      ["span[style*='color']", { color: "rgb(255, 0, 0)" }],
      ["marp-pre", { backgroundColor: "rgb(240, 240, 240)" }],
      ["blockquote", { borderLeftWidth: "8px", borderLeftColor: "rgb(191, 87, 0)", fontStyle: "italic" }],
    ];
    const deck = deckOf(BODY, { "media/a.png": PICTURE, "media/unused.png": PICTURE });
    const fitted = (await fitMarpDeck(deck))!;
    expect(fitted.marpFit).toBe(MARP_FIT_REVISION);
    expect(fitted.slideOrder).toHaveLength(2);
    expect(fitted.marpAssets).toMatchObject({ "media/a.png": PICTURE, "beam-ut-logo": "data:image/png;base64,TE9HTw==" });
    expect(prepareMarpDocument).toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();

    const elements = elementsOf(fitted);
    const title = textOf(elements, "Title bold")!;
    expect(title).toMatchObject({ placeholder: "Click to add title", bold: true, fontSize: 24, marpLines: [4, 5] });
    expect(title).toMatchObject({ x: 75, width: 600, height: 30, lineHeight: 1.25, color: "#141414", align: "left" });

    const para = elements.find((el) => el.content?.startsWith("Para with"))!;
    expect(para.content).toBe("Para with it and under and red\nline two");
    expect(para.runs?.map((run) => run.text).join("")).toBe(para.content);
    expect(para.runs).toEqual(
      expect.arrayContaining([
        { text: "it", italic: true },
        { text: "under", underline: true },
        { text: "red", color: "#ff0000" },
      ]),
    );

    expect(textOf(elements, "• one")).toMatchObject({ marpLines: [9, 10], x: 51, width: 624 });
    expect(textOf(elements, "• two")).toMatchObject({ marpLines: [10, 11] });
    expect(textOf(elements, "• nested")).toMatchObject({ marpLines: [11, 12] });
    expect(textOf(elements, "1. first")).toMatchObject({ marpLines: [12, 14] });

    const code = textOf(elements, "const a = 1;")!;
    expect(code).toMatchObject({ preformatted: true, codeLanguage: "js", marpLines: [14, 17] });
    expect(code.fontSize).toBe(12);
    const codeBack = elements.find((el) => el.type === "shape" && el.fill === "#f0f0f0")!;
    expect(codeBack).toMatchObject({ shapeType: "rect", x: code.x, y: code.y });

    expect(textOf(elements, "quote")).toMatchObject({ italic: true, marpLines: [18, 19] });
    expect(elements.find((el) => el.type === "shape" && el.fill === "#bf5700")).toMatchObject({ width: 6 });

    const math = textOf(elements, "$$\nx^2\n$$")!;
    expect(math).toMatchObject({ math: true, marpLines: [20, 23], fontSize: 12 });
    expect(textOf(elements, "Inline $y$ math")).toBeDefined();

    expect(elements.find((el) => el.type === "table")).toMatchObject({
      rows: [["a", "b"], ["`c`", "d"]],
      fontSize: 24,
      cellMarks: [[{ bold: true }, { bold: true }], [{}, {}]],
      marpLines: [26, 29],
    });
    expect(elements.find((el) => el.type === "image")).toMatchObject({ src: "media/a.png", alt: "A cat", marpLines: [30, 31] });
    expect(elements.find((el) => el.marpHtml)).toMatchObject({ type: "shape", marpLines: [32, 33], width: 600 });

    expect(elementsOf(fitted, 1)).toEqual([
      expect.objectContaining({ content: "Second", placeholder: "Click to add title", marpLines: [36, 37] }),
    ]);
    expect(fitted.slides[fitted.slideOrder[0]].background).toEqual({ color: "#ffffff" });
  });

  it("keeps box ids and pinned backgrounds when laid out again, and drops slides that are gone", async () => {
    const first = (await fitMarpDeck(deckOf("# One\n\nBody\n\n---\n\n# Two\n\n---\n\n# Three\n")))!;
    expect(first.slideOrder).toHaveLength(3);
    const id = first.slideOrder[0];
    first.slides[id].background = { color: "#ffffff", pinned: true };
    const titleId = elementsOf(first)[0].id;
    const again = (await fitMarpDeck({ ...first, marpSource: "# One\n\nBody changed\n\n---\n\n# Two\n" }))!;
    expect(again.slideOrder).toEqual(first.slideOrder.slice(0, 2));
    expect(elementsOf(again)[0]).toMatchObject({ id: titleId, content: "One" });
    expect(again.slides[id].background).toEqual({ color: "#ffffff", pinned: true });
  });

  it("draws Beam UT's footer bars and logo and the title pill around the heading", async () => {
    beforeStyle = { display: "block", content: '""', width: "120px", height: "40px", right: "20px", top: "10px" };
    styleRules = [
      ["section", { backgroundColor: "rgb(250, 250, 250)" }],
      [
        "h1",
        {
          backgroundColor: "rgb(191, 87, 0)",
          borderTopLeftRadius: "16px",
          borderTopWidth: "4px",
          borderTopColor: "rgb(51, 63, 72)",
          paddingTop: "8px",
          paddingLeft: "16px",
          borderLeftWidth: "4px",
        },
      ],
      ["p", { textAlign: "center", textIndent: "20px", backgroundColor: "rgb(255, 255, 0)", fontWeight: "bold" }],
    ];
    const fitted = (await fitMarpDeck(deckOf("---\nmarp: true\ntheme: beam_ut\nheader: Head\nfooter: Foot\n---\n\n# Pill\n\nCentered\n")))!;
    const elements = elementsOf(fitted);
    expect(elements.slice(0, 2)).toEqual([
      expect.objectContaining({ type: "shape", x: 0, y: 518, width: 480, height: 22, fill: "#333F48" }),
      expect.objectContaining({ type: "shape", x: 480, y: 518, width: 480, height: 22, fill: "#BF5700" }),
    ]);
    const pill = elements.find((el) => el.shapeType === "roundRect")!;
    expect(pill).toMatchObject({ radius: 12, fill: "#bf5700", stroke: "#333f48", strokeWidth: 3 });
    const title = textOf(elements, "Pill")!;
    expect(title.x).toBe(pill.x + 15);
    expect(title.y).toBe(pill.y + 9);
    expect(title.width).toBe(pill.width - 15);
    expect(title.fill).toBeUndefined();
    expect(textOf(elements, "Centered")).toMatchObject({ align: "center", padLeft: 15, fill: "#ffff00", bold: true });
    expect(elements[elements.length - 1]).toMatchObject({
      type: "image",
      src: "beam-ut-logo",
      x: 855,
      y: 7.5,
      width: 90,
      height: 30,
    });
    expect(fitted.slides[fitted.slideOrder[0]].background).toEqual({ color: "#fafafa" });
    expect(elements.some((el) => el.content === "Head" || el.content === "Foot" || el.marpHtml)).toBe(false);
  });

  it("hangs list markers where the words begin and lists nested items of an empty-looking item", async () => {
    rectRules.push(["span[style*='visibility']", { width: 20 }], ['li[data-sl-lines="0,2"]', { width: 0 }]);
    const elements = elementsOf((await fitMarpDeck(deckOf("- parent\n  - child\n- **all bold**\n- <u>underlined</u>\n")))!);
    expect(elements.find((el) => el.content?.includes("parent"))).toBeUndefined();
    expect(textOf(elements, "• child")).toMatchObject({ hang: 15, x: 60, width: 615 });
    expect(textOf(elements, "• all bold")).toMatchObject({ runs: [{ text: "• " }, { text: "all bold", bold: true }] });
    expect(textOf(elements, "• underlined")?.runs).toEqual([{ text: "• " }, { text: "underlined", underline: true }]);
  });

  it("gives authored HTML paragraphs their own boxes and skips blocks that draw nothing", async () => {
    rectRules.push(["h3", { height: 1 }], ["div.tiny", { width: 1 }]);
    const markdown = '# T\n\n<span class="x">only html</span>\n\n### hidden\n\n<div class="tiny">x</div>\n\n<div>a</div>\n<div>b</div>\n\nAfter\n';
    const elements = elementsOf((await fitMarpDeck(deckOf(markdown)))!);
    const html = elements.filter((el) => el.marpHtml);
    expect(html.map((el) => el.marpLines)).toEqual([[2, 3], [6, 7], [8, 10]]);
    expect(elements.some((el) => el.content === "hidden")).toBe(false);
  });

  it("waits for pictures that are still loading or fail", async () => {
    slowImages = true;
    const started = performance.now();
    const fitted = await fitMarpDeck(
      deckOf("![ok](media/a.png)\n\n![broken](media/b.png)\n", { "media/a.png": PICTURE, "media/b.png": `${PICTURE}A` }),
    );
    expect(elementsOf(fitted!).map((el) => el.alt)).toEqual(["ok", "broken"]);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("gives way to waiting input between slides", async () => {
    const yieldTurn = vi.fn(async () => {});
    Object.assign(navigator, { scheduling: { isInputPending: () => true } });
    Object.assign(globalThis, { scheduler: { yield: yieldTurn } });
    await fitMarpDeck(deckOf("# A\n\n---\n\n# B\n"));
    expect(yieldTurn).toHaveBeenCalledTimes(2);
  });

  it("still lays out when the diagram and chart step fails", async () => {
    vi.mocked(prepareMarpDocument).mockRejectedValueOnce(new Error("Chart canvas c1 is missing."));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fitted = await fitMarpDeck(deckOf("# Still here\n"));
    expect(error).toHaveBeenCalledWith("Chart canvas c1 is missing.");
    expect(textOf(elementsOf(fitted!), "Still here")).toBeDefined();
  });

  it("returns nothing without markdown or once newer markdown has made the work pointless", async () => {
    const deck = deckOf("# A\n");
    expect(await fitMarpDeck({ ...deck, marpSource: "  " })).toBeNull();
    expect(await fitMarpDeck(deck, { stale: () => true })).toBeNull();
    let checks = 0;
    expect(await fitMarpDeck(deck, { stale: () => ++checks > 1 })).toBeNull();
    checks = 0;
    expect(await fitMarpDeck(deck, { stale: () => ++checks > 2 })).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });
});
