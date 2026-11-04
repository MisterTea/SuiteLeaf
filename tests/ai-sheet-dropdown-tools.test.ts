// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/web/src/ai/tools/sheet-cells", async (original) => ({
  ...(await original<typeof import("../apps/web/src/ai/tools/sheet-cells")>()),
  wait: () => Promise.resolve(),
}));
vi.mock("../apps/web/src/ai/cursor", () => ({ moveCursor: async () => {} }));

import { startRequest } from "../apps/web/src/ai/guard";
import { sheetToolKit } from "../apps/web/src/ai/tools/sheet-tool-kit";
import { sheetRuleTools } from "../apps/web/src/ai/tools/sheet-rule-tools";
import {
  dropdownMismatchNotes,
  dropdownOptionsFromRule,
  dropdownRequestNotes,
  groupedCells,
  restoreRefusedDropdowns,
  rowsNamed,
} from "../apps/web/src/ai/tools/sheet-dropdown-rules";
import { makeHarness, runTool, valuesOf, type Harness } from "./ai-sheet-harness";

const roster = () =>
  makeHarness([
    {
      name: "Roster",
      rows: [
        ["Name", "Shift", "Status"],
        ["Priya Shah", "Day", "confirmed "],
        ["Ade Okafor", "Night", "yes"],
        ["Nora Berg", "Day", "Tentative"],
        ["Sam Lee", "Evening", "nope"],
      ],
    },
    { name: "Statuses", rows: [["Status"], ["Confirmed"], ["Maybe"], ["Waitlist"]] },
  ]);

let h: Harness;
const run = (args: Record<string, unknown>) => runTool(sheetRuleTools(h.ctx, sheetToolKit(h.ctx)), "set_dropdown", args);
const status = () => valuesOf(h, "C2:C5").map((row) => row[0]);
const statuses = () => h.book.getSheetByName("Statuses")!.getRange("A2:A6").getValues().map((row: unknown[]) => row[0]);
const rules = () => h.sheet().getDataValidations();
const ask = (text: string) => startRequest(text);

beforeEach(() => {
  ask("");
  h = roster();
});

describe("set_dropdown with a fixed list", () => {
  it("installs the list on the header's column, rewrites near matches and fixes, and lists what is left", async () => {
    const text = await run({
      range: "Status",
      options: ["Confirmed", "Maybe", "Waitlist"],
      colors: ["green", "amber", "#123456"],
      fixes: ["yes=Confirmed", "Tentative=Maybe", "zzz=Maybe"],
    });
    expect(text).toBe(
      'Dropdown on C2:C5: Confirmed (green), Maybe (amber), Waitlist (#123456). Other values are rejected. Rewrote 3 cell(s), including capitalisation and surrounding spaces. These rewrites matched no cells: zzz. These cells are still not in the list: "nope" in C5. Call set_dropdown again with the same range, options, and colors, and fixes for each value the user asked to change.',
    );
    expect(status()).toEqual(["Confirmed", "Confirmed", "Maybe", "nope"]);
    const [rule] = rules();
    expect(rule.getCriteriaType()).toBe("list");
    expect(rule.rule.formula1).toBe('["Confirmed","Maybe","Waitlist"]');
    expect(rule.rule.formula2).toBe("#b7e1cd,#ffe599,#123456");
    expect(rule.getRanges()[0].getA1Notation()).toBe("C2:C5");
    expect(h.sheet().getRange("C2").getCellStyleData()?.cl?.rgb).toBe("#111111");
    expect(dropdownMismatchNotes(h.ctx)).toEqual([
      'Some dropdown cells are not in the list (Confirmed, Maybe, Waitlist): "nope" in C5. Update them with set_dropdown on the same range and fixes such as "yes=Confirmed" or "Tentative=Maybe".',
    ]);
  });

  it("skips a header row in the range and allows other values when reject is off", async () => {
    const text = await run({ range: "C1:C9", options: "Confirmed, Maybe", reject: "warn" });
    expect(text).toContain("Dropdown on C2:C5: Confirmed (green), Maybe (amber). Other values are allowed, with a warning. Rewrote 1 cell(s)");
    expect(rules()[0].rule.errorStyle).toBe(2);
  });

  it("finds the Status column inside a wider range, and refuses a wide range without one", async () => {
    expect(await run({ range: "A1:C5", options: ["Confirmed"] })).toContain("Dropdown on C2:C5: Confirmed (green).");
    await expect(run({ range: "A1:B5", options: ["Confirmed"] })).rejects.toThrow(
      "A dropdown goes on one column, not A1:B5. Give a range like C2:C41 or the header Status.",
    );
    await expect(run({ range: "", options: ["Confirmed"] })).rejects.toThrow('Give the cells, for example C2:C41, or the header "Status".');
    await expect(run({ range: "Grade", options: ["A"] })).rejects.toThrow('No column is headed "Grade". Headers: Name, Shift, Status.');
  });

  it("takes the choices, colours and rewrites from the user's own words", async () => {
    ask("Put a dropdown on the Status column. The choices are Confirmed in green, Maybe (amber), Waitlist in blue. Change yes and tbc to Confirmed.");
    const text = await run({ range: "C2:C5", options: ["x"] });
    expect(text).toContain("Dropdown on C2:C5: Confirmed (green), Maybe (amber), Waitlist (blue).");
    expect(status()).toEqual(["Confirmed", "Confirmed", "Tentative", "nope"]);
  });

  it("uses the one column named in the request over the range the model sent", async () => {
    ask("Put a dropdown on the Status column with Confirmed, Maybe.");
    expect(await run({ range: "B2:B5", options: ["Confirmed", "Maybe"] })).toContain("Dropdown on C2:C5");
  });

  it("uses a range the request names when the model only gave a header", async () => {
    ask("Add a dropdown to C2:C3 with Confirmed and Maybe.");
    expect(await run({ range: "Status", options: ["Confirmed", "Maybe"] })).toContain("Dropdown on C2:C3");
  });

  it("sets a person's row by name and does not report a cell it just fixed as still wrong", async () => {
    ask('Set Nora Berg\'s status to Waitlist. Also "Sam Lee=Maybe" and "Tentative=Maybe".');
    const text = await run({ range: "Status", options: ["Confirmed", "Maybe", "Waitlist"], assign: ["Priya Shah=Maybe"] });
    expect(status()).toEqual(["Maybe", "yes", "Waitlist", "Maybe"]);
    expect(text).toContain("Priya Shah is Maybe (C2); Sam Lee is Maybe (C5); Nora Berg is Waitlist (C4).");
    expect(text).toContain('These cells are still not in the list: "yes" in C3.');
    expect(text).not.toContain('"nope"');
  });

  it("sets a person named in a roster sentence, not the words before the name", async () => {
    ask("If Ade Okafor is on the roster, set his status to Waitlist. make sure sam lee is on the list and set her status to Waitlist.");
    const text = await run({ range: "Status", options: ["Confirmed", "Waitlist"] });
    expect(text).toContain("Ade Okafor is Waitlist (C3).");
    expect(status()).toEqual(["Confirmed", "Waitlist", "Tentative", "nope"]);
  });

  it("explains an assignment it cannot make", async () => {
    await expect(run({ range: "Status", options: ["Confirmed", "Maybe"], assign: ["Zed Zee=Maybe"] })).rejects.toThrow(
      'No row is named "Zed Zee". Names start with Name, Priya Shah, Ade Okafor, Nora Berg, Sam Lee.',
    );
    await expect(run({ range: "Status", options: ["Confirmed", "Maybe"], assign: ["Priya Shah=Boss"] })).rejects.toThrow(
      '"Boss" is not a dropdown option (Confirmed, Maybe).',
    );
    await expect(run({ range: "Status", options: ["Confirmed"], fixes: ["yes=Nope"] })).rejects.toThrow(
      '"Nope" is not a dropdown option (Confirmed).',
    );
    const tools = sheetRuleTools(h.ctx, sheetToolKit(h.ctx));
    const dropdown = tools.find((item) => item.name === "set_dropdown")!;
    await expect(dropdown.execute({ range: "Status", options: ["Confirmed"], fixes: ["nonsense"] } as never)).rejects.toThrow(
      'Could not read the rewrite "nonsense".',
    );
    await expect(dropdown.execute({ range: "Status", options: ["Confirmed"], assign: ["Priya"] } as never)).rejects.toThrow(
      'Could not read "Priya". Write it as "Priya Shah=Waitlist".',
    );
    await expect(dropdown.execute({ range: "Status", options: ["A,B"] } as never)).rejects.toThrow("An option can't contain a comma.");
  });

  it("keeps several choices per cell, dropping tokens that are not options", async () => {
    h.sheet().getRange("B4").setValue("day, Boss");
    const text = await run({ range: "B2:B5", options: ["Day", "Night"], multiple: "yes", assign: ["Sam Lee=Day and Night and Boss"] });
    expect(valuesOf(h, "B2:B5").map((row) => row[0])).toEqual(["Day", "Night", "Day", "Day, Night"]);
    expect(text).toContain("More than one choice is allowed. Rewrote 2 cell(s)");
    expect(text).toContain('Sam Lee is Day, Night (B5). Refused "Boss"; that text was not stored. Every cell in the dropdown is one of those options.');
    expect(rules()[0].getCriteriaType()).toBe("listMultiple");
  });

  it("leaves a multiple-choice cell with no option in it, and skips an assignment with none", async () => {
    const text = await run({ range: "B2:B5", options: ["Day", "Night"], multiple: true, assign: ["Sam Lee=Boss"] });
    expect(text).toContain('Refused "Boss"');
    expect(text).toContain('These cells are still not in the list: "Evening" in B5.');
  });

  it("needs options, or reuses the list already on the cells", async () => {
    await expect(run({ range: "Status" })).rejects.toThrow('Give at least one option, for example ["Confirmed", "Maybe", "Can\'t make it"].');
    const multi = h.api.newDataValidation().requireValueInList(["Confirmed", "Maybe"], true).build();
    h.sheet().getRange("C2:C5").setDataValidation(multi);
    const text = await run({ range: "Status" });
    expect(text).toContain("Dropdown on C2:C5: Confirmed (green), Maybe (amber).");
    expect(text).toContain("More than one choice is allowed.");
  });
});

describe("set_dropdown from a source range", () => {
  it("reads the source cells and keeps a named colour with its name", async () => {
    const text = await run({ range: "Status", source: "Statuses!A2:A4", colors: ["Maybe=red"] });
    expect(text).toBe(
      "Dropdown on C2:C5 reads Statuses!A2:A4: Confirmed (green), Maybe (red), Waitlist (amber). Other values are rejected. Colours stay with each name. Rewrote 1 cell(s).",
    );
    const [rule] = rules();
    expect(rule.rule.formula1).toBe("=Statuses!$A$2:$A$4");
    const meta = rule.rule.bizInfo as { suiteleafDropdown?: { colors: Record<string, string> } } | undefined;
    expect(meta?.suiteleafDropdown?.colors).toEqual({ Confirmed: "#b7e1cd", Maybe: "#f4cccc", Waitlist: "#ffe599" });
    expect(dropdownMismatchNotes(h.ctx)[0]).toContain(
      'Some dropdown cells are not in the source list (Confirmed, Maybe, Waitlist): "yes" in C3; "Tentative" in C4; "nope" in C5. Update them with set_dropdown on the same range and the same source.',
    );
  });

  it("adds a value under the source, with colours given in order", async () => {
    const text = await run({ range: "Status", source: "Statuses!A2:A4", add: "Training", colors: ["green", "amber", "grey", "purple"] });
    expect(text).toContain("reads Statuses!A2:A5: Confirmed (green), Maybe (amber), Waitlist (grey), Training (purple).");
    expect(statuses()).toEqual(["Confirmed", "Maybe", "Waitlist", "Training", null]);
  });

  it("renames a source cell and the cells that used it, keeping its colour", async () => {
    h.sheet().getRange("C3").setValue("Maybe");
    const text = await run({ range: "Status", source: "Statuses!A2:A4", rename_source: "Maybe=Perhaps" });
    expect(text).toContain("Confirmed (green), Perhaps (amber), Waitlist (grey).");
    expect(status()).toEqual(["Confirmed", "Perhaps", "Tentative", "nope"]);
    expect(statuses()[1]).toBe("Perhaps");
  });

  it("renames from a quoted pair in the request", async () => {
    ask('Rename "Maybe=Perhaps" in the list.');
    await run({ range: "Status", source: "Statuses!A2:A4" });
    expect(statuses()[1]).toBe("Perhaps");
  });

  it("inserts a blank row inside the source and leaves it out of the options", async () => {
    const text = await run({ range: "Status", source: "Statuses!A2:A4", insert_blank: true, assign: ["Ade Okafor=Waitlist"] });
    expect(text).toContain("reads Statuses!A2:A5: Confirmed (green), Maybe (amber), Waitlist (grey).");
    expect(text).toContain("Ade Okafor is Waitlist (C3). A blank cell in the source is not an option.");
    expect(statuses()).toEqual(["Confirmed", null, "Maybe", "Waitlist", null]);
  });

  it("follows the source written in the user's sentence for this range", async () => {
    ask("Put a dropdown on C2:C5 from Statuses!A2:A4. Allow more than one.");
    const text = await run({ range: "Status", options: ["x"] });
    expect(text).toContain("Dropdown on C2:C5 reads Statuses!A2:A4: Confirmed (green), Maybe (amber), Waitlist (grey).");
  });

  it("keeps using the source already on the cells, and grows it with an add", async () => {
    await run({ range: "Status", source: "Statuses!A2:A4" });
    expect(await run({ range: "Status", assign: ["Priya Shah=Waitlist"] })).toContain("Priya Shah is Waitlist (C2).");
    const grown = await run({ range: "Status", source: "Statuses!A2:A3", add: "Training" });
    expect(grown).toContain("reads Statuses!A2:A5: Confirmed (green), Maybe (amber), Waitlist (grey), Training (blue).");
    const again = await run({ range: "Status", add: "Late", colors: ["red"] });
    expect(again).toContain("reads Statuses!A2:A6:");
    expect(again).toContain("Late (red)");
  });

  it("offers a name typed just under the source as an option", async () => {
    await run({ range: "Status", source: "Statuses!A2:A4" });
    h.book.getSheetByName("Statuses")!.getRange("A5").setValue("Training");
    const options = dropdownOptionsFromRule(h.book, rules()[0]).map((option) => option.label);
    expect(options).toEqual(["Confirmed", "Maybe", "Waitlist", "Training"]);
  });

  it("refuses a token that is not in the source, and reports cells still outside it", async () => {
    ask('"Sam Lee=Confirmed and Maybe"');
    h.sheet().getRange("C3").setValue("confirmed, maybe, zz");
    const text = await run({ range: "Status", source: "Statuses!A2:A4", multiple: true, assign: ["Priya Shah=Boss"] });
    expect(text).toContain('Sam Lee is Confirmed, Maybe (C5). Refused "Boss"; that text was not stored.');
    expect(dropdownMismatchNotes(h.ctx)[0]).toContain('"zz" in C3; "Tentative" in C4');
  });

  it("refuses a single-choice assignment that is not an option and still makes the others", async () => {
    const text = await run({ range: "Status", source: "Statuses!A2:A4", assign: ["Priya Shah=Boss", "Ade Okafor=Maybe"] });
    expect(text).toContain('Ade Okafor is Maybe (C3). Refused "Boss"; that text was not stored.');
  });

  it("explains a source it cannot use", async () => {
    await expect(run({ range: "Status", add: "x" })).rejects.toThrow('Give source, for example "Statuses!A2:A5".');
    await expect(run({ range: "Status", source: "nonsense" })).rejects.toThrow('"nonsense" is not a range like Statuses!A2:A5.');
    await expect(run({ range: "Status", source: "Gone!A2:A4" })).rejects.toThrow("No sheet named Gone.");
    await expect(run({ range: "Status", source: "Statuses!D2:D4" })).rejects.toThrow("That range has no values. Blank cells are skipped.");
    await expect(run({ range: "Status", source: "Statuses!A2:A4", rename_source: "Nope=Perhaps" })).rejects.toThrow(
      'The source range has no cell saying "Nope".',
    );
    await expect(run({ range: "Status", source: "Statuses!A2:A4", rename_source: "Nope" })).rejects.toThrow(
      'Could not read the rename "Nope". Write it as Maybe=Perhaps.',
    );
    await expect(run({ range: "Status", source: "Statuses!A2:A2", insert_blank: true })).rejects.toThrow(
      "That source range is too short for a blank inside it.",
    );
    await expect(run({ range: "Status", source: "Statuses!A2:A4", assign: ["Zed Zee=Maybe"] })).rejects.toThrow('No row is named "Zed Zee".');
    await expect(run({ range: "Status", source: "Statuses!A2:A4", assign: ["Zed"] })).rejects.toThrow('Could not read "Zed".');
  });
});

describe("dropdown checks after a request", () => {
  it("asks for a rename the user quoted that a fixed list still lacks", async () => {
    ask('"yes=Confirmed" "Priya Shah=Waitlist" "Tentative=Perhaps"');
    await run({ range: "Status", options: ["Confirmed", "Maybe", "Waitlist", "Tentative"], fixes: ["yes=Maybe"] });
    expect(status()).toEqual(["Waitlist", "Maybe", "Tentative", "nope"]);
    expect(dropdownRequestNotes(h.ctx)).toEqual([
      'C2:C5 still has "Tentative". Call set_dropdown on C2:C5 with options ["Confirmed","Maybe","Waitlist","Perhaps"] and fixes ["Tentative=Perhaps"].',
    ]);
  });

  it("asks for a fix onto an existing option and a person's row that is still wrong", async () => {
    await run({ range: "Status", options: ["Confirmed", "Maybe", "Waitlist"] });
    ask('"yes=Confirmed" "Priya Shah=Waitlist" "Ade Okafor=Boss"');
    expect(dropdownRequestNotes(h.ctx)).toEqual([
      'C2:C5 still has "yes". Call set_dropdown on C2:C5 with the same options and fixes ["yes=Confirmed"].',
      'Priya Shah should be Waitlist in C2:C5 (C2 is "Confirmed"). Call set_dropdown on C2:C5 with assign ["Priya Shah=Waitlist"].',
    ]);
  });

  it("asks for a source rename the user quoted", async () => {
    h.sheet().getRange("C3").setValue("Maybe");
    await run({ range: "Status", source: "Statuses!A2:A4", rename_source: "Waitlist=Later" });
    ask('"Maybe=Perhaps"');
    expect(dropdownRequestNotes(h.ctx)).toEqual([
      'C2:C5 still has "Maybe". Call set_dropdown on C2:C5 with source "Statuses!A2:A4" and rename_source "Maybe=Perhaps".',
    ]);
  });

  it("checks a multiple-choice person row for each missing choice", async () => {
    await run({ range: "B2:B5", options: ["Day", "Night"], multiple: true });
    ask('"Nora Berg=Day and Night"');
    expect(dropdownRequestNotes(h.ctx)).toEqual([
      'Nora Berg should be Day, Night in B2:B5 (B4 is "Day"). Call set_dropdown on B2:B5 with assign ["Nora Berg=Day and Night"].',
    ]);
    h.sheet().getRange("B3").setValue("Night, Boss");
    expect(dropdownMismatchNotes(h.ctx)).toEqual([
      'Some dropdown cells are not in the list (Day, Night): "Boss" in B3; "Evening" in B5. Update them with set_dropdown on the same range and fixes such as "yes=Confirmed" or "Tentative=Maybe".',
    ]);
  });

  it("has nothing to say without a dropdown or a quoted request", () => {
    expect(dropdownRequestNotes(h.ctx)).toEqual([]);
    ask('"yes=Confirmed"');
    expect(dropdownRequestNotes(h.ctx)).toEqual([]);
    expect(dropdownMismatchNotes(h.ctx)).toEqual([]);
  });

  it("reads colours an Excel file stored beside a list from a range", () => {
    const rule = h.api.newDataValidation().requireValueInList(["x"]).build();
    rule.rule.formula1 = "=Statuses!$A$2:$A$4";
    rule.rule.formula2 = "#ff0000,#00ff00,#0000ff";
    h.sheet().getRange("C2:C5").setDataValidation(rule);
    expect(dropdownOptionsFromRule(h.book, rules()[0]).map((option) => [option.label, option.color])).toEqual([
      ["Confirmed", "#ff0000"],
      ["Maybe", "#00ff00"],
      ["Waitlist", "#0000ff"],
    ]);
  });

  it("puts back values a rejecting dropdown refuses, including tokens in a multiple-choice cell", async () => {
    await run({ range: "B2:B5", options: ["Day", "Night"], multiple: true });
    h.sheet().getRange("B2").setValue("Day, Boss");
    h.sheet().getRange("B3").setValue("=1");
    h.sheet().getRange("A2").setValue("Anyone");
    const notes = restoreRefusedDropdowns(h.book, h.sheet(), new Map<string, unknown>([["1:1", "Day"], ["2:1", "Night"], ["1:0", "Priya Shah"]]));
    expect(notes).toEqual(['B2 refused "Boss". Choose Day, Night. The cell was not changed to that.']);
    expect(valuesOf(h, "A2:B2")).toEqual([["Anyone", "Day"]]);
  });
});

describe("dropdown helpers", () => {
  it("finds rows by a person's name, including a first name and surname in separate words", () => {
    expect(rowsNamed(h.sheet(), "Priya", 2)).toEqual([1]);
    expect(rowsNamed(h.sheet(), "priya shah", 2)).toEqual([1]);
    expect(rowsNamed(h.sheet(), "Day", 2)).toEqual([1, 3]);
    expect(rowsNamed(h.sheet(), " ", 2)).toEqual([]);
  });

  it("groups cells by the text they hold, shortening long lists", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ text: "yes", cell: `C${i + 2}` }));
    expect(groupedCells([...many, { text: "no", cell: "D2" }])).toBe('"yes" in C2, C3, C4, C5, C6, C7, C8, C9, +2 more; "no" in D2');
  });
});
