import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import type { JsonNode } from "../packages/core/src";
import {
  budgetSentence,
  colorStoryDocx,
  minutesSentence,
} from "./word-color-fixtures";

function textNodes(node: JsonNode): JsonNode[] {
  const out: JsonNode[] = [];
  if (node.type === "text") out.push(node);
  for (const child of node.content ?? []) out.push(...textNodes(child));
  return out;
}

function mark(node: JsonNode | undefined, type: string) {
  return node?.marks?.find((item) => item.type === type);
}

function runsOf(paragraph: string): string[] {
  return [...paragraph.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)].map(
    (match) => match[0],
  );
}

describe("Word font color import", () => {
  it("keeps dark red and bold on one word, leaves the next uncolored, and keeps a yellow highlight", async () => {
    const { file } = await importOffice(
      await colorStoryDocx(),
      "docx",
      "Minutes.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const paragraphs = (file.content.content ?? []).filter(
      (node) => node.type === "paragraph",
    );
    const minutes = paragraphs.find((node) =>
      textNodes(node)
        .map((item) => item.text)
        .join("")
        .includes("urgent"),
    );
    const budget = paragraphs.find((node) =>
      textNodes(node)
        .map((item) => item.text)
        .join("")
        .includes("budget"),
    );
    expect(
      minutes &&
        textNodes(minutes)
          .map((item) => item.text)
          .join(""),
    ).toBe(minutesSentence);
    expect(
      budget &&
        textNodes(budget)
          .map((item) => item.text)
          .join(""),
    ).toBe(budgetSentence);

    const minuteNodes = textNodes(minutes!);
    const vote = minuteNodes.find((node) => node.text?.includes("vote"));
    const urgent = minuteNodes.find((node) => node.text === "urgent");
    const today = minuteNodes.find((node) => node.text?.includes("today"));
    expect(vote?.text).toBe("The vote is ");
    expect(mark(vote, "textStyle")?.attrs?.color).toBeUndefined();
    expect(mark(vote, "bold")).toBeUndefined();
    expect(mark(urgent, "bold")).toEqual({ type: "bold" });
    expect(mark(urgent, "textStyle")?.attrs?.color).toBe("#c00000");
    expect(mark(urgent, "highlight")).toBeUndefined();
    expect(urgent?.text).toBe("urgent");
    expect(today?.text).toBe(" today.");
    expect(mark(today, "textStyle")?.attrs?.color).toBeUndefined();
    expect(mark(today, "bold")).toBeUndefined();

    const budgetNodes = textNodes(budget!);
    const check = budgetNodes.find((node) => node.text?.includes("Check"));
    const shaded = budgetNodes.find((node) => node.text === "budget");
    const board = budgetNodes.find((node) => node.text?.includes("board"));
    expect(check?.text).not.toContain("budget");
    expect(mark(check, "highlight")).toBeUndefined();
    expect(mark(check, "textStyle")?.attrs?.color).toBeUndefined();
    expect(mark(shaded, "highlight")?.attrs?.color).toBe("#ffff00");
    expect(mark(shaded, "textStyle")?.attrs?.color).toBeUndefined();
    expect(mark(shaded, "bold")).toBeUndefined();
    expect(mark(board, "highlight")).toBeUndefined();
    expect(mark(board, "textStyle")?.attrs?.color).toBeUndefined();

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
    const minuteRuns = runsOf(minutesXml ?? "");
    const budgetRuns = runsOf(budgetXml ?? "");
    const urgentRun = minuteRuns.find((item) => item.includes(">urgent<"));
    const todayRun = minuteRuns.find((item) => item.includes("today"));
    const voteRun = minuteRuns.find((item) => item.includes("vote"));
    const budgetRun = budgetRuns.find((item) => item.includes(">budget<"));
    expect(urgentRun?.toLowerCase()).toContain('w:val="c00000"');
    expect(urgentRun?.toLowerCase()).toMatch(/<w:color\b/);
    expect(urgentRun?.toLowerCase()).toMatch(/<w:b(?:\s|>|\/>)/);
    expect(urgentRun).not.toContain("vote");
    expect(urgentRun).not.toContain("today");
    expect(todayRun?.toLowerCase()).not.toMatch(/<w:color\b/);
    expect(todayRun?.toLowerCase()).not.toMatch(/<w:b(?:\s|>|\/>)/);
    expect(voteRun?.toLowerCase()).not.toMatch(/<w:color\b/);
    expect(budgetRun?.toLowerCase()).toContain('w:fill="ffff00"');
    expect(budgetRun?.toLowerCase()).not.toMatch(/<w:color\b/);
    expect(budgetRun?.toLowerCase()).not.toContain("c00000");
    expect(minutesXml).toContain('w:firstLine="720"');
  });
});
