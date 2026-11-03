import { describe, expect, it } from "vitest";
import type { Presentation, SlideElement } from "../packages/core/src";
import { deckToHtml } from "../apps/web/src/editors/slide-html";

function deckWith(element: SlideElement): Presentation {
  return {
    id: "deck",
    width: 960,
    height: 540,
    slideOrder: ["s1"],
    slides: {
      s1: { id: "s1", elements: [element] },
    },
  };
}

describe("slide HTML export", () => {
  it("leaves a hidden slide out and escapes speaker notes", () => {
    const hidden = {
      id: "hidden",
      hidden: true,
      notes: "secret-value",
      elements: [
        { id: "secret", type: "text" as const, x: 0, y: 0, width: 10, height: 10, content: "secret-value" },
      ],
    };
    const html = deckToHtml(
      {
        id: "deck",
        width: 960,
        height: 540,
        slideOrder: ["hidden", "shown"],
        slides: {
          hidden,
          shown: {
            id: "shown",
            notes: "Water <the> beds",
            elements: [{ id: "title", type: "text", x: 0, y: 0, width: 10, height: 10, content: "North" }],
          },
        },
      },
      "Garden <club>",
    );
    expect(html).toContain("North");
    expect(html).toContain("Notes: Water &lt;the&gt; beds");
    expect(html).toContain("<title>Garden &lt;club&gt;</title>");
    expect(html).not.toContain("secret-value");
    expect(html).not.toContain("<script>");
    expect(hidden.notes).toBe("secret-value");
  });

  it("leaves a decorative object out of the HTML", () => {
    const element = {
      id: "mark",
      type: "text" as const,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      decorative: true,
      content: "secret-value",
    };
    const html = deckToHtml(
      {
        id: "deck",
        width: 960,
        height: 540,
        slideOrder: ["shown"],
        slides: {
          shown: {
            id: "shown",
            elements: [
              { id: "title", type: "text", x: 0, y: 0, width: 10, height: 10, content: "North" },
              element,
            ],
          },
        },
      },
      "Garden club",
    );
    expect(html).toContain("North");
    expect(html).not.toContain("secret-value");
    expect(element.content).toBe("secret-value");
  });

  it.each(["audio", "video"] as const)(
    "escapes markup in the %s file name",
    (type) => {
      const html = deckToHtml(
        deckWith({
          id: "media",
          type,
          x: 36,
          y: 400,
          width: 320,
          height: 96,
          src: "data:application/octet-stream;base64,AA==",
          alt: "clip <script>alert(1)</script>",
        }),
        "Deck",
      );
      expect(html).toContain("<p>clip &lt;script&gt;alert(1)&lt;/script&gt;</p>");
      expect(html).not.toContain("<script>");
    },
  );

  it("leaves a clip address that is not a media file out of the HTML", () => {
    const element = {
      id: "media",
      type: "video" as const,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      src: "javascript:secret-value",
      alt: "Beds",
    };
    const html = deckToHtml(deckWith(element), "Garden club");
    expect(html).toContain("<p>Beds</p>");
    expect(html).not.toContain("secret-value");
    expect(html).not.toContain("javascript:");
    expect(element.src).toBe("javascript:secret-value");
    const signed = deckToHtml(
      deckWith({ ...element, src: "https://user:secret-value@example.test/beds.mp4" }),
      "Garden club",
    );
    expect(signed).not.toContain("secret-value");
    expect(signed).toContain("<p>Beds</p>");
    const kept = deckToHtml(
      deckWith({ ...element, src: "https://example.test/beds.mp4" }),
      "Garden club",
    );
    expect(kept).toContain('src="https://example.test/beds.mp4"');
  });

  it("keeps a quote in a picture address inside the attribute", () => {
    const element = {
      id: "photo",
      type: "image" as const,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      src: 'https://example.test/beds.png" onerror="alert(1)',
      alt: 'Water "the" beds',
    };
    const slide = {
      id: "shown",
      background: { color: "secret-value" },
      elements: [element],
    };
    const html = deckToHtml(
      { id: "deck", width: 960, height: 540, slideOrder: ["shown"], slides: { shown: slide } },
      "Garden club",
    );
    expect(html).toContain("src=\"https://example.test/beds.png&quot; onerror=&quot;alert(1)\"");
    expect(html).toContain('alt="Water &quot;the&quot; beds"');
    expect(html).toContain("background-color: #fff;");
    expect(html).not.toContain('onerror="');
    expect(html).not.toContain("secret-value");
    expect(element.src).toContain("onerror");
    expect(slide.background.color).toBe("secret-value");
  });

  it("uses the master background when the slide stores no color", () => {
    const blank = { id: "shown", elements: [] };
    const html = deckToHtml(
      {
        id: "deck",
        width: 960,
        height: 540,
        slideOrder: ["shown"],
        slides: { shown: blank },
        master: { background: { color: "#112233" }, elements: [] },
      },
      "Garden club",
    );
    expect(html).toContain("background-color: #112233;");
    const own = deckToHtml(
      {
        id: "deck",
        width: 960,
        height: 540,
        slideOrder: ["shown"],
        slides: { shown: { id: "shown", background: { color: "#000000" }, elements: [] } },
        master: { background: { color: "secret-value" }, elements: [] },
      },
      "Garden club",
    );
    expect(own).toContain("background-color: #000000;");
    expect(own).not.toContain("secret-value");
    const badMaster = deckToHtml(
      {
        id: "deck",
        width: 960,
        height: 540,
        slideOrder: ["shown"],
        slides: { shown: blank },
        master: { background: { color: "secret-value" }, elements: [] },
      },
      "Garden club",
    );
    expect(badMaster).toContain("background-color: #fff;");
    expect(badMaster).not.toContain("secret-value");
    expect(blank.elements).toEqual([]);
  });
});
