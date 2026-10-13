import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import type { JsonNode } from "../packages/core/src";
import {
  boardSentence,
  budgetSentence,
  fontNameDocx,
  fontStoryDocx,
  fridaySentence,
  minutesSentence,
} from "./word-font-fixtures";

function textNodes(node: JsonNode): JsonNode[] {
  const out: JsonNode[] = [];
  if (node.type === "text") out.push(node);
  for (const child of node.content ?? []) out.push(...textNodes(child));
  return out;
}

function mark(node: JsonNode | undefined, type: string) {
  return node?.marks?.find((item) => item.type === type);
}

function paragraphText(node: JsonNode | undefined): string {
  return textNodes(node ?? { type: "paragraph" })
    .map((item) => item.text)
    .join("");
}

function runsOf(paragraph: string): string[] {
  return [...paragraph.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)].map(
    (match) => match[0],
  );
}

describe("Word font import", () => {
  it("keeps Georgia and bold on one word, leaves the next in the body font, and keeps color, size, highlight, and indent", async () => {
    const { file } = await importOffice(
      await fontStoryDocx(),
      "docx",
      "Minutes.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const paragraphs = (file.content.content ?? []).filter(
      (node) => node.type === "paragraph",
    );
    const minutes = paragraphs.find((node) =>
      paragraphText(node).includes("urgent"),
    );
    const budget = paragraphs.find((node) =>
      paragraphText(node).includes("budget"),
    );
    const board = paragraphs.find((node) =>
      paragraphText(node).includes("board"),
    );
    const friday = paragraphs.find((node) =>
      paragraphText(node).includes("Friday"),
    );
    expect(paragraphText(minutes)).toBe(minutesSentence);
    expect(paragraphText(budget)).toBe(budgetSentence);
    expect(paragraphText(board)).toBe(boardSentence);
    expect(paragraphText(friday)).toBe(fridaySentence);

    const minuteNodes = textNodes(minutes!);
    const vote = minuteNodes.find((node) => node.text?.includes("vote"));
    const urgent = minuteNodes.find((node) => node.text === "urgent");
    const today = minuteNodes.find((node) => node.text?.includes("today"));
    expect(vote?.text).toBe("The vote is ");
    expect(mark(vote, "textStyle")?.attrs?.fontFamily).toBeUndefined();
    expect(mark(vote, "bold")).toBeUndefined();
    expect(mark(urgent, "bold")).toEqual({ type: "bold" });
    expect(mark(urgent, "textStyle")?.attrs?.fontFamily).toBe("Georgia");
    expect(mark(urgent, "textStyle")?.attrs?.color).toBeUndefined();
    expect(mark(urgent, "textStyle")?.attrs?.fontSize).toBeUndefined();
    expect(mark(urgent, "highlight")).toBeUndefined();
    expect(urgent?.text).toBe("urgent");
    expect(today?.text).toBe(" today.");
    expect(mark(today, "textStyle")?.attrs?.fontFamily).toBeUndefined();
    expect(mark(today, "bold")).toBeUndefined();

    const budgetNodes = textNodes(budget!);
    const colored = budgetNodes.find((node) => node.text === "budget");
    const due = budgetNodes.find((node) => node.text?.includes("due"));
    expect(mark(colored, "textStyle")?.attrs?.color).toBe("#c00000");
    expect(mark(colored, "textStyle")?.attrs?.fontFamily).toBeUndefined();
    expect(mark(colored, "textStyle")?.attrs?.fontSize).toBeUndefined();
    expect(mark(colored, "bold")).toBeUndefined();
    expect(mark(colored, "highlight")).toBeUndefined();
    expect(mark(due, "textStyle")?.attrs?.fontFamily).toBeUndefined();

    const boardNodes = textNodes(board!);
    const shaded = boardNodes.find((node) => node.text === "board");
    expect(mark(shaded, "highlight")?.attrs?.color).toBe("#ffff00");
    expect(mark(shaded, "textStyle")?.attrs?.fontFamily).toBeUndefined();
    expect(mark(shaded, "textStyle")?.attrs?.color).toBeUndefined();
    expect(mark(shaded, "textStyle")?.attrs?.fontSize).toBeUndefined();

    const fridayNodes = textNodes(friday!);
    const sized = fridayNodes.find((node) => node.text === "Friday");
    const tail = fridayNodes.find((node) => node.text?.includes("set"));
    expect(mark(sized, "textStyle")?.attrs?.fontSize).toBe("18pt");
    expect(mark(sized, "textStyle")?.attrs?.fontFamily).toBeUndefined();
    expect(mark(sized, "textStyle")?.attrs?.color).toBeUndefined();
    expect(mark(tail, "textStyle")?.attrs?.fontFamily).toBeUndefined();
    expect(mark(tail, "textStyle")?.attrs?.fontSize).toBeUndefined();

    expect(minutes?.attrs).toMatchObject({
      firstLineIndent: 0.5,
      lineSpacing: "1.5",
      spaceBefore: 12,
      spaceAfter: 6,
    });
    expect(budget?.attrs?.firstLineIndent).toBeUndefined();

    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    const exported = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(
      (match) => match[0],
    );
    const minutesXml = exported.find((item) => item.includes("urgent"));
    const budgetXml = exported.find((item) => item.includes("budget"));
    const boardXml = exported.find((item) => item.includes("board"));
    const fridayXml = exported.find((item) => item.includes("Friday"));
    const minuteRuns = runsOf(minutesXml ?? "");
    const urgentRun = minuteRuns.find((item) => item.includes(">urgent<"));
    const todayRun = minuteRuns.find((item) => item.includes("today"));
    const voteRun = minuteRuns.find((item) => item.includes("vote"));
    const budgetRun = runsOf(budgetXml ?? "").find((item) =>
      item.includes(">budget<"),
    );
    const boardRun = runsOf(boardXml ?? "").find((item) =>
      item.includes(">board<"),
    );
    const fridayRun = runsOf(fridayXml ?? "").find((item) =>
      item.includes(">Friday<"),
    );
    expect(urgentRun).toContain('w:ascii="Georgia"');
    expect(urgentRun?.toLowerCase()).toMatch(/<w:b(?:\s|>|\/>)/);
    expect(urgentRun?.toLowerCase()).not.toMatch(/<w:color\b/);
    expect(urgentRun).not.toMatch(/<w:sz\b/);
    expect(urgentRun).not.toContain("vote");
    expect(urgentRun).not.toContain("today");
    expect(todayRun).not.toMatch(/<w:rFonts\b/);
    expect(todayRun?.toLowerCase()).not.toMatch(/<w:b(?:\s|>|\/>)/);
    expect(voteRun).not.toMatch(/<w:rFonts\b/);
    expect(budgetRun?.toLowerCase()).toContain('w:val="c00000"');
    expect(budgetRun).not.toMatch(/<w:rFonts\b/);
    expect(boardRun?.toLowerCase()).toContain('w:fill="ffff00"');
    expect(boardRun).not.toMatch(/<w:rFonts\b/);
    expect(fridayRun).toMatch(/<w:sz\b[^>]*w:val="36"/);
    expect(fridayRun).not.toMatch(/<w:rFonts\b/);
    expect(minutesXml).toContain('w:firstLine="720"');
  });

  it("uses w:hAnsi when w:ascii is absent, ignores a theme font with no name, and lets w:ascii win", async () => {
    const { file } = await importOffice(
      await fontNameDocx(),
      "docx",
      "Names.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const nodes = textNodes(file.content);
    const calibri = nodes.find((node) => node.text === "Calibri");
    const theme = nodes.find((node) => node.text === "theme");
    const wins = nodes.find((node) => node.text === "wins");
    expect(mark(calibri, "textStyle")?.attrs?.fontFamily).toBe("Calibri");
    expect(mark(theme, "textStyle")?.attrs?.fontFamily).toBeUndefined();
    expect(mark(wins, "textStyle")?.attrs?.fontFamily).toBe("Georgia");
    expect(
      nodes
        .filter((node) => node.text !== "Calibri" && node.text !== "wins")
        .every((node) => mark(node, "textStyle")?.attrs?.fontFamily == null),
    ).toBe(true);
  });
});
