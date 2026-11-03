import { describe, expect, it } from "vitest";
import {
  AVERY_5160,
  ENVELOPE_10,
  addressFromRow,
  boxInside,
  boxesOverlap,
  envelopeLineLimit,
  labelLineLimit,
  layoutLabels,
  placeEnvelope,
  placeLabels,
} from "../apps/web/src/editors/mail-labels";

describe("label and envelope templates", () => {
  it("keeps thirty Avery 5160 labels on the page and apart", () => {
    const boxes = layoutLabels(30);
    expect(boxes).toHaveLength(30);
    expect(boxes.every((box) => box.page === 0)).toBe(true);
    expect(boxes.every((box) => boxInside(AVERY_5160.pageWidth, AVERY_5160.pageHeight, box))).toBe(true);
    for (let left = 0; left < boxes.length; left += 1) {
      for (let right = left + 1; right < boxes.length; right += 1) {
        expect(boxesOverlap(boxes[left], boxes[right])).toBe(false);
      }
    }
    expect(layoutLabels(31)[30].page).toBe(1);
    const placed = placeLabels([
      ["Rosa Garcia", "12 North bed"],
      ["Ada Lovelace", "4 South path"],
    ]);
    expect(placed.ok).toBe(true);
    if (placed.ok) expect(placed.placed.map((box) => box.lines[0])).toEqual(["Rosa Garcia", "Ada Lovelace"]);
  });

  it("refuses an address that is taller than a label", () => {
    const lines = Array.from({ length: labelLineLimit() + 1 }, (_, index) => `Line ${index + 1}`);
    const placed = placeLabels([lines]);
    expect(placed.ok).toBe(false);
    if (!placed.ok) expect(placed.message).toBe("Line 1 does not fit a label. A label holds 4 lines.");
  });

  it("keeps the return address and the recipient on a #10 envelope", () => {
    const placed = placeEnvelope(["Garden desk"], ["Rosa Garcia", "12 North bed", "Town"]);
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(boxInside(ENVELOPE_10.pageWidth, ENVELOPE_10.pageHeight, placed.returnAddress)).toBe(true);
    expect(boxInside(ENVELOPE_10.pageWidth, ENVELOPE_10.pageHeight, placed.recipient)).toBe(true);
    expect(boxesOverlap(placed.returnAddress, placed.recipient)).toBe(false);
    expect(placed.recipient.lines).toEqual(["Rosa Garcia", "12 North bed", "Town"]);
    const tooTall = Array.from({ length: envelopeLineLimit() + 1 }, (_, index) => `Line ${index + 1}`);
    const refused = placeEnvelope(["Garden desk"], tooTall);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toContain("does not fit the envelope");
  });

  it("reads address lines from the spreadsheet columns", () => {
    expect(addressFromRow(["Name", "Street", ""], ["Rosa", "12 North bed", "secret-value"])).toEqual([
      "Rosa",
      "12 North bed",
    ]);
  });
});
