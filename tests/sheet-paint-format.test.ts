import { expect, test } from "vitest";
import {
  applyCopiedCellFormat,
  copyCellFormat,
} from "../apps/web/src/editors/sheet-paint-format";

const currency = '"$"#,##0.00';
const blue = "#1a73e8";

test("applying a copied format sets bold, color, and currency without replacing the value", () => {
  const format = copyCellFormat(
    { bl: 1, cl: { rgb: blue }, n: { pattern: currency } },
    currency,
  );
  expect(format).toEqual({
    bold: true,
    color: blue,
    numberFormat: currency,
  });
  expect(format).not.toHaveProperty("value");

  const next = applyCopiedCellFormat(
    { value: 12, bold: false, color: null, numberFormat: null },
    format,
  );
  expect(next).toEqual({
    value: 12,
    bold: true,
    color: blue,
    numberFormat: currency,
  });
  expect(next.value).toBe(12);
  expect(next.value).not.toBe(40);
});

test("an empty copy changes nothing", () => {
  const plain = { value: 7, bold: false, color: null, numberFormat: null };
  expect(copyCellFormat(null, "")).toEqual({
    bold: false,
    color: null,
    numberFormat: null,
  });
  expect(copyCellFormat({ bl: 0, cl: null, n: { pattern: "General" } })).toEqual({
    bold: false,
    color: null,
    numberFormat: null,
  });

  expect(applyCopiedCellFormat(plain, copyCellFormat(null))).toEqual(plain);
  expect(
    applyCopiedCellFormat(plain, {
      bold: false,
      color: null,
      numberFormat: null,
    }),
  ).toEqual(plain);
  expect(applyCopiedCellFormat(plain, null)).toEqual(plain);

  const painted = {
    value: 12,
    bold: true,
    color: blue,
    numberFormat: currency,
  };
  expect(
    applyCopiedCellFormat(painted, {
      bold: false,
      color: null,
      numberFormat: null,
    }),
  ).toEqual(painted);
  expect(painted.value).toBe(12);
});
