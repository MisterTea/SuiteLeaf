import { describe, expect, it } from "vitest";
import {
  isStaleSuggestion,
  nameBeforeCaret,
  rankFormulaSuggestions,
  rankSuggestions,
} from "../apps/web/src/editors/formula-suggestions";

describe("formula suggestions", () => {
  it("reads the name being typed before the caret", () => {
    expect(nameBeforeCaret("=su")).toBe("su");
    expect(nameBeforeCaret("=SUM(B2:B")).toBe("B");
    expect(nameBeforeCaret("=SUM(B2:B6")).toBe("B6");
    expect(nameBeforeCaret("=BETA.D")).toBe("BETA.D");
    expect(nameBeforeCaret("=SUM(B2:B6)")).toBe("");
    expect(nameBeforeCaret("=B7-")).toBe("");
  });

  it("treats a list as stale once the typed name moves past it", () => {
    expect(isStaleSuggestion("=SUM(C2:C", "C")).toBe(false);
    expect(isStaleSuggestion("=su", "SU")).toBe(false);
    expect(isStaleSuggestion("=SUM(C2:C6", "C")).toBe(true);
    expect(isStaleSuggestion("=SUM(C2:C6)", "C")).toBe(true);
    expect(isStaleSuggestion("=sum", "SU")).toBe(true);
  });

  it("suggests everyday functions first and keeps the rest in order", () => {
    const names = (list: { name: string }[]) => list.map((i) => i.name);
    expect(
      names(
        rankSuggestions(
          ["SUBTOTAL", "SUM", "SUMIF", "SUMIFS", "SUMPRODUCT"].map((name) => ({ name })),
        ),
      ),
    ).toEqual(["SUM", "SUMIF", "SUBTOTAL", "SUMIFS", "SUMPRODUCT"]);
    expect(
      names(rankSuggestions(["COUNTIFS", "CONVERT", "COUNTA", "COUNT"].map((name) => ({ name })))),
    ).toEqual(["COUNT", "COUNTA", "COUNTIFS", "CONVERT"]);
  });

  it("ranks what the description service returns", () => {
    const service = {
      getSearchListByNameFirstLetter: (text: string) =>
        ["AVEDEV", "AVERAGE", "AVERAGEA"]
          .filter((n) => n.startsWith(text.toUpperCase()))
          .map((name) => ({ name, desc: "", functionType: 0 })),
    };
    rankFormulaSuggestions(service as never);
    expect(service.getSearchListByNameFirstLetter("av").map((i) => i.name)).toEqual([
      "AVERAGE",
      "AVEDEV",
      "AVERAGEA",
    ]);
  });
});
