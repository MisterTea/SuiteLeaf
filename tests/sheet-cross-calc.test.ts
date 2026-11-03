import { expect, it } from "vitest";
import { recalculateAcrossSheets } from "../packages/core/src/sheet-cross-calc";

it("copies a value into a formula on another sheet and then the next formula", () => {
  const beds = { name: "Beds", cellData: { "0": { "0": { v: "secret-value" } } } };
  const fees = {
    name: "Fees",
    cellData: { "1": { "1": { f: "=Beds!A1" }, "2": { f: "=B2" } } },
  };
  const before = JSON.stringify([beds, fees]);
  const result = recalculateAcrossSheets([beds, fees], "Beds!A1");
  expect(result.calculated).toEqual(["Fees!B2", "Fees!C2"]);
  expect(result.left).toEqual([]);
  expect(result.sheets.find((sheet) => sheet.name === "Fees")?.cellData["1"]["1"].v).toBe("secret-value");
  expect(result.sheets.find((sheet) => sheet.name === "Fees")?.cellData["1"]["2"].v).toBe("secret-value");
  expect(JSON.stringify(result.calculated)).not.toContain("secret-value");
  expect(JSON.stringify(result.calculated)).not.toContain("=");
  expect(JSON.stringify([beds, fees])).toBe(before);
  const bad = recalculateAcrossSheets([beds, fees], "secret\nvalue");
  expect(bad.calculated).toEqual([]);
  expect(JSON.stringify(bad.calculated)).not.toContain("secret");
});

it("adds a small sum on another sheet and leaves text unadded", () => {
  const beds = {
    name: "Beds",
    cellData: { "0": { "0": { v: 10 }, "1": { v: 5 } } },
  };
  const fees = { name: "Fees", cellData: { "1": { "1": { f: "=SUM(Beds!A1:B1)" } } } };
  const before = JSON.stringify([beds, fees]);
  const result = recalculateAcrossSheets([beds, fees], "Beds!A1");
  expect(result.calculated).toEqual(["Fees!B2"]);
  expect(result.sheets.find((sheet) => sheet.name === "Fees")?.cellData["1"]["1"].v).toBe(15);
  expect(JSON.stringify(result.calculated)).not.toContain("15");
  expect(JSON.stringify([beds, fees])).toBe(before);
  const text = recalculateAcrossSheets(
    [
      { name: "Beds", cellData: { "0": { "0": { v: 10 }, "1": { v: "secret-value" } } } },
      { name: "Fees", cellData: { "1": { "1": { f: "=SUM(Beds!A1:B1)", v: 4 } } } },
    ],
    "Beds!A1",
  );
  expect(text.calculated).toEqual([]);
  expect(text.left).toEqual(["Fees!B2"]);
  expect(text.sheets.find((sheet) => sheet.name === "Fees")?.cellData["1"]["1"].v).toBe(4);
  expect(JSON.stringify(text.calculated)).not.toContain("secret-value");
  expect(JSON.stringify(text.left)).not.toContain("secret-value");
});

it("averages a small range and skips a blank cell", () => {
  const beds = {
    name: "Beds",
    cellData: { "0": { "0": { v: 10 }, "1": { v: 20 } } },
  };
  const fees = { name: "Fees", cellData: { "1": { "1": { f: "=AVERAGE(Beds!A1:B1)" } } } };
  const before = JSON.stringify([beds, fees]);
  const result = recalculateAcrossSheets([beds, fees], "Beds!A1");
  expect(result.calculated).toEqual(["Fees!B2"]);
  expect(result.sheets.find((sheet) => sheet.name === "Fees")?.cellData["1"]["1"].v).toBe(15);
  expect(JSON.stringify(result.calculated)).not.toContain("15");
  expect(JSON.stringify([beds, fees])).toBe(before);
  const skipped = recalculateAcrossSheets(
    [
      { name: "Beds", cellData: { "0": { "0": { v: 10 } } } },
      { name: "Fees", cellData: { "1": { "1": { f: "=AVERAGE(Beds!A1:B1)", v: 4 } } } },
    ],
    "Beds!A1",
  );
  expect(skipped.calculated).toEqual(["Fees!B2"]);
  expect(skipped.sheets.find((sheet) => sheet.name === "Fees")?.cellData["1"]["1"].v).toBe(10);
  const text = recalculateAcrossSheets(
    [
      { name: "Beds", cellData: { "0": { "0": { v: 10 }, "1": { v: "secret-value" } } } },
      { name: "Fees", cellData: { "1": { "1": { f: "=AVERAGE(Beds!A1:B1)", v: 4 } } } },
    ],
    "Beds!A1",
  );
  expect(text.calculated).toEqual([]);
  expect(text.left).toEqual(["Fees!B2"]);
  expect(text.sheets.find((sheet) => sheet.name === "Fees")?.cellData["1"]["1"].v).toBe(4);
  expect(JSON.stringify(text.left)).not.toContain("secret-value");
});

it("counts filled cells on another sheet and does not copy their text", () => {
  const beds = {
    name: "Beds",
    cellData: { "0": { "0": { v: 10 }, "1": { v: "secret-value" }, "2": { v: "" } } },
  };
  const fees = { name: "Fees", cellData: { "1": { "1": { f: "=COUNT(Beds!A1:C1)", v: 0 } } } };
  const before = JSON.stringify([beds, fees]);
  const result = recalculateAcrossSheets([beds, fees], "Beds!A1");
  expect(result.calculated).toEqual(["Fees!B2"]);
  expect(result.sheets.find((sheet) => sheet.name === "Fees")?.cellData["1"]["1"].v).toBe(2);
  expect(JSON.stringify(result.calculated)).not.toContain("secret-value");
  expect(JSON.stringify([beds, fees])).toBe(before);
});

it("finds the minimum and maximum on another sheet and skips text", () => {
  const beds = {
    name: "Beds",
    cellData: { "0": { "0": { v: 10 }, "1": { v: "secret-value" }, "2": { v: 4 } } },
  };
  const fees = {
    name: "Fees",
    cellData: { "1": { "1": { f: "=MIN(Beds!A1:C1)", v: 0 }, "2": { f: "=MAX(Beds!A1:C1)", v: 0 } } },
  };
  const before = JSON.stringify([beds, fees]);
  const result = recalculateAcrossSheets([beds, fees], "Beds!A1");
  expect(result.calculated.sort()).toEqual(["Fees!B2", "Fees!C2"]);
  const row = result.sheets.find((sheet) => sheet.name === "Fees")?.cellData["1"];
  expect(row?.["1"].v).toBe(4);
  expect(row?.["2"].v).toBe(10);
  expect(JSON.stringify(result.calculated)).not.toContain("secret-value");
  expect(JSON.stringify([beds, fees])).toBe(before);
  const text = recalculateAcrossSheets(
    [
      { name: "Beds", cellData: { "0": { "0": { v: "secret-value" } } } },
      { name: "Fees", cellData: { "1": { "1": { f: "=MIN(Beds!A1:B1)", v: 4 } } } },
    ],
    "Beds!A1",
  );
  expect(text.left).toEqual(["Fees!B2"]);
  expect(text.sheets.find((sheet) => sheet.name === "Fees")?.cellData["1"]["1"].v).toBe(4);
  expect(JSON.stringify(text.left)).not.toContain("secret-value");
});

it("copies a cell from a sheet whose name contains a hyphen", () => {
  const plot = { name: "Plot-Fees", cellData: { "1": { "1": { v: 9 } } } };
  const beds = { name: "Beds", cellData: { "0": { "0": { f: "=Plot-Fees!B2" } } } };
  const before = JSON.stringify([plot, beds]);
  const result = recalculateAcrossSheets([plot, beds], "Plot-Fees!B2");
  expect(result.calculated).toEqual(["Beds!A1"]);
  expect(result.sheets.find((sheet) => sheet.name === "Beds")?.cellData["0"]["0"].v).toBe(9);
  expect(JSON.stringify(result.calculated)).not.toContain("Plot-Fees");
  expect(JSON.stringify([plot, beds])).toBe(before);
});

it("calculates a formula that has a space after the equals sign", () => {
  const beds = { name: "Beds", cellData: { "0": { "0": { v: 10 }, "1": { v: 5 } } } };
  const fees = { name: "Fees", cellData: { "1": { "1": { f: "= SUM(Beds!A1:B1)" } } } };
  const result = recalculateAcrossSheets([beds, fees], "Beds!A1");
  expect(result.sheets.find((sheet) => sheet.name === "Fees")?.cellData["1"]["1"].v).toBe(15);
  const copied = recalculateAcrossSheets(
    [
      { name: "Beds", cellData: { "0": { "0": { v: 9 } } } },
      { name: "Fees", cellData: { "0": { "0": { f: "= Beds!A1" } } } },
    ],
    "Beds!A1",
  );
  expect(copied.sheets.find((sheet) => sheet.name === "Fees")?.cellData["0"]["0"].v).toBe(9);
});

it("copies a cell when the formula uses a different capitalization of the sheet", () => {
  const beds = { name: "Beds", cellData: { "0": { "0": { v: 9 } } } };
  const fees = { name: "Fees", cellData: { "0": { "0": { f: "=beds!A1" } } } };
  const before = JSON.stringify([beds, fees]);
  const result = recalculateAcrossSheets([beds, fees], "Beds!A1");
  expect(result.calculated).toEqual(["Fees!A1"]);
  expect(result.sheets.find((sheet) => sheet.name === "Fees")?.cellData["0"]["0"].v).toBe(9);
  expect(JSON.stringify([beds, fees])).toBe(before);
});

it("leaves a cycle across sheets unchanged", () => {
  const beds = { name: "Beds", cellData: { "0": { "0": { f: "=Fees!B2", v: 1 } } } };
  const fees = { name: "Fees", cellData: { "1": { "1": { f: "=Beds!A1", v: 2 } } } };
  const result = recalculateAcrossSheets([beds, fees], "Beds!A1");
  expect(result.calculated).toEqual([]);
  expect(result.left).toEqual(["Beds!A1", "Fees!B2"]);
  expect(result.sheets.find((sheet) => sheet.name === "Beds")?.cellData["0"]["0"].v).toBe(1);
  expect(result.sheets.find((sheet) => sheet.name === "Fees")?.cellData["1"]["1"].v).toBe(2);
});

it("rounds a negative halfway value on another sheet away from zero", () => {
  const beds = { name: "Beds", cellData: { "0": { "0": { v: -1.5 }, "1": { v: -15 } } } };
  const fees = {
    name: "Fees",
    cellData: {
      "0": { "0": { f: "=ROUND(Beds!A1, 0)", v: 0 } },
      "1": { "0": { f: "=ROUND(Beds!B1, -1)", v: 0 } },
    },
  };
  const before = JSON.stringify([beds, fees]);
  const places = recalculateAcrossSheets([beds, fees], "Beds!A1");
  expect(places.sheets.find((sheet) => sheet.name === "Fees")?.cellData["0"]["0"].v).toBe(-2);
  const tens = recalculateAcrossSheets([beds, fees], "Beds!B1");
  expect(tens.sheets.find((sheet) => sheet.name === "Fees")?.cellData["1"]["0"].v).toBe(-20);
  expect(JSON.stringify([beds, fees])).toBe(before);
});

it("chooses a cell on another sheet and rounds one cell", () => {
  const beds = {
    name: "Beds",
    cellData: {
      "0": {
        "0": { v: 0 },
        "1": { v: "secret-value" },
        "2": { v: "Beds" },
        "3": { v: 1.239 },
      },
    },
  };
  const fees = {
    name: "Fees",
    cellData: {
      "0": { "0": { f: "=IF(Beds!A1, Beds!B1, Beds!C1)", v: 4 } },
      "1": { "0": { f: "=ROUND(Beds!D1, 2)", v: 0 } },
      "2": { "0": { f: "=IF(Beds!B1, Beds!C1, Beds!A1)", v: 4 } },
    },
  };
  const before = JSON.stringify([beds, fees]);
  const result = recalculateAcrossSheets([beds, fees], "Beds!A1");
  const sheet = result.sheets.find((item) => item.name === "Fees")?.cellData;
  expect(sheet?.["0"]["0"].v).toBe("Beds");
  expect(sheet?.["2"]["0"].v).toBe(4);
  expect(result.calculated).toContain("Fees!A1");
  expect(result.left).toContain("Fees!A3");
  expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
  const rounded = recalculateAcrossSheets([beds, fees], "Beds!D1");
  expect(rounded.sheets.find((item) => item.name === "Fees")?.cellData["1"]["0"].v).toBe(1.24);
  expect(rounded.calculated).toContain("Fees!A2");
  expect(JSON.stringify({ calculated: rounded.calculated, left: rounded.left })).not.toContain("secret-value");
  expect(JSON.stringify([beds, fees])).toBe(before);
});

it("takes the absolute value of a cell on another sheet", () => {
  const beds = {
    name: "Beds",
    cellData: { "0": { "0": { v: -3 }, "1": { v: "secret-value" } } },
  };
  const fees = {
    name: "Fees",
    cellData: {
      "0": { "0": { f: "=ABS(Beds!A1)", v: 0 }, "1": { f: "=A1" } },
      "1": { "0": { f: "= ABS(Beds!B1)", v: 4 } },
    },
  };
  const before = JSON.stringify([beds, fees]);
  const result = recalculateAcrossSheets([beds, fees], "Beds!A1");
  const sheet = result.sheets.find((item) => item.name === "Fees")?.cellData;
  expect(sheet?.["0"]["0"].v).toBe(3);
  expect(sheet?.["0"]["1"].v).toBe(3);
  expect(result.calculated).toContain("Fees!A1");
  expect(result.calculated).toContain("Fees!B1");
  const text = recalculateAcrossSheets([beds, fees], "Beds!B1");
  expect(text.sheets.find((item) => item.name === "Fees")?.cellData["1"]["0"].v).toBe(4);
  expect(text.left).toContain("Fees!A2");
  expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
  expect(JSON.stringify([beds, fees])).toBe(before);
});

it("turns a cell on another sheet into its opposite", () => {
  const beds = {
    name: "Beds",
    cellData: { "0": { "0": { v: -3 }, "1": { v: 0 }, "2": { v: "secret-value" } } },
  };
  const fees = {
    name: "Fees",
    cellData: {
      "0": { "0": { f: "=NOT(Beds!A1)", v: 1 }, "1": { f: "=A1" } },
      "1": { "0": { f: "= NOT(Beds!B1)", v: 0 } },
      "2": { "0": { f: "=NOT(Beds!C1)", v: 1 } },
    },
  };
  const before = JSON.stringify([beds, fees]);
  const result = recalculateAcrossSheets([beds, fees], "Beds!A1");
  const sheet = result.sheets.find((item) => item.name === "Fees")?.cellData;
  expect(sheet?.["0"]["0"].v).toBe(0);
  expect(sheet?.["0"]["1"].v).toBe(0);
  expect(result.calculated).toContain("Fees!A1");
  const zero = recalculateAcrossSheets([beds, fees], "Beds!B1");
  expect(zero.sheets.find((item) => item.name === "Fees")?.cellData["1"]["0"].v).toBe(1);
  const text = recalculateAcrossSheets([beds, fees], "Beds!C1");
  expect(text.sheets.find((item) => item.name === "Fees")?.cellData["2"]["0"].v).toBe(1);
  expect(text.left).toContain("Fees!A3");
  expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
  expect(JSON.stringify([beds, fees])).toBe(before);
});

it("counts characters in a cell on another sheet", () => {
  const beds = {
    name: "Beds",
    cellData: { "0": { "0": { v: "Beds" }, "1": { v: "secret-value" }, "2": { v: "#DIV/0!" } } },
  };
  const fees = {
    name: "Fees",
    cellData: {
      "0": { "0": { f: "=LEN(Beds!A1)", v: 0 }, "1": { f: "=A1" } },
      "1": { "0": { f: "= LEN(Beds!B1)", v: 0 } },
      "2": { "0": { f: "=LEN(Beds!C1)", v: 4 } },
    },
  };
  const before = JSON.stringify([beds, fees]);
  const result = recalculateAcrossSheets([beds, fees], "Beds!A1");
  const sheet = result.sheets.find((item) => item.name === "Fees")?.cellData;
  expect(sheet?.["0"]["0"].v).toBe(4);
  expect(sheet?.["0"]["1"].v).toBe(4);
  const text = recalculateAcrossSheets([beds, fees], "Beds!B1");
  expect(text.sheets.find((item) => item.name === "Fees")?.cellData["1"]["0"].v).toBe(12);
  expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
  const error = recalculateAcrossSheets([beds, fees], "Beds!C1");
  expect(error.sheets.find((item) => item.name === "Fees")?.cellData["2"]["0"].v).toBe(4);
  expect(error.left).toContain("Fees!A3");
  expect(JSON.stringify([beds, fees])).toBe(before);
});

it("removes extra spaces from a cell on another sheet", () => {
  const beds = {
    name: "Beds",
    cellData: {
      "0": { "0": { v: "  Beds   North  " }, "1": { v: "  secret-value  " }, "2": { v: "#DIV/0!" } },
    },
  };
  const fees = {
    name: "Fees",
    cellData: {
      "0": { "0": { f: "=TRIM(Beds!A1)", v: "" }, "1": { f: "=A1" } },
      "1": { "0": { f: "= TRIM(Beds!B1)", v: "" } },
      "2": { "0": { f: "=TRIM(Beds!C1)", v: "kept" } },
    },
  };
  const before = JSON.stringify([beds, fees]);
  const result = recalculateAcrossSheets([beds, fees], "Beds!A1");
  const sheet = result.sheets.find((item) => item.name === "Fees")?.cellData;
  expect(sheet?.["0"]["0"].v).toBe("Beds North");
  expect(sheet?.["0"]["1"].v).toBe("Beds North");
  const text = recalculateAcrossSheets([beds, fees], "Beds!B1");
  expect(text.sheets.find((item) => item.name === "Fees")?.cellData["1"]["0"].v).toBe("secret-value");
  expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
  const error = recalculateAcrossSheets([beds, fees], "Beds!C1");
  expect(error.sheets.find((item) => item.name === "Fees")?.cellData["2"]["0"].v).toBe("kept");
  expect(error.left).toContain("Fees!A3");
  expect(JSON.stringify([beds, fees])).toBe(before);
});

it("requires both cells on another sheet", () => {
  const beds = {
    name: "Beds",
    cellData: { "0": { "0": { v: 2 }, "1": { v: 0 }, "2": { v: "secret-value" } } },
  };
  const fees = {
    name: "Fees",
    cellData: {
      "0": { "0": { f: "=AND(Beds!A1, Beds!B1)", v: 1 }, "1": { f: "=A1" } },
      "1": { "0": { f: "= AND(Beds!C1, Beds!A1)", v: 1 } },
    },
  };
  const before = JSON.stringify([beds, fees]);
  const result = recalculateAcrossSheets([beds, fees], "Beds!A1");
  const sheet = result.sheets.find((item) => item.name === "Fees")?.cellData;
  expect(sheet?.["0"]["0"].v).toBe(0);
  expect(sheet?.["0"]["1"].v).toBe(0);
  expect(result.calculated).toContain("Fees!A1");
  const text = recalculateAcrossSheets([beds, fees], "Beds!C1");
  expect(text.sheets.find((item) => item.name === "Fees")?.cellData["1"]["0"].v).toBe(1);
  expect(text.left).toContain("Fees!A2");
  expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
  expect(JSON.stringify([beds, fees])).toBe(before);
});

it("accepts either cell on another sheet", () => {
  const beds = {
    name: "Beds",
    cellData: { "0": { "0": { v: 0 }, "1": { v: 3 }, "2": { v: "secret-value" } } },
  };
  const fees = {
    name: "Fees",
    cellData: {
      "0": { "0": { f: "=OR(Beds!A1, Beds!B1)", v: 0 }, "1": { f: "=A1" } },
      "1": { "0": { f: "= OR(Beds!C1, Beds!A1)", v: 0 } },
    },
  };
  const before = JSON.stringify([beds, fees]);
  const result = recalculateAcrossSheets([beds, fees], "Beds!A1");
  const sheet = result.sheets.find((item) => item.name === "Fees")?.cellData;
  expect(sheet?.["0"]["0"].v).toBe(1);
  expect(sheet?.["0"]["1"].v).toBe(1);
  const text = recalculateAcrossSheets([beds, fees], "Beds!C1");
  expect(text.sheets.find((item) => item.name === "Fees")?.cellData["1"]["0"].v).toBe(0);
  expect(text.left).toContain("Fees!A2");
  expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
  expect(JSON.stringify([beds, fees])).toBe(before);
});
