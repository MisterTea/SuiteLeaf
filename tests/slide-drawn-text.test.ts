import { describe, expect, it } from "vitest";
import { drawnTextKind } from "../apps/web/src/editors/slide-drawn-text";

describe("drawn slide text", () => {
  it("keeps PowerPoint runs when a currency mark is not Marp math", () => {
    expect(
      drawnTextKind({
        content: "US$29,605\nper preprint per year",
        runs: [
          { text: "US$29,605", fontSize: 110 },
          { text: "\n" },
          { text: "per preprint per year", fontSize: 32 },
        ],
      }),
    ).toBe("runs");
  });

  it("still typesets Marp inline math", () => {
    expect(
      drawnTextKind({
        marpLines: [1, 2],
        content: "wrapped $x$ and",
        runs: [{ text: "wrapped $x$ and" }],
      }),
    ).toBe("marp");
    expect(drawnTextKind({ content: "Energy is $E=mc^2$ today" })).toBe("rich");
    expect(drawnTextKind({ preformatted: true, content: "code" })).toBe("code");
    expect(drawnTextKind({ math: true, content: "E=mc^2" })).toBe("math");
    expect(drawnTextKind({ content: "Hello" })).toBe("plain");
  });
});
