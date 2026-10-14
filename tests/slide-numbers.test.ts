import { describe, expect, it } from "vitest";
import {
  createFile,
  parseFile,
  serializeFile,
  type SlideFile,
} from "../packages/core/src";
import {
  moveShowCursor,
  slideNumberLabel,
  startOfShow,
} from "../apps/web/src/editors/slide-fade-in";

describe("slide numbers", () => {
  it("keeps each slide's place when the middle slide is skipped", () => {
    const file = createFile("slide", "Town hall") as SlideFile;
    const welcome = file.content.slideOrder[0];
    file.content.slideOrder.push("prices", "thanks");
    file.content.slides[welcome].title = "Welcome";
    file.content.slides[welcome].elements = [
      {
        id: "welcome",
        type: "text",
        x: 72,
        y: 180,
        width: 800,
        height: 120,
        content: "Welcome",
      },
    ];
    file.content.slides.prices = {
      id: "prices",
      title: "Prices",
      skipped: true,
      elements: [
        {
          id: "prices",
          type: "text",
          x: 72,
          y: 180,
          width: 800,
          height: 120,
          content: "Prices",
        },
      ],
    };
    file.content.slides.thanks = {
      id: "thanks",
      title: "Thanks",
      elements: [
        {
          id: "thanks",
          type: "text",
          x: 72,
          y: 180,
          width: 800,
          height: 120,
          content: "Thanks",
        },
      ],
    };
    file.content.showSlideNumbers = true;

    const skipped = (index: number) => index === 1;
    const welcomeAt = startOfShow(0, skipped, 3);
    const thanksAt = moveShowCursor(welcomeAt, "next", () => [], 3, skipped);
    expect(welcomeAt.slideIndex).toBe(0);
    expect(thanksAt.slideIndex).toBe(2);
    expect(slideNumberLabel(0, 3, true)).toBe("1 of 3");
    expect(slideNumberLabel(1, 3, true)).toBe("2 of 3");
    expect(slideNumberLabel(2, 3, true)).toBe("3 of 3");
    expect(slideNumberLabel(welcomeAt.slideIndex, 3, true)).toBe("1 of 3");
    expect(slideNumberLabel(thanksAt.slideIndex, 3, true)).toBe("3 of 3");

    const saved = parseFile(serializeFile(file)) as SlideFile;
    expect(saved.content.showSlideNumbers).toBe(true);
    expect(saved.content.slides.prices.skipped).toBe(true);
    expect(saved.content.slides.thanks.elements.map((el) => el.content)).toEqual(["Thanks"]);
    expect(slideNumberLabel(0, saved.content.slideOrder.length, saved.content.showSlideNumbers)).toBe(
      "1 of 3",
    );
    expect(slideNumberLabel(1, saved.content.slideOrder.length, saved.content.showSlideNumbers)).toBe(
      "2 of 3",
    );
    expect(slideNumberLabel(2, saved.content.slideOrder.length, saved.content.showSlideNumbers)).toBe(
      "3 of 3",
    );

    saved.content.showSlideNumbers = false;
    const hidden = parseFile(serializeFile(saved)) as SlideFile;
    expect(hidden.content.showSlideNumbers).toBe(false);
    expect(hidden.content.slides.prices.skipped).toBe(true);
    expect(slideNumberLabel(0, 3, hidden.content.showSlideNumbers)).toBeNull();
    expect(slideNumberLabel(1, 3, hidden.content.showSlideNumbers)).toBeNull();
    expect(slideNumberLabel(2, 3, hidden.content.showSlideNumbers)).toBeNull();

    const older = parseFile(serializeFile(createFile("slide", "Old"))) as SlideFile;
    expect(older.content.showSlideNumbers).toBeUndefined();
    expect(slideNumberLabel(0, older.content.slideOrder.length, older.content.showSlideNumbers)).toBe(
      null,
    );
  });
});
