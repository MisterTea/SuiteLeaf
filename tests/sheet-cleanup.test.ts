import { expect, test } from "vitest";

import {
  detectSeparator,
  duplicatePreview,
  highlightMessage,
  looksLikeHeader,
  overwriteWarning,
  planDuplicates,
  removeMessage,
  rowGroups,
  splitColumn,
  splitMessage,
  splitParts,
  trimMessage,
  trimValue,
} from "../apps/web/src/editors/sheet-cleanup";
import { donationRows } from "../storyboards/scenes/donations-q3";

test("trim removes ordinary spaces, tabs, and non-breaking spaces", () => {
  expect(trimValue("  Ada  ")?.text).toBe("Ada");
  expect(trimValue("Ada\tBen")?.text).toBe("Ada Ben");
  expect(trimValue("Ada\u00A0Ben")).toEqual({ text: "Ada Ben", nonBreaking: 1 });
  expect(trimValue("\u00A0Ada\u00A0")).toEqual({ text: "Ada", nonBreaking: 2 });
  expect(trimValue("Ada")).toBeNull();
  expect(trimValue("00123")).toBeNull();
  expect(trimMessage(23, 4, false)).toBe(
    "Trimmed 23 cells (including 4 non-breaking spaces)",
  );
  expect(trimMessage(1, 1, true)).toBe(
    "Trimmed 1 visible cell (including 1 non-breaking space). Hidden rows were left as they are.",
  );
  expect(trimMessage(0, 0, true)).toContain("Hidden rows were left as they are.");
});

test("duplicates can keep the fullest row and ignore hidden rows", () => {
  const rows = [
    ["Email", "Gift"],
    ["ada@x.test", ""],
    ["mei@x.test", "Yes"],
    ["ADA@x.test", "Yes"],
    ["", ""],
  ];
  const fullest = planDuplicates({
    rows,
    startRow: 0,
    header: true,
    keyColumns: [0],
    keep: "filled",
    ignoreCase: true,
  });
  expect(fullest.removeRows).toEqual([1]);
  expect(fullest.remain).toBe(2);
  expect(fullest.preview).toBe("1 duplicate row will be removed, 2 will remain");
  expect(fullest.duplicateRows).toEqual([1, 3]);

  const first = planDuplicates({
    rows,
    startRow: 10,
    header: true,
    keyColumns: [0],
    keep: "first",
    ignoreCase: false,
  });
  expect(first.removeRows).toEqual([]);

  const last = planDuplicates({
    rows,
    startRow: 0,
    header: true,
    keyColumns: [0],
    keep: "last",
    ignoreCase: true,
  });
  expect(last.removeRows).toEqual([1]);

  const hidden = planDuplicates({
    rows,
    startRow: 0,
    header: true,
    keyColumns: [0],
    keep: "filled",
    ignoreCase: true,
    hidden: new Set([3]),
  });
  expect(hidden.removeRows).toEqual([]);
  expect(hidden.preview).toContain("Hidden rows were left as they are.");
  expect(removeMessage(9, 103, false)).toBe("Removed 9 duplicate rows · 103 remain");
  expect(highlightMessage(2, false)).toBe(
    "Highlighted 2 duplicate rows. Nothing was deleted.",
  );
  expect(duplicatePreview(0, 0, false)).toBe("No duplicate rows");
  expect(rowGroups([8, 2, 3, 3, 6])).toEqual([
    [2, 3],
    [6, 6],
    [8, 8],
  ]);
});

test("split keeps leading zeros as text and warns before overwriting", () => {
  expect(detectSeparator(["Okafor, Ade", "Chen, Mei"]).kind).toBe("comma");
  expect(splitParts("Okafor, Ade", ",", true)).toEqual(["Okafor", "Ade"]);
  expect(splitParts("00123,45", ",", false)).toEqual(["00123", "45"]);
  expect(splitColumn(["A;;B", "A;B"], ";", true)).toEqual([
    ["A", "B"],
    ["A", "B"],
  ]);
  expect(overwriteWarning(2, 1)).toBe("Column C isn't empty: insert 1 column?");
  expect(overwriteWarning(2, 2)).toBe("Columns C–D aren't empty: insert 2 columns?");
  expect(splitMessage(112, 2, false)).toBe("Split 112 cells into 2 columns.");
  expect(looksLikeHeader(["Donor", "Email"], ["Okafor, Ade", "ada@x.test"])).toBe(true);
  expect(looksLikeHeader([12, "Email"], ["Okafor", "ada@x.test"])).toBe(false);
});

test("the donations list trims 23 cells and then yields 103 unique donors", () => {
  const rows = donationRows();
  expect(rows).toHaveLength(113);
  let changed = 0;
  let nonBreaking = 0;
  for (let row = 1; row < rows.length; row++) {
    for (const column of [1, 2]) {
      const value = rows[row]![column];
      if (typeof value !== "string") continue;
      const trimmed = trimValue(value);
      if (!trimmed) continue;
      changed++;
      nonBreaking += trimmed.nonBreaking;
      rows[row]![column] = trimmed.text;
    }
  }
  expect(changed).toBe(23);
  expect(nonBreaking).toBe(4);
  expect(trimMessage(changed, nonBreaking, false)).toBe(
    "Trimmed 23 cells (including 4 non-breaking spaces)",
  );

  const split = rows.map((row, index) => {
    if (index === 0) return ["Date", "Last name", "First name", "Email", "Amount", "Gift Aid"];
    const [last, first] = splitParts(String(row[1]), ",", true);
    return [row[0], last, first, row[2], row[3], row[4]];
  });
  expect(split[1]!.slice(1, 3)).toEqual(["Okafor", "Ade"]);
  const plan = planDuplicates({
    rows: split,
    startRow: 0,
    header: true,
    keyColumns: [3],
    keep: "filled",
    ignoreCase: true,
  });
  expect(plan.removeRows).toHaveLength(9);
  expect(plan.remain).toBe(103);
  expect(plan.preview).toBe("9 duplicate rows will be removed, 103 will remain");
  // The sparse earlier receipt is the one removed; the Gift Aid copy stays.
  expect(plan.removeRows).toContain(1);
  expect(plan.removeRows).not.toContain(6);
  expect(split[6]![5]).toBe("Yes");
  expect(split[1]![5]).toBe("");
});
