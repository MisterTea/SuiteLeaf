import { describe, expect, it } from "vitest";
import { evaluationTrace } from "../packages/core/src/sheet-trace";

describe("formula evaluation trace", () => {
  it("adds a small sum and leaves text out", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: 10 },
          "1": { v: "secret-value" },
          "2": { f: "=SUM(A1:B1)", v: 4 },
        },
      },
    };
    const before = JSON.stringify(sheet);
    const traced = evaluationTrace(sheet, "C1");
    expect(traced.note).toBe("A1 is 10. B1 is text. The sum was not calculated.");
    expect(JSON.stringify(traced)).not.toContain("secret-value");
    expect(JSON.stringify(traced)).not.toContain("SUM");
    expect(JSON.stringify(sheet)).toBe(before);

    const added = evaluationTrace(
      {
        cellData: {
          "0": { "0": { v: 10 }, "1": { v: 5 } },
          "1": { "0": { f: "=SUM(A1:B1)" } },
        },
      },
      "A2",
    );
    expect(added.note).toBe("A1 is 10. B1 is 5. The sum is 15.");
    expect(
      evaluationTrace(
        {
          cellData: {
            "0": { "0": { v: 10 }, "1": { v: 5 } },
            "1": { "0": { f: "= SUM(A1:B1)" } },
          },
        },
        "A2",
      ).note,
    ).toBe("A1 is 10. B1 is 5. The sum is 15.");
  });

  it("copies a number and does not copy text", () => {
    expect(
      evaluationTrace({ cellData: { "0": { "0": { f: "=B1" }, "1": { v: 10 } } } }, "A1").note,
    ).toBe("A1 copies B1. B1 is 10. A1 is 10.");
    expect(
      evaluationTrace({ cellData: { "0": { "0": { f: "= B1" }, "1": { v: 10 } } } }, "A1").note,
    ).toBe("A1 copies B1. B1 is 10. A1 is 10.");
    const text = evaluationTrace(
      { cellData: { "0": { "0": { f: "=B1" }, "1": { v: "secret-value" } } } },
      "A1",
    );
    expect(text.note).toBe("A1 copies B1. B1 is text. The text is not shown.");
    expect(JSON.stringify(text)).not.toContain("secret-value");
    expect(evaluationTrace({ cellData: { "0": { "0": { f: "=SUM(A1:A80)" } } } }, "A1").note).toBe(
      "That formula is not traced.",
    );
    expect(
      evaluationTrace(
        { cellData: { "0": { "0": { v: 10 }, "1": { v: 20 }, "2": { f: "=AVERAGE(A1:B1)" } } } },
        "C1",
      ).note,
    ).toBe("A1 is 10. B1 is 20. The average is 15.");
    const hidden = evaluationTrace(
      { cellData: { "0": { "0": { v: 10 }, "1": { v: "secret-value" }, "2": { f: "=AVERAGE(A1:B1)" } } } },
      "C1",
    );
    expect(hidden.note).toBe("A1 is 10. B1 is text. The average was not calculated.");
    expect(JSON.stringify(hidden)).not.toContain("secret-value");
    const count = evaluationTrace(
      { cellData: { "0": { "0": { v: 10 }, "1": { v: "secret-value" }, "2": { v: "" }, "3": { f: "=COUNT(A1:C1)" } } } },
      "D1",
    );
    expect(count.note).toBe("The count is 2.");
    const filled = evaluationTrace(
      { cellData: { "0": { "0": { v: 10 }, "1": { v: "secret-value" }, "2": { v: "" }, "3": { f: "=COUNTA(A1:C1)" } } } },
      "D1",
    );
    expect(filled.note).toBe("The count of filled cells is 2.");
    expect(JSON.stringify(filled)).not.toContain("secret-value");
    expect(JSON.stringify(filled)).not.toContain("COUNTA");
    const product = evaluationTrace(
      { cellData: { "0": { "0": { v: 10 }, "1": { v: "secret-value" }, "2": { v: 4 }, "3": { f: "=PRODUCT(A1:C1)" } } } },
      "D1",
    );
    expect(product.note).toBe("The product is 40.");
    const middle = evaluationTrace(
      {
        cellData: {
          "0": { "0": { v: 10 }, "1": { v: "secret-value" }, "2": { v: 4 }, "3": { v: 30 }, "4": { f: "=MEDIAN(A1:D1)" } },
        },
      },
      "E1",
    );
    expect(middle.note).toBe("The median is 10.");
    expect(JSON.stringify(middle)).not.toContain("secret-value");
    expect(JSON.stringify(middle)).not.toContain("MEDIAN");
    const whole = evaluationTrace(
      { cellData: { "0": { "0": { v: 8.9 }, "1": { f: "=INT(A1)" } } } },
      "B1",
    );
    expect(whole.note).toBe("The result is 8.");
    const taken = evaluationTrace(
      { cellData: { "0": { "0": { v: "Beds North" }, "1": { f: "=LEFT(A1, 4)" } } } },
      "B1",
    );
    expect(taken.note).toBe("The result has 4 characters.");
    const formatted = evaluationTrace(
      { cellData: { "0": { "0": { v: 8.9 }, "1": { f: '=TEXT(A1, "0.00")' } } } },
      "B1",
    );
    expect(formatted.note).toBe("The result has 4 characters.");
    const today = evaluationTrace(
      { cellData: { "0": { "0": { f: "=TODAY()" }, "1": { v: "secret-value" } } } },
      "A1",
      [],
      new Date("2026-11-03T15:04:05.000Z"),
    );
    expect(today.note).toBe("The date is 2026-11-03.");
    const drawn = evaluationTrace(
      { cellData: { "0": { "0": { f: "=RAND()" }, "1": { v: "secret-value" } } } },
      "A1",
      [],
      undefined,
      () => 0.25,
    );
    expect(drawn.note).toBe("The random number is 0.25.");
    const moved = evaluationTrace(
      { cellData: { "0": { "0": { v: 10 }, "1": { f: "=OFFSET(A1, 1, 0)" } }, "1": { "0": { v: 4 }, "1": { v: "secret-value" } } } },
      "B1",
    );
    expect(moved.note).toBe("The cell reached is 4.");
    expect(JSON.stringify(moved)).not.toContain("secret-value");
    expect(JSON.stringify(moved)).not.toContain("OFFSET");
    expect(JSON.stringify(drawn)).not.toContain("secret-value");
    expect(JSON.stringify(drawn)).not.toContain("RAND");
    expect(JSON.stringify(today)).not.toContain("secret-value");
    expect(JSON.stringify(today)).not.toContain("TODAY");
    expect(JSON.stringify(formatted)).not.toContain("TEXT");
    expect(JSON.stringify(formatted)).not.toContain("8.90");
    expect(JSON.stringify(taken)).not.toContain("LEFT");
    expect(JSON.stringify(taken)).not.toContain("Beds");
    const broken = evaluationTrace(
      { cellData: { "0": { "0": { v: "secret-value" }, "1": { f: "=LEFT(A1, 3)" } } } },
      "B1",
    );
    expect(broken.note).toBe("The result has 3 characters.");
    expect(JSON.stringify(broken)).not.toContain("secret-value");
    expect(JSON.stringify(whole)).not.toContain("INT");
    const textRoot = evaluationTrace(
      { cellData: { "0": { "0": { v: "secret-value" }, "1": { f: "=SQRT(A1)" } } } },
      "B1",
    );
    expect(textRoot.note).toBe("The number was not calculated.");
    expect(JSON.stringify(textRoot)).not.toContain("secret-value");
    expect(JSON.stringify(textRoot)).not.toContain("SQRT");
    expect(JSON.stringify(product)).not.toContain("secret-value");
    expect(JSON.stringify(product)).not.toContain("PRODUCT");
    expect(JSON.stringify(count)).not.toContain("secret-value");
    const minimum = evaluationTrace(
      { cellData: { "0": { "0": { v: 10 }, "1": { v: "secret-value" }, "2": { v: 4 }, "3": { f: "=MIN(A1:C1)" } } } },
      "D1",
    );
    expect(minimum.note).toBe("The minimum is 4.");
    expect(JSON.stringify(minimum)).not.toContain("secret-value");
    const maximum = evaluationTrace(
      { cellData: { "0": { "0": { v: 10 }, "1": { v: "secret-value" }, "2": { f: "=MAX(A1:B1)" } } } },
      "C1",
    );
    expect(maximum.note).toBe("The maximum is 10.");
    expect(JSON.stringify(maximum)).not.toContain("secret-value");
    const blocked = evaluationTrace(
      { cellData: { "0": { "0": { v: "secret-value" }, "1": { v: "" }, "2": { f: "=MIN(A1:B1)" } } } },
      "C1",
    );
    expect(blocked.note).toBe("The minimum was not calculated.");
    expect(JSON.stringify(blocked)).not.toContain("secret-value");
  });

  it("names a formula error and does not add it into a sum", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: 10 },
          "1": { v: "#DIV/0!", f: "secret-value" },
          "2": { f: "=SUM(A1:B1)" },
        },
      },
    };
    const traced = evaluationTrace(sheet, "C1");
    expect(traced.note).toBe("A1 is 10. B1 shows #DIV/0!. The sum was not calculated.");
    expect(JSON.stringify(traced)).not.toContain("secret-value");
    const copied = evaluationTrace(
      { cellData: { "0": { "0": { f: "=B1" }, "1": { v: "#REF!" } } } },
      "A1",
    );
    expect(copied.note).toBe("A1 copies B1. B1 shows #REF!.");
    expect(JSON.stringify(sheet.cellData["0"]["1"])).toContain("secret-value");
  });

  it("copies a cell on another sheet and leaves a missing sheet unnamed when it is a secret", () => {
    const sheet = { cellData: { "0": { "0": { f: "=Fees!B2" } } } };
    const fees = { name: "Fees", cellData: { "1": { "1": { v: 9 } } } };
    const traced = evaluationTrace(sheet, "A1", [fees]);
    expect(traced.note).toBe("A1 copies Fees!B2. B2 is 9. A1 is 9.");
    expect(fees.cellData["1"]["1"].v).toBe(9);
    const hidden = evaluationTrace(
      { cellData: { "0": { "0": { f: "='secret-value'!B2" } } } },
      "A1",
      [{ name: "secret-value", cellData: { "1": { "1": { v: 4 } } } }],
    );
    expect(hidden.note).toBe("A1 copies another sheet B2. B2 is 4. A1 is 4.");
    expect(JSON.stringify(hidden)).not.toContain("secret-value");
    const missing = evaluationTrace(
      { cellData: { "0": { "0": { f: "='secret-value'!B2" } } } },
      "A1",
      [],
    );
    expect(missing.note).toBe("A1 names a sheet, and that sheet is not in this workbook.");
    expect(JSON.stringify(missing)).not.toContain("secret-value");
  });

  it("sums a range on another sheet and does not copy text from a secret sheet", () => {
    const sheet = { cellData: { "0": { "0": { f: "=SUM(Fees!A1:B1)" } } } };
    const fees = { name: "Fees", cellData: { "0": { "0": { v: 4 }, "1": { v: 5 } } } };
    const traced = evaluationTrace(sheet, "A1", [fees]);
    expect(traced.note).toBe("Fees!A1 is 4. Fees!B1 is 5. The sum is 9.");
    expect(fees.cellData["0"]["0"].v).toBe(4);
    const counted = evaluationTrace(
      { cellData: { "0": { "0": { f: "=COUNT(Fees!A1:B1)" } } } },
      "A1",
      [fees],
    );
    expect(counted.note).toBe("The count is 2.");
    const hidden = evaluationTrace(
      { cellData: { "0": { "0": { f: "=SUM('secret-value'!A1:A1)" } } } },
      "A1",
      [{ name: "secret-value", cellData: { "0": { "0": { v: "secret-value" } } } }],
    );
    expect(hidden.note).toBe("another sheet A1 is text. The text is not shown. The sum was not calculated.");
    expect(JSON.stringify(hidden)).not.toContain("secret-value");
  });

  it("rounds one cell and does not round text", () => {
    const sheet = { cellData: { "0": { "0": { v: 1.239 }, "1": { f: "=ROUND(A1, 2)" } } } };
    const before = JSON.stringify(sheet);
    expect(evaluationTrace(sheet, "B1").note).toBe("A1 is 1.239. The rounded value is 1.24.");
    expect(JSON.stringify(sheet)).toBe(before);
    expect(evaluationTrace({ cellData: { "0": { "0": { v: 15 }, "1": { f: "=ROUND(A1, -1)" } } } }, "B1").note).toBe(
      "A1 is 15. The rounded value is 20.",
    );
    expect(evaluationTrace({ cellData: { "0": { "0": { v: -1.5 }, "1": { f: "=ROUND(A1, 0)" } } } }, "B1").note).toBe(
      "A1 is -1.5. The rounded value is -2.",
    );
    const text = evaluationTrace(
      { cellData: { "0": { "0": { v: "secret-value" }, "1": { f: "=ROUND(A1, 2)" } } } },
      "B1",
    );
    expect(text.note).toBe("A1 is text. The text is not shown. The rounded value was not calculated.");
    expect(JSON.stringify(text)).not.toContain("secret-value");
    expect(JSON.stringify(text)).not.toContain("ROUND");
    const fromCell = evaluationTrace(
      { cellData: { "0": { "0": { v: 1.239 }, "1": { v: 2 }, "2": { f: "=ROUND(A1, B1)" } } } },
      "C1",
    );
    expect(fromCell.note).toBe("A1 is 1.239. B1 is 2. The rounded value is 1.24.");
    const badDigits = evaluationTrace(
      { cellData: { "0": { "0": { v: 1.239 }, "1": { v: "secret-value" }, "2": { f: "=ROUND(A1, B1)" } } } },
      "C1",
    );
    expect(badDigits.note).toBe(
      "A1 is 1.239. B1 is text. The text is not shown. The rounded value was not calculated.",
    );
    expect(JSON.stringify(badDigits)).not.toContain("secret-value");
    expect(JSON.stringify(badDigits)).not.toContain("ROUND");
  });

  it("follows a condition to one cell and does not copy text", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: 0 },
          "1": { v: "secret-value" },
          "2": { v: 4 },
          "3": { f: "=IF(A1,B1,C1)" },
        },
      },
    };
    const before = JSON.stringify(sheet);
    expect(evaluationTrace(sheet, "D1").note).toBe("A1 is 0. C1 is 4. The result is 4.");
    expect(JSON.stringify(sheet)).toBe(before);
    expect(
      evaluationTrace(
        { cellData: { "0": { "0": { v: 2 }, "1": { v: 9 }, "2": { v: 4 }, "3": { f: "=IF(A1,B1,C1)" } } } },
        "D1",
      ).note,
    ).toBe("A1 is 2. B1 is 9. The result is 9.");
    const text = evaluationTrace(
      { cellData: { "0": { "0": { v: "secret-value" }, "1": { v: 9 }, "2": { v: 4 }, "3": { f: "=IF(A1,B1,C1)" } } } },
      "D1",
    );
    expect(text.note).toBe("A1 is text. The text is not shown. The condition was not decided.");
    expect(JSON.stringify(text)).not.toContain("secret-value");
    expect(JSON.stringify(text)).not.toContain("IF");
  });

  it("takes the absolute value of one cell", () => {
    const sheet = { cellData: { "0": { "0": { v: -4 }, "1": { f: "=ABS(A1)" } } } };
    const before = JSON.stringify(sheet);
    expect(evaluationTrace(sheet, "B1").note).toBe("A1 is -4. The absolute value is 4.");
    expect(JSON.stringify(sheet)).toBe(before);
    const text = evaluationTrace(
      { cellData: { "0": { "0": { v: "secret-value" }, "1": { f: "= ABS(A1)" } } } },
      "B1",
    );
    expect(text.note).toBe("A1 is text. The text is not shown. The absolute value was not calculated.");
    expect(JSON.stringify(text)).not.toContain("secret-value");
    expect(JSON.stringify(text)).not.toContain("ABS");
  });

  it("turns one cell into its opposite", () => {
    const sheet = { cellData: { "0": { "0": { v: 0 }, "1": { f: "=NOT(A1)" } } } };
    const before = JSON.stringify(sheet);
    expect(evaluationTrace(sheet, "B1").note).toBe("A1 is 0. The opposite is 1.");
    expect(JSON.stringify(sheet)).toBe(before);
    const number = evaluationTrace(
      { cellData: { "0": { "0": { v: -4 }, "1": { f: "= NOT(A1)" } } } },
      "B1",
    );
    expect(number.note).toBe("A1 is -4. The opposite is 0.");
    const text = evaluationTrace(
      { cellData: { "0": { "0": { v: "secret-value" }, "1": { f: "=NOT(A1)" } } } },
      "B1",
    );
    expect(text.note).toBe("A1 is text. The text is not shown. The opposite was not calculated.");
    expect(JSON.stringify(text)).not.toContain("secret-value");
    expect(JSON.stringify(text)).not.toContain("NOT");
    const other = evaluationTrace(
      { cellData: { "0": { "0": { f: "=NOT(Beds!A1)" } } } },
      "A1",
      [{ name: "Beds", cellData: { "0": { "0": { v: 3 } } } }],
    );
    expect(other.note).toBe("Beds!A1 is 3. The opposite is 0.");
  });

  it("counts the characters in one cell", () => {
    const sheet = { cellData: { "0": { "0": { v: -4 }, "1": { f: "=LEN(A1)" } } } };
    const before = JSON.stringify(sheet);
    expect(evaluationTrace(sheet, "B1").note).toBe("A1 is -4. The length is 2.");
    expect(JSON.stringify(sheet)).toBe(before);
    const text = evaluationTrace(
      { cellData: { "0": { "0": { v: "secret-value" }, "1": { f: "= LEN(A1)" } } } },
      "B1",
    );
    expect(text.note).toBe("A1 is text. The length is 12.");
    expect(JSON.stringify(text)).not.toContain("secret-value");
    expect(JSON.stringify(text)).not.toContain("LEN");
    const other = evaluationTrace(
      { cellData: { "0": { "0": { f: "=LEN(Beds!A1)" } } } },
      "A1",
      [{ name: "Beds", cellData: { "0": { "0": { v: "Beds" } } } }],
    );
    expect(other.note).toBe("Beds!A1 is text. The length is 4.");
  });

  it("removes extra spaces from one cell", () => {
    const sheet = { cellData: { "0": { "0": { v: "  Beds   North  " }, "1": { f: "=TRIM(A1)" } } } };
    const before = JSON.stringify(sheet);
    expect(evaluationTrace(sheet, "B1").note).toBe("A1 is text. The trimmed text has 10 characters.");
    expect(JSON.stringify(sheet)).toBe(before);
    const text = evaluationTrace(
      { cellData: { "0": { "0": { v: "  secret-value  " }, "1": { f: "= TRIM(A1)" } } } },
      "B1",
    );
    expect(text.note).toBe("A1 is text. The trimmed text has 12 characters.");
    expect(JSON.stringify(text)).not.toContain("secret-value");
    expect(JSON.stringify(text)).not.toContain("TRIM");
    const other = evaluationTrace(
      { cellData: { "0": { "0": { f: "=TRIM(Beds!A1)" } } } },
      "A1",
      [{ name: "Beds", cellData: { "0": { "0": { v: "  Beds  " } } } }],
    );
    expect(other.note).toBe("Beds!A1 is text. The trimmed text has 4 characters.");
    const lower = evaluationTrace(
      { cellData: { "0": { "0": { v: "Beds North" }, "1": { f: "=LOWER(A1)" } } } },
      "B1",
    );
    expect(lower.note).toBe("A1 is text. The lower case text has 10 characters.");
    const recovered = evaluationTrace(
      { cellData: { "0": { "0": { v: "#DIV/0!" }, "1": { v: 4 }, "2": { f: "=IFERROR(A1, B1)" } } } },
      "C1",
    );
    expect(recovered.note).toBe("A1 shows #DIV/0!. The fallback is 4.");
    const looked = evaluationTrace(
      {
        cellData: {
          "0": { "0": { v: "West" }, "1": { v: "West" }, "2": { v: "secret-value" }, "3": { f: "=VLOOKUP(A1, B1:C1, 2)" } },
        },
      },
      "D1",
    );
    expect(looked.note).toBe("The lookup found a match. The result is text.");
    const across = evaluationTrace(
      {
        cellData: {
          "0": { "0": { v: "north" }, "1": { v: "Beds" }, "2": { v: "North" }, "3": { f: "=HLOOKUP(A1, B1:C2, 2)" } },
          "1": { "1": { v: 10 }, "2": { v: "secret-value" } },
        },
      },
      "D1",
    );
    expect(across.note).toBe("The lookup found a match. The result is text.");
    const second = evaluationTrace(
      {
        cellData: {
          "0": {
            "0": { v: "beds" },
            "1": { v: "Beds" },
            "2": { v: "secret-value" },
            "3": { f: "=XLOOKUP(A1, B1:B1, C1:C1)" },
          },
        },
      },
      "D1",
    );
    expect(second.note).toBe("The lookup found a match. The result is text.");
    expect(JSON.stringify(second)).not.toContain("secret-value");
    expect(JSON.stringify(second)).not.toContain("XLOOKUP");
    expect(JSON.stringify(across)).not.toContain("secret-value");
    expect(JSON.stringify(across)).not.toContain("HLOOKUP");
    const summed = evaluationTrace(
      {
        cellData: {
          "0": { "0": { v: "Beds" }, "1": { v: 10 }, "2": { f: "=SUMIF(A1:A2, D1, B1:B2)" }, "3": { v: "Beds" } },
          "1": { "0": { v: "North" }, "1": { v: "secret-value" } },
        },
      },
      "C1",
    );
    expect(summed.note).toBe("The sum of matching cells is 10.");
    const counted = evaluationTrace(
      {
        cellData: {
          "0": { "0": { v: "Beds" }, "1": { f: "=COUNTIF(A1:A2, C1)" }, "2": { v: "Beds" } },
          "1": { "0": { v: "secret-value" } },
        },
      },
      "B1",
    );
    expect(counted.note).toBe("The count of matching cells is 1.");
    const many = evaluationTrace(
      {
        cellData: {
          "0": { "0": { v: "Beds" }, "1": { v: "North" }, "2": { f: "=COUNTIFS(A1:A2, D1, B1:B2, E1)" }, "3": { v: "Beds" }, "4": { v: "North" } },
          "1": { "0": { v: "secret-value" }, "1": { v: "North" } },
        },
      },
      "C1",
    );
    expect(many.note).toBe("The count of matching cells is 1.");
    const averaged = evaluationTrace(
      {
        cellData: {
          "0": { "0": { v: "Beds" }, "1": { v: 10 }, "2": { f: "=AVERAGEIF(A1:A2, D1, B1:B2)" }, "3": { v: "Beds" } },
          "1": { "0": { v: "North" }, "1": { v: "secret-value" } },
        },
      },
      "C1",
    );
    expect(averaged.note).toBe("The average of matching cells is 10.");
    const summedMany = evaluationTrace(
      {
        cellData: {
          "0": {
            "0": { v: "Beds" },
            "1": { v: 10 },
            "2": { v: "North" },
            "3": { f: "=SUMIFS(B1:B2, A1:A2, E1, C1:C2, F1)" },
            "4": { v: "Beds" },
            "5": { v: "North" },
          },
          "1": { "0": { v: "secret-value" }, "1": { v: 4 }, "2": { v: "North" } },
        },
      },
      "D1",
    );
    expect(summedMany.note).toBe("The sum of matching cells is 10.");
    const averagedMany = evaluationTrace(
      {
        cellData: {
          "0": {
            "0": { v: "Beds" },
            "1": { v: 10 },
            "2": { v: "North" },
            "3": { f: "=AVERAGEIFS(B1:B2, A1:A2, E1, C1:C2, F1)" },
            "4": { v: "Beds" },
            "5": { v: "North" },
          },
          "1": { "0": { v: "secret-value" }, "1": { v: 4 }, "2": { v: "North" } },
        },
      },
      "D1",
    );
    expect(averagedMany.note).toBe("The average of rows that match every condition is 10.");
    expect(JSON.stringify(averagedMany)).not.toContain("secret-value");
    expect(JSON.stringify(averagedMany)).not.toContain("AVERAGEIFS");
    expect(JSON.stringify(summedMany)).not.toContain("secret-value");
    expect(JSON.stringify(summedMany)).not.toContain("SUMIFS");
    expect(JSON.stringify(averaged)).not.toContain("secret-value");
    expect(JSON.stringify(averaged)).not.toContain("AVERAGEIF");
    expect(JSON.stringify(many)).not.toContain("secret-value");
    expect(JSON.stringify(many)).not.toContain("COUNTIFS");
    const indexed = evaluationTrace(
      { cellData: { "0": { "1": { v: "secret-value" }, "2": { f: "=INDEX(B1:B1, 1)" } } } },
      "C1",
    );
    expect(indexed.note).toBe("The cell at that position is text.");
    const year = evaluationTrace(
      { cellData: { "0": { "0": { v: " 2026-01-15 " }, "1": { f: "=YEAR(A1)" } } } },
      "B1",
    );
    expect(year.note).toBe("A1 is a date. The year is 2026.");
    const built = evaluationTrace(
      {
        cellData: {
          "0": { "0": { v: 2026 }, "1": { v: 1 }, "2": { v: 15 }, "3": { f: "=DATE(A1, B1, C1)" } },
        },
      },
      "D1",
    );
    expect(built.note).toBe("The date is 2026-01-15.");
    expect(JSON.stringify(built)).not.toContain("DATE");
    const refused = evaluationTrace(
      { cellData: { "0": { "0": { v: "secret-value" }, "1": { v: 1 }, "2": { v: 15 }, "3": { f: "=DATE(A1, B1, C1)" } } } },
      "D1",
    );
    expect(refused.note).toBe("The date was not calculated.");
    expect(JSON.stringify(refused)).not.toContain("secret-value");
    expect(JSON.stringify(year)).not.toContain("YEAR");
    const hidden = evaluationTrace(
      { cellData: { "0": { "0": { v: "secret-value" }, "1": { f: "=MONTH(A1)" } } } },
      "B1",
    );
    expect(hidden.note).toBe("The month was not calculated.");
    expect(JSON.stringify(hidden)).not.toContain("secret-value");
    expect(JSON.stringify(indexed)).not.toContain("secret-value");
    expect(JSON.stringify(indexed)).not.toContain("INDEX");
    const matched = evaluationTrace(
      { cellData: { "0": { "0": { v: "Beds" }, "1": { v: "beds" }, "2": { f: "=MATCH(A1, B1:B1, 0)" } } } },
      "C1",
    );
    expect(matched.note).toBe("The match is in position 1.");
    expect(JSON.stringify(matched)).not.toContain("MATCH");
    expect(JSON.stringify(counted)).not.toContain("secret-value");
    expect(JSON.stringify(counted)).not.toContain("COUNTIF");
    expect(JSON.stringify(summed)).not.toContain("secret-value");
    expect(JSON.stringify(summed)).not.toContain("SUMIF");
    expect(JSON.stringify(looked)).not.toContain("secret-value");
    expect(JSON.stringify(looked)).not.toContain("VLOOKUP");
    const missed = evaluationTrace(
      { cellData: { "0": { "0": { v: "Missing" }, "1": { f: "=VLOOKUP(A1, B1:C1, 2)" } } } },
      "B1",
    );
    expect(missed.note).toBe("The lookup did not find a match.");
    expect(JSON.stringify(recovered)).not.toContain("IFERROR");
    const kept = evaluationTrace(
      { cellData: { "0": { "0": { v: "secret-value" }, "1": { f: "=IFERROR(A1, B1)" } } } },
      "B1",
    );
    expect(kept.note).toBe("A1 is text. The value is kept.");
    expect(JSON.stringify(kept)).not.toContain("secret-value");
    expect(JSON.stringify(lower)).not.toContain("LOWER");
    expect(JSON.stringify(lower)).not.toContain("Beds");
    const upper = evaluationTrace(
      { cellData: { "0": { "0": { f: "=UPPER(Beds!A1)" } } } },
      "A1",
      [{ name: "Beds", cellData: { "0": { "0": { v: "Secret-Value" } } } }],
    );
    expect(upper.note).toBe("Beds!A1 is text. The capital text has 12 characters.");
    expect(JSON.stringify(upper)).not.toContain("Secret-Value");
    expect(JSON.stringify(upper)).not.toContain("UPPER");
  });

  it("requires both cells", () => {
    const sheet = { cellData: { "0": { "0": { v: 2 }, "1": { v: 0 }, "2": { f: "=AND(A1,B1)" } } } };
    const before = JSON.stringify(sheet);
    expect(evaluationTrace(sheet, "C1").note).toBe("A1 is 2. B1 is 0. Both are not true.");
    expect(JSON.stringify(sheet)).toBe(before);
    const text = evaluationTrace(
      { cellData: { "0": { "0": { v: "secret-value" }, "1": { v: 4 }, "2": { f: "= AND(A1, B1)" } } } },
      "C1",
    );
    expect(text.note).toBe("A1 is text. B1 is 4. The text is not shown. Both were not decided.");
    expect(JSON.stringify(text)).not.toContain("secret-value");
    expect(JSON.stringify(text)).not.toContain("AND");
    const other = evaluationTrace(
      { cellData: { "0": { "0": { f: "=AND(Beds!A1, Beds!B1)" } } } },
      "A1",
      [{ name: "Beds", cellData: { "0": { "0": { v: -4 }, "1": { v: 3 } } } }],
    );
    expect(other.note).toBe("Beds!A1 is -4. Beds!B1 is 3. Both are true.");
  });

  it("accepts either cell", () => {
    const sheet = { cellData: { "0": { "0": { v: 0 }, "1": { v: 3 }, "2": { f: "=OR(A1,B1)" } } } };
    expect(evaluationTrace(sheet, "C1").note).toBe("A1 is 0. B1 is 3. Either is true.");
    const neither = evaluationTrace(
      { cellData: { "0": { "0": { v: 0 }, "1": { v: 0 }, "2": { f: "=OR(A1,B1)" } } } },
      "C1",
    );
    expect(neither.note).toBe("A1 is 0. B1 is 0. Neither is true.");
    const text = evaluationTrace(
      { cellData: { "0": { "0": { v: "secret-value" }, "1": { v: 4 }, "2": { f: "= OR(A1, B1)" } } } },
      "C1",
    );
    expect(text.note).toBe("A1 is text. B1 is 4. The text is not shown. Either was not decided.");
    expect(JSON.stringify(text)).not.toContain("secret-value");
    expect(JSON.stringify(text)).not.toContain("OR");
  });

  it("names the first true test without the text", () => {
    const chosen = evaluationTrace(
      {
        cellData: {
          "0": {
            "0": { v: 0 },
            "1": { v: "secret-value" },
            "2": { v: 1 },
            "3": { v: 4 },
            "4": { f: "=IFS(A1, B1, C1, D1)" },
          },
        },
      },
      "E1",
    );
    expect(chosen.note).toBe("The first true test uses 4.");
    expect(JSON.stringify(chosen)).not.toContain("secret-value");
    expect(JSON.stringify(chosen)).not.toContain("IFS");
    const none = evaluationTrace(
      { cellData: { "0": { "0": { v: 0 }, "1": { v: 2 }, "2": { v: 0 }, "3": { v: 9 }, "4": { f: "=IFS(A1, B1, C1, D1)" } } } },
      "E1",
    );
    expect(none.note).toBe("No test was true.");
  });

  it("names a comparison without the text", () => {
    const chosen = evaluationTrace(
      {
        cellData: {
          "0": { "0": { v: 12 }, "1": { v: 4 }, "2": { f: "=IF(A1>10, B1, C1)" } },
        },
      },
      "C1",
    );
    expect(chosen.note).toBe("The comparison is true. The result is 4.");
    const hidden = evaluationTrace(
      { cellData: { "0": { "0": { v: "secret-value" }, "1": { f: '=IF(A1>"Beds", "Yes", "No")' } } } },
      "B1",
    );
    expect(hidden.note).toBe("The comparison was not decided.");
    expect(JSON.stringify(hidden)).not.toContain("secret-value");
    expect(JSON.stringify(hidden)).not.toContain("IF");
  });

  it("names AND, OR, NOT, and IFS comparisons without the text", () => {
    const both = evaluationTrace(
      { cellData: { "0": { "0": { v: 12 }, "1": { v: 3 }, "2": { f: "=AND(A1>10, B1<5)" } } } },
      "C1",
    );
    expect(both.note).toBe("Both are true.");
    const none = evaluationTrace(
      { cellData: { "0": { "0": { v: 4 }, "1": { v: 9 }, "2": { f: "=OR(A1>10, B1<5)" } } } },
      "C1",
    );
    expect(none.note).toBe("Neither is true.");
    const opposite = evaluationTrace(
      { cellData: { "0": { "0": { v: 12 }, "1": { f: "=NOT(A1>10)" } } } },
      "B1",
    );
    expect(opposite.note).toBe("The opposite is 0.");
    const chosen = evaluationTrace(
      {
        cellData: {
          "0": { "0": { v: 4 }, "1": { v: "secret-value" }, "2": { v: 3 }, "3": { v: 8 }, "4": { f: "=IFS(A1>10, B1, C1<5, D1)" } },
        },
      },
      "E1",
    );
    expect(chosen.note).toBe("The first true test uses 8.");
    expect(JSON.stringify(chosen)).not.toContain("secret-value");
    expect(JSON.stringify(chosen)).not.toContain("IFS");
  });

  it("counts a written comparison without the text", () => {
    const chosen = evaluationTrace(
      {
        cellData: {
          "0": { "0": { v: 12 }, "1": { f: '=COUNTIFS(A1:A3, ">10")' } },
          "1": { "0": { v: 4 } },
          "2": { "0": { v: "secret-value" } },
        },
      },
      "B1",
    );
    expect(chosen.note).toBe("The count of matching cells is 1.");
    expect(JSON.stringify(chosen)).not.toContain("secret-value");
    expect(JSON.stringify(chosen)).not.toContain("COUNTIFS");
  });

  it("names a written sum without the text", () => {
    const chosen = evaluationTrace(
      {
        cellData: {
          "0": { "0": { v: "Pass" }, "1": { v: 10 }, "2": { f: '=SUMIF(A1:A3, "Pass", B1:B3)' } },
          "1": { "0": { v: "pass" }, "1": { v: 4 } },
          "2": { "0": { v: "secret-value" }, "1": { v: 9 } },
        },
      },
      "C1",
    );
    expect(chosen.note).toBe("The sum of matching cells is 14.");
    expect(JSON.stringify(chosen)).not.toContain("secret-value");
    expect(JSON.stringify(chosen)).not.toContain("SUMIF");
  });

  it("names a written IFS result without the word", () => {
    const chosen = evaluationTrace(
      { cellData: { "0": { "0": { v: 12 }, "1": { f: '=IFS(A1>10, "High", TRUE, "Low")' } } } },
      "B1",
    );
    expect(chosen.note).toBe("The first true test uses text.");
    expect(JSON.stringify(chosen)).not.toContain("High");
    const other = evaluationTrace(
      { cellData: { "0": { "0": { v: "secret-value" }, "1": { f: '=IFS(A1>10, "High", TRUE, "Low")' } } } },
      "B1",
    );
    expect(other.note).toBe("A test was not a number.");
    expect(JSON.stringify(other)).not.toContain("secret-value");
  });
});
