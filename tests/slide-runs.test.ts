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
import { hasTextRuns, plainText, runsOf, runsToHtml, textInnerHtml } from "../apps/web/src/editors/slide-runs";
import { rangeHas, styleSelection, styleWholeBox } from "../apps/web/src/editors/slide-run-format";

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
    const hung = textInnerHtml({
      runs: [
        { text: "• Parent", paraMargin: 8, paraHang: 6 },
        { text: "\n", paragraphBreak: true, paraMargin: 24, paraHang: 6, spaceBefore: 4 },
        { text: "○ Child" },
      ],
    });
    expect(hung).toContain("padding-left:calc(30px * var(--canvas-fit, 1))");
    expect(hung).toContain("text-indent:calc(-6px * var(--canvas-fit, 1))");
    expect(hung).not.toContain("hanging");
    expect(textInnerHtml({
      runs: [
        { text: "Left" },
        { text: "\n", paragraphBreak: true },
        { text: "\n", paragraphBreak: true, paraAlign: "center" },
        { text: "Callout" },
      ],
    })).toContain('text-align:center');
    expect(textInnerHtml({
      runs: [
        { text: "Left" },
        { text: "\n", paragraphBreak: true },
        { text: "\n", paragraphBreak: true, paraAlign: "center" },
        { text: "Callout" },
      ],
    })).toContain("<br>");
    expect(textInnerHtml({
      runs: [{ text: "DA", color: "#ff0000", stroke: "#0000ff", strokeWidth: 1 }],
    })).toContain("-webkit-text-stroke:");
    expect(textInnerHtml({
      runs: [
        { text: "Ø ", font: "SuiteLeaf Sprig", paraHang: 27 },
        { text: "Advance" },
        { text: "\n", paragraphBreak: true, paraHang: 27 },
        { text: "Ø ", font: "SuiteLeaf Sprig" },
        { text: "Beyond" },
      ],
    })).toMatch(/slide-bullet-slot/g);
    expect((textInnerHtml({
      runs: [
        { text: "Ø ", font: "SuiteLeaf Sprig", paraHang: 27 },
        { text: "Advance" },
        { text: "\n", paragraphBreak: true, paraHang: 27 },
        { text: "Ø ", font: "SuiteLeaf Sprig" },
        { text: "Beyond" },
      ],
    }).match(/slide-bullet-slot/g) ?? []).length).toBe(2);
    expect(textInnerHtml({
      runs: [
        { text: "Ø ", font: "SuiteLeaf Sprig", paraHang: 27 },
        { text: "Advance" },
      ],
    })).toMatch(/font-size:0/);
    expect(textInnerHtml({
      runs: [{ text: "Ø ", font: "SuiteLeaf Sprig" }, { text: "Advance" }],
    })).not.toContain("slide-bullet-slot");
    expect(textInnerHtml({
      hang: 27,
      runs: [{ text: "n ", font: "SuiteLeaf Sprig" }, { text: "Next" }],
    })).toContain("slide-bullet-slot");
    const editingBullet = runsToHtml(runsOf({ content: "• Early 2000s" }), undefined, 18);
    expect(editingBullet).toContain("slide-bullet-fixed");
    expect(editingBullet).toContain('contenteditable="false"');
    expect(editingBullet).toContain("Early 2000s");
    expect(editingBullet.indexOf("slide-bullet-fixed")).toBeLessThan(editingBullet.indexOf("Early 2000s"));
    const plainBullet = textInnerHtml({
      runs: [
        { text: "● ", color: "#002F56", paraHang: 36 },
        { text: "Management" },
      ],
    });
    expect(plainBullet).toContain("slide-bullet-slot");
    expect(plainBullet).toContain("min-width:calc(36px * var(--canvas-fit, 1))");
    expect(plainBullet).toContain("text-indent:0");
    expect(plainBullet.indexOf("slide-bullet-slot")).toBeLessThan(plainBullet.indexOf("Management"));
    const officeList = textInnerHtml({
      runs: [
        { text: "▪ ", color: "#333399", paraHang: 27 },
        { text: "Welcome" },
        { text: "\n", paragraphBreak: true, paraHang: 27, spaceBefore: 7.5 },
        { text: "▪ ", color: "#333399" },
        { text: "Goal" },
        { text: "\n", paragraphBreak: true, paraHang: 27, paraMargin: 13.5, spaceBefore: 7.5 },
        { text: "▪ ", color: "#333399" },
        { text: "Increase" },
      ],
    });
    expect(officeList).not.toContain("slide-bullet-fixed");
    expect(officeList.match(/slide-bullet-slot/g)?.length).toBe(3);
    expect(officeList.match(/min-width:calc\(27px \* var\(--canvas-fit, 1\)\)/g)?.length).toBe(3);
    expect(textInnerHtml(saved)).toContain('data-bold="1"');
    expect(textInnerHtml(saved)).toContain("data-color=\"#95d5b2\"");
    expect(runsOf(saved).map((run) => run.text).join("")).toBe(line);
  });

  it("sizes each paragraph's line box from its own size, without rounding", () => {
    const html = textInnerHtml({
      fontSize: 48,
      lineHeight: 0.97656,
      runs: [
        { text: "Line", fontSize: 48 },
        { text: "\n", paragraphBreak: true, fontSize: 32, paraLine: 1.09863 },
        { text: "Next", fontSize: 32 },
      ],
    });
    expect(html).toContain("line-height:calc(48 * var(--slide-pt, 1) * 0.97656 * 1px)");
    expect(html).toContain("line-height:calc(32 * var(--slide-pt, 1) * 1.09863 * 1px)");
    expect(html).not.toContain("round(nearest");
    const blank = textInnerHtml({
      lineHeight: 1.2207,
      runs: [
        { text: "Above", fontSize: 24 },
        { text: "\n", paragraphBreak: true, fontSize: 14 },
        { text: "\n", paragraphBreak: true, fontSize: 24 },
        { text: "Below", fontSize: 24 },
      ],
    });
    const blankParas = blank.split('class="slide-para"').slice(1);
    expect(blankParas[1]).toContain("<br>");
    expect(blankParas[1]).toContain("calc(14 * var(--slide-pt, 1)");
  });
});
