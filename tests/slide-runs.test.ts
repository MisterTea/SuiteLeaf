import { describe, expect, it } from "vitest";
import {
  createFile,
  parseFile,
  serializeFile,
  type SlideElement,
  type SlideFile,
} from "../packages/core/src";
import {
  applyDeckTheme,
  DECK_THEMES,
  resetToTheme,
} from "../apps/web/src/editors/slide-theme";
import {
  hasTextRuns,
  plainText,
  rangeHas,
  runsOf,
  styleSelection,
  styleWholeBox,
  textInnerHtml,
} from "../apps/web/src/editors/slide-runs";

const meadow = DECK_THEMES.find((theme) => theme.id === "meadow")!;
const ink = DECK_THEMES.find((theme) => theme.id === "ink")!;
const line = "Spring fair for the community centre";

function box(extra: Partial<SlideElement> = {}): SlideElement {
  return {
    id: "title",
    type: "text",
    x: 70,
    y: 180,
    width: 820,
    height: 90,
    content: line,
    fontSize: 22,
    fontFamily: meadow.bodyFont,
    color: meadow.bodyColor,
    ...extra,
  };
}

const fair = line.indexOf("fair");
const community = line.indexOf("community");
const centre = line.indexOf("centre");

describe("per-word slide formatting", () => {
  it("bolds, colours, and underlines one word without touching the others", () => {
    const bolded = styleSelection(box(), fair, fair + "fair".length, {
      type: "bold",
    });
    expect(bolded.content).toBe(line);
    expect(bolded.bold).toBe(false);
    expect(bolded.runs?.map((run) => run.text).join("")).toBe(line);
    expect(rangeHas(bolded.runs!, fair, fair + 4, "bold")).toBe(true);
    expect(rangeHas(bolded.runs!, 0, fair, "bold")).toBe(false);
    expect(hasTextRuns(bolded)).toBe(true);

    const colored = styleSelection(bolded, community, community + "community".length, {
      type: "color",
      color: meadow.accent,
    });
    const word = colored.runs!.find((run) => run.text === "community");
    expect(word).toMatchObject({ color: meadow.accent });
    expect(colored.runs!.find((run) => run.text === "fair")).toMatchObject({
      bold: true,
    });
    expect(colored.runs!.find((run) => run.text === "fair")?.color).toBeUndefined();

    const italic = styleSelection(colored, centre, centre + "centre".length, {
      type: "italic",
    });
    const underlined = styleSelection(italic, centre, centre + "centre".length, {
      type: "underline",
    });
    expect(underlined.runs!.find((run) => run.text === "centre")).toMatchObject({
      italic: true,
      underline: true,
    });
    const undone = styleSelection(underlined, centre, centre + "centre".length, {
      type: "underline",
    });
    const centreRun = undone.runs!.find((run) => run.text === "centre");
    expect(centreRun?.underline).toBeUndefined();
    expect(centreRun?.italic).toBe(true);
    expect(plainText(undone.runs!)).toBe(line);
  });

  it("leaves the box on the theme when only some words were formatted", () => {
    const formatted = styleSelection(
      styleSelection(box(), fair, fair + 4, { type: "bold" }),
      community,
      community + "community".length,
      { type: "color", color: meadow.accent },
    );
    const element = { ...box(), ...formatted };
    expect(element.themeOverride).toBeUndefined();
    const themed = applyDeckTheme(
      {
        id: "deck",
        width: 960,
        height: 540,
        slideOrder: ["s1"],
        slides: {
          s1: {
            id: "s1",
            background: { color: meadow.background },
            elements: [element],
          },
        },
        theme: meadow,
      },
      ink,
    ).slides.s1.elements[0];
    expect(themed.themeOverride).toBeFalsy();
    expect(themed.fontFamily).toBe(ink.bodyFont);
    expect(themed.color).toBe(ink.bodyColor);
    expect(themed.runs?.find((run) => run.text === "fair")).toMatchObject({
      bold: true,
    });
    expect(themed.runs?.find((run) => run.text === "community")?.color).toBe(
      meadow.accent,
    );
    expect(themed.runs?.find((run) => run.text.startsWith("Spring"))?.color).toBeUndefined();
    expect(themed.runs?.find((run) => run.text.startsWith("Spring"))?.bold).toBeUndefined();
  });

  it("bolds the whole box, and only that path marks Overrides theme", () => {
    const whole = styleWholeBox(box(), "bold");
    expect(whole).toMatchObject({ bold: true, themeOverride: true });
    expect(whole.runs).toBeUndefined();
    const word = styleSelection(box(), fair, fair + 4, { type: "bold" });
    expect(word.themeOverride).toBeUndefined();
    const cleared = resetToTheme({ ...box(), ...whole }, meadow);
    expect(cleared.themeOverride).toBe(false);
    expect(cleared.bold).toBe(false);
    expect(cleared.runs).toBeUndefined();
    expect(cleared.fontFamily).toBe(meadow.bodyFont);
  });

  it("round-trips runs through the native file", () => {
    const formatted = styleSelection(
      styleSelection(box(), fair, fair + 4, { type: "bold" }),
      community,
      community + "community".length,
      { type: "color", color: "#95d5b2" },
    );
    const file = createFile("slide", "Fundraiser pitch") as SlideFile;
    const slideId = file.content.slideOrder[0];
    file.content.theme = meadow;
    file.content.slides[slideId].elements = [{ ...box(), ...formatted }];
    const opened = parseFile(serializeFile(file)) as SlideFile;
    const saved = opened.content.slides[opened.content.slideOrder[0]].elements[0];
    expect(saved.content).toBe(line);
    expect(saved.runs?.find((run) => run.text === "fair")?.bold).toBe(true);
    expect(saved.runs?.find((run) => run.text === "community")?.color).toBe("#95d5b2");
    expect(textInnerHtml(saved)).toContain('data-bold="1"');
    expect(textInnerHtml(saved)).toContain("data-color=\"#95d5b2\"");
    expect(runsOf(saved).map((run) => run.text).join("")).toBe(line);
  });
});
