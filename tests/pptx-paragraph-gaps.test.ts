import { expect, it } from "vitest";
import { lastSpacingPoints, paragraphGapPoints, exactLineFactor, runTracking } from "../packages/core/src/pptx-kerning";

it("keeps authored point gaps while percentage gaps follow the fitted font", () => {
  const pts = '<a:spcBef><a:spcPts val="1000"/></a:spcBef>';
  const pct = '<a:spcBef><a:spcPct val="50000"/></a:spcBef>';
  expect(paragraphGapPoints(pts, "spcBef", 26)).toBe(10);
  expect(paragraphGapPoints(pts, "spcBef", 13)).toBe(10);
  expect(paragraphGapPoints(pct, "spcBef", 26)).toBe(15.6);
  expect(paragraphGapPoints(pct, "spcBef", 13)).toBe(7.8);
  expect(paragraphGapPoints(pts + pct, "spcBef", 26)).toBe(15.6);
  expect(paragraphGapPoints(pct + pts, "spcBef", 26)).toBe(10);
  expect(paragraphGapPoints("", "spcBef", 20)).toBeUndefined();
  expect(paragraphGapPoints(pct, "spcBef", 0)).toBe(0);
  expect(paragraphGapPoints('<a:spcBef><a:spcPts val="0"/></a:spcBef>', "spcBef", 20)).toBe(0);
  expect(paragraphGapPoints('<a:spcBef><a:spcPct val="99999999"/></a:spcBef>', "spcBef", 20)).toBe(200);
  const invalid = `<a:spcAft><a:spcPts val="${"9".repeat(400)}"/></a:spcAft>`;
  expect(paragraphGapPoints(invalid, "spcAft", 20)).toBeUndefined();
  expect(lastSpacingPoints(invalid, "spcAft")).toBeUndefined();
  expect(lastSpacingPoints("", "spcBef")).toBeUndefined();
  expect(lastSpacingPoints(pts + '<a:spcBef><a:spcPts val="2000"/></a:spcBef>', "spcBef")).toBe(20);
  expect(exactLineFactor("-100", 20)).toBeUndefined();
  expect(exactLineFactor("bad", 20)).toBeUndefined();
  expect(exactLineFactor("1000", 0)).toBeUndefined();
  expect(runTracking("0")).toBeUndefined();
  expect(runTracking("bad")).toBeUndefined();
});
