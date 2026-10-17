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
});
