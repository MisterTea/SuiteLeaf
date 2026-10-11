import { expect, test } from "vitest";
import {
  NUMBER_FORMATS,
  numberFormatById,
  numberFormatsByGroup,
  isValidFormatCode,
  applyNamedFormat,
  type FormatGroup,
} from "../apps/web/src/formats";

test("catalog entries are non-empty, well-formed and unique", () => {
  const ids = new Set<string>();
  const codes = new Set<string>();
  for (const f of NUMBER_FORMATS) {
    expect(f.id).toBeTruthy();
    expect(f.label).toBeTruthy();
    expect(f.code.length).toBeGreaterThan(0);
    expect(isValidFormatCode(f.code)).toBe(true);
    expect(["Number", "Percent", "Date & time"]).toContain(f.group);
    expect(ids.has(f.id)).toBe(false);
    ids.add(f.id);
    codes.add(f.code);
  }
  // Every entry has a distinct code so applying one never clobbers another.
  expect(codes.size).toBe(NUMBER_FORMATS.length);
});

test("every catalog entry resolves by id and its code is valid", () => {
  for (const f of NUMBER_FORMATS) {
    const found = numberFormatById(f.id);
    expect(found).toBeDefined();
    expect(found!.code).toBe(f.code);
  }
  expect(numberFormatById("does-not-exist")).toBeUndefined();
});

test("grouping partitions the catalog into Number / Percent / Date & time", () => {
  const grouped = numberFormatsByGroup();
  const groups: FormatGroup[] = ["Number", "Percent", "Date & time"];
  const all = groups.flatMap((g) => grouped[g]);
  expect(all.length).toBe(NUMBER_FORMATS.length);
  expect(grouped.Number.length).toBeGreaterThan(0);
  expect(grouped.Percent.length).toBeGreaterThan(0);
  expect(grouped["Date & time"].length).toBeGreaterThan(0);
  // Each group is non-overlapping.
  const ids = new Set(all.map((f) => f.id));
  expect(ids.size).toBe(all.length);
});

test("applyNamedFormat applies the code for known ids and rejects unknown/empty", () => {
  const applied: string[] = [];
  const apply = (code: string) => applied.push(code);

  const r1 = applyNamedFormat("currency", apply);
  expect(r1).toEqual({ ok: true, code: '"$"#,##0' });

  const r2 = applyNamedFormat("dateShort", apply);
  expect(r2.ok).toBe(true);
  expect(r2.code).toBe("mm/dd/yyyy");

  expect(applyNamedFormat("nope", apply)).toEqual({ ok: false });
  expect(applied.length).toBe(2); // unknown id must not call apply
});

test("format codes are Excel/Univer compatible (no empty or whitespace code)", () => {
  for (const f of NUMBER_FORMATS) {
    expect(isValidFormatCode(f.code.trim())).toBe(true);
    expect(f.code).not.toMatch(/^\s+$/);
  }
  expect(isValidFormatCode("")).toBe(false);
  expect(isValidFormatCode("   ")).toBe(false);
  expect(isValidFormatCode(null)).toBe(false);
});
