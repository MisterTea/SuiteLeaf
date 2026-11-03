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
});
