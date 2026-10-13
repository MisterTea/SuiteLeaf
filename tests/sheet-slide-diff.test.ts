import { describe, expect, it } from "vitest";
import { diffSheets, diffSlides } from "@suiteleaf/core";
import {
  ROSTER_EARLIER,
  ROSTER_MORNING,
  ROSTER_NAMES,
  ROSTER_YESTERDAY,
  deckFile,
  rosterFile,
} from "./compare-fixtures";

const when = "2026-10-12T14:00:00.000Z";
const rosterId = "roster-file";

function changeAt(
  diff: ReturnType<typeof diffSheets>,
  row: number,
  column: number,
) {
  return diff.sheets[0].changes.find((change) => change.row === row && change.column === column);
}

describe("spreadsheet version diff", () => {
  const earlier = rosterFile(rosterId, when, ROSTER_EARLIER, false);
  const yesterday = rosterFile(rosterId, when, ROSTER_YESTERDAY, false);
  const morning = rosterFile(rosterId, when, ROSTER_MORNING, true);

  it("marks six status edits and the bold header against the current roster", () => {
    const diff = diffSheets(yesterday.content.workbook, morning.content.workbook);
    expect(diff.changedCells).toBe(8);
    expect(diff.sheets[0].rows).toBe(8);
    for (let row = 1; row <= 6; row++) {
      const change = changeAt(diff, row, 1);
      expect(change?.kind).toBe("value");
      expect(change?.beforeText).toBe(ROSTER_YESTERDAY[row - 1]);
      expect(change?.afterText).toBe(ROSTER_MORNING[row - 1]);
    }
    expect(changeAt(diff, 7, 1)).toBeUndefined();
    expect(diff.sheets[0].plain.some((cell) => cell.look.text === "Noah")).toBe(true);
    expect(diff.sheets[0].plain.some((cell) => cell.look.text === "Confirmed")).toBe(true);
    for (const column of [0, 1]) {
      const header = changeAt(diff, 0, column);
      expect(header?.kind).toBe("format");
      expect(header?.notes).toContain("Bold");
      expect(header?.after.bold).toBe(true);
      expect(header?.before.bold).toBe(false);
    }
    ROSTER_NAMES.forEach((name) => {
      expect(diff.sheets[0].changes.some((change) => change.beforeText === name)).toBe(false);
    });
  });

  it("compares a version with the one before it, without the later bold", () => {
    const diff = diffSheets(earlier.content.workbook, yesterday.content.workbook);
    expect(diff.changedCells).toBe(6);
    expect(diff.sheets[0].changes.every((change) => change.kind === "value")).toBe(true);
    expect(changeAt(diff, 1, 1)?.beforeText).toBe("Invited");
    expect(changeAt(diff, 1, 1)?.afterText).toBe("Maybe");
    expect(changeAt(diff, 0, 0)).toBeUndefined();
    expect(changeAt(diff, 7, 1)).toBeUndefined();
  });

  it("treats a named style the same as the same style written on the cell", () => {
    const named = structuredClone(morning.content.workbook);
    named.styles = { header: { bl: 1 } };
    const sheet = named.sheets[named.sheetOrder[0]];
    sheet.cellData[0][0].s = "header";
    sheet.cellData[0][1].s = "header";
    const diff = diffSheets(named, morning.content.workbook);
    expect(diff.changedCells).toBe(0);
  });

  it("marks a formula result that changed while the formula stayed", () => {
    const before = rosterFile(rosterId, when, ROSTER_YESTERDAY, false);
    const after = rosterFile(rosterId, when, ROSTER_YESTERDAY, false);
    const sheetId = before.content.workbook.sheetOrder[0];
    before.content.workbook.sheets[sheetId].cellData[1][1] = { f: "=1+1", v: 2 };
    after.content.workbook.sheets[sheetId].cellData[1][1] = { f: "=1+1", v: 3 };
    const diff = diffSheets(before.content.workbook, after.content.workbook);
    const change = changeAt(diff, 1, 1);
    expect(change?.kind).toBe("value");
    expect(change?.beforeText).toBe("2");
    expect(change?.afterText).toBe("3");
  });
});

describe("slide version diff", () => {
  const older = deckFile("deck", when, "Fundraiser pitch", true);
  const current = deckFile("deck", when, "Spring fair", false);

  it("marks the rewritten title and the deleted thank-you slide", () => {
    const diff = diffSlides(older.content, current.content);
    expect(diff.changedSlides).toBe(2);
    const title = diff.slides.find((slide) => slide.id === "slide-title");
    const plan = diff.slides.find((slide) => slide.id === "slide-plan");
    const thanks = diff.slides.find((slide) => slide.id === "slide-thanks");
    expect(title?.status).toBe("changed");
    expect(plan?.status).toBe("same");
    expect(thanks?.status).toBe("removed");
    const runs = title?.elements.find((el) => el.id === "el-title")?.runs ?? [];
    expect(runs).toEqual([
      { text: "Fundraiser pitch", mark: "del" },
      { text: "Spring fair", mark: "add" },
    ]);
    expect(thanks?.elements.some((el) => el.runs.some((run) => run.text === "Thank you" && run.mark === "del"))).toBe(true);
    expect(diff.slides.map((slide) => slide.id)).toEqual(["slide-title", "slide-plan", "slide-thanks"]);
  });

  it("marks a slide that exists only in the newer deck", () => {
    const diff = diffSlides(current.content, older.content);
    const thanks = diff.slides.find((slide) => slide.id === "slide-thanks");
    expect(thanks?.status).toBe("added");
    expect(diff.changedSlides).toBe(2);
  });
});
