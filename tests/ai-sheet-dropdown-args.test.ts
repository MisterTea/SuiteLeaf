import { beforeEach, describe, expect, it } from "vitest";
import { startRequest } from "../apps/web/src/ai/guard";
import {
  assignsFromRequest,
  choicesFromRequest,
  concreteInSentence,
  dropdownColor,
  dropdownColorName,
  isPersonName,
  multipleInSentence,
  namedColorMap,
  normalizeDropdownArgs,
  parseRewrite,
  quotedPairs,
  rewritesFromRequest,
  sentenceForCall,
  sourceInSentence,
  splitChoices,
} from "../apps/web/src/ai/tools/sheet-dropdown-args";

const options = [{ label: "Confirmed" }, { label: "Maybe" }, { label: "Waitlist" }];

beforeEach(() => startRequest(""));

describe("dropdown colours", () => {
  it("reads hex codes, colour names and words that contain them, else uses the palette in order", () => {
    expect(dropdownColor("#A1B2C3", 0)).toBe("#a1b2c3");
    expect(dropdownColor("Amber", 0)).toBe("#ffe599");
    expect(dropdownColor("light green", 3)).toBe("#b7e1cd");
    expect(dropdownColor("teal", 1)).toBe("#ffe599");
    expect(dropdownColor(undefined, 6)).toBe("#b7e1cd");
    expect(dropdownColorName("#F4CCCC")).toBe("red");
    expect(dropdownColorName("#123456")).toBe("#123456");
  });

  it("pins colours to names only when every pair names a colour", () => {
    expect([...namedColorMap(["Maybe=amber", "Waitlist = #c9daf8"])!]).toEqual([
      ["maybe", "#ffe599"],
      ["waitlist", "#c9daf8"],
    ]);
    expect(namedColorMap(["green", "amber"])).toBeNull();
    expect(namedColorMap(["Maybe=Perhaps"])).toBeNull();
    expect(namedColorMap([])).toBeNull();
  });
});

describe("reading the user's words", () => {
  it("tells person names from single words", () => {
    expect(isPersonName("Priya Shah")).toBe(true);
    expect(isPersonName("Tentative")).toBe(false);
    expect(isPersonName("priya shah")).toBe(false);
  });

  it("collects quoted pairs once each, leaving colour pairs out", () => {
    startRequest('Use "Priya Shah=Training", "Maybe=amber", "evening=Night" and again "Evening=night".');
    expect(quotedPairs()).toEqual([
      { from: "Priya Shah", to: "Training" },
      { from: "evening", to: "Night" },
    ]);
  });

  it("splits several choices only when the cell allows several", () => {
    expect(splitChoices("Driver and Cook, Host", true)).toEqual(["Driver", "Cook", "Host"]);
    expect(splitChoices(" Driver and Cook ", false)).toEqual(["Driver and Cook"]);
    expect(splitChoices("  ", true)).toEqual([]);
  });

  it("reads a rewrite written with =, an arrow, a colon or 'to'", () => {
    expect(parseRewrite('"yes" -> Confirmed')).toEqual({ from: "yes", to: "Confirmed" });
    expect(parseRewrite("tbc → Maybe")).toEqual({ from: "tbc", to: "Maybe" });
    expect(parseRewrite("Tentative to Maybe")).toEqual({ from: "Tentative", to: "Maybe" });
    expect(parseRewrite("Maybe")).toBeNull();
    expect(parseRewrite("'' = Maybe")).toBeNull();
  });

  it("finds rewrites in a change sentence, leaving noise words and existing options out", () => {
    startRequest("Change every cell that says yes, tbc and Confirmed  to Confirmed. Rename Tentative to Maybe so it matches. Turn x to Nowhere.");
    expect(rewritesFromRequest(options)).toEqual([
      { from: "yes", to: "Confirmed" },
      { from: "tbc", to: "Confirmed" },
      { from: "Tentative", to: "Maybe" },
    ]);
  });

  it("reads the listed choices with their colours", () => {
    startRequest("The options are Confirmed in green, Maybe (amber) and “Can’t make it”.");
    expect(choicesFromRequest()).toEqual([
      { label: "Confirmed", color: "green" },
      { label: "Maybe", color: "amber" },
      { label: "Can't make it" },
    ]);
    startRequest("Add a dropdown.");
    expect(choicesFromRequest()).toEqual([]);
  });

  it("reads who to set from 'set X's status to' once per person", () => {
    startRequest("Set Priya Shah's status to Waitlist. Set Priya Shah to Maybe. Set Nora Berg to Boss.");
    expect(assignsFromRequest(options)).toEqual([{ name: "Priya Shah", label: "Waitlist" }]);
  });

  it("finds the source, several-choice wording and concrete range in a sentence", () => {
    expect(sourceInSentence("Put a dropdown on C2:C5 from Statuses ! $A$2 : $A$5.")).toBe("Statuses!A2:A5");
    expect(sourceInSentence("Use the Status column.")).toBe("");
    expect(concreteInSentence("Put a dropdown on C2 : C5 from Statuses!A2:A5.")).toBe("C2:C5");
    expect(concreteInSentence("Statuses!A2:A5 only")).toBe("");
    expect(multipleInSentence("multiple: true please")).toBe(true);
    expect(multipleInSentence("Allow more than one role.")).toBe(true);
    expect(multipleInSentence("One each.")).toBe(false);
  });

  it("picks the sentence for a call by its range, or by the options it lists", () => {
    startRequest("Put a dropdown on C2:C5 with Confirmed and Maybe. Put one on D2:D5 with Day and Night. On D2:D5 also allow more than one.");
    expect(sentenceForCall("C2:C5", ["Confirmed", "Maybe"])).toBe("Put a dropdown on C2:C5 with Confirmed and Maybe.");
    expect(sentenceForCall("Shift", ["Day", "Night"])).toBe("Put one on D2:D5 with Day and Night.");
    expect(sentenceForCall("D2:D5", [])).toBe("Put one on D2:D5 with Day and Night.");
    expect(sentenceForCall("E2:E5", [])).toBe("");
  });
});

describe("normalizeDropdownArgs", () => {
  it("accepts the names and shapes models send", () => {
    expect(
      normalizeDropdownArgs({
        cells: "'C2:C9'",
        choices: '["Confirmed (green)", {"label": "Maybe", "colour": "amber"}, {"name": 3}]',
        fixes: { yes: "Confirmed", count: 2, skip: null },
        people: "Priya Shah=Waitlist, Nora Berg=Maybe",
        reject_other: "allow",
        from_range: " Statuses ! A2:A5 ",
        append: "Training",
        renameSource: "Maybe=Perhaps",
        blank_row: "yes",
        multi: 1,
      }),
    ).toEqual({
      range: "C2:C9",
      options: ["Confirmed", "Maybe"],
      colors: ["green", "amber"],
      fixes: ["yes=Confirmed", "count=2"],
      assign: ["Priya Shah=Waitlist", "Nora Berg=Maybe"],
      reject: false,
      source: "Statuses!A2:A5",
      add: "Training",
      rename_source: "Maybe=Perhaps",
      insert_blank: true,
      multiple: true,
    });
  });

  it("splits loose text and reads reject flags", () => {
    expect(normalizeDropdownArgs({ range: "Status", options: "Yes; No\nMaybe", colors: "green, red", reject: "yes" })).toEqual({
      range: "Status",
      options: ["Yes", "No", "Maybe"],
      colors: ["green", "red"],
      reject: true,
    });
    expect(normalizeDropdownArgs({ header: "Status", option: "Only", fix: '["a=Only"]', reject: true, multiple: "no", insert_blank: "0" })).toEqual({
      range: "Status",
      options: ["Only"],
      fixes: ["a=Only"],
      reject: true,
    });
    expect(normalizeDropdownArgs({ column: "Status", list: "[not json", replace: "{bad", assign: "  " })).toEqual({
      range: "Status",
      options: ["[not json"],
      fixes: ["{bad"],
    });
    expect(normalizeDropdownArgs({ range: "B", options: [true, 0, ""], colors: ["", " "] })).toEqual({ range: "B", options: ["true", "0"] });
  });
});
