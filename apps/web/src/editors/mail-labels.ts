/** A print box in points, origin at the top left of the page. */
export type PrintBox = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Avery 5160: 30 labels on a US Letter sheet. Sizes are points. */
export const AVERY_5160 = {
  id: "avery-5160",
  name: "Avery 5160",
  pageWidth: 612,
  pageHeight: 792,
  columns: 3,
  rows: 10,
  labelWidth: 189,
  labelHeight: 72,
  marginLeft: 14,
  marginTop: 36,
  gapX: 9,
  gapY: 0,
} as const;

/** A #10 envelope. The return address and the recipient do not share a box. */
export const ENVELOPE_10 = {
  id: "envelope-10",
  name: "Envelope #10",
  pageWidth: 684,
  pageHeight: 297,
  returnAddress: { page: 0, x: 36, y: 28, width: 240, height: 72 },
  recipient: { page: 0, x: 306, y: 126, width: 342, height: 108 },
} as const;

const LINE = 14;
const PADDING = 8;

export function boxesOverlap(a: PrintBox, b: PrintBox): boolean {
  if (a.page !== b.page) return false;
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

export function boxInside(pageWidth: number, pageHeight: number, box: PrintBox): boolean {
  return (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= pageWidth &&
    box.y + box.height <= pageHeight
  );
}

/** One box per address, 30 to a sheet. The template is not changed. */
export function layoutLabels(count: number): PrintBox[] {
  const per = AVERY_5160.columns * AVERY_5160.rows;
  const boxes: PrintBox[] = [];
  for (let index = 0; index < count; index += 1) {
    const slot = index % per;
    const column = slot % AVERY_5160.columns;
    const row = Math.floor(slot / AVERY_5160.columns);
    boxes.push({
      page: Math.floor(index / per),
      x: AVERY_5160.marginLeft + column * (AVERY_5160.labelWidth + AVERY_5160.gapX),
      y: AVERY_5160.marginTop + row * (AVERY_5160.labelHeight + AVERY_5160.gapY),
      width: AVERY_5160.labelWidth,
      height: AVERY_5160.labelHeight,
    });
  }
  return boxes;
}

export function labelLineLimit(): number {
  return Math.floor((AVERY_5160.labelHeight - PADDING) / LINE);
}

export function envelopeLineLimit(): number {
  return Math.floor((ENVELOPE_10.recipient.height - PADDING) / LINE);
}

function sheetProblem(boxes: PrintBox[]): string | null {
  for (const box of boxes) {
    if (!boxInside(AVERY_5160.pageWidth, AVERY_5160.pageHeight, box)) {
      return "A label leaves the page.";
    }
  }
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      if (boxesOverlap(boxes[left], boxes[right])) return "Two labels overlap.";
    }
  }
  return null;
}

export type PlacedAddress = PrintBox & { lines: string[] };

/** Place each address on Avery 5160. An address that is too tall is not clipped. */
export function placeLabels(
  addresses: readonly (readonly string[])[],
): { ok: true; placed: PlacedAddress[] } | { ok: false; message: string } {
  const limit = labelLineLimit();
  const cleaned = addresses.map((lines) => lines.map((line) => line.trim()).filter(Boolean));
  for (let index = 0; index < cleaned.length; index += 1) {
    const lines = cleaned[index];
    if (lines.length > limit) {
      const who = lines[0] || `Address ${index + 1}`;
      return { ok: false, message: `${who} does not fit a label. A label holds ${limit} lines.` };
    }
  }
  const boxes = layoutLabels(cleaned.length);
  const problem = sheetProblem(boxes);
  if (problem) return { ok: false, message: problem };
  return {
    ok: true,
    placed: boxes.map((box, index) => ({ ...box, lines: cleaned[index] })),
  };
}

/** One envelope. The two addresses stay in their boxes and on the page. */
export function placeEnvelope(
  returnLines: readonly string[],
  recipientLines: readonly string[],
): { ok: true; returnAddress: PlacedAddress; recipient: PlacedAddress } | { ok: false; message: string } {
  const sender = returnLines.map((line) => line.trim()).filter(Boolean);
  const recipient = recipientLines.map((line) => line.trim()).filter(Boolean);
  const returnLimit = Math.floor((ENVELOPE_10.returnAddress.height - PADDING) / LINE);
  const recipientLimit = envelopeLineLimit();
  if (sender.length > returnLimit) {
    return { ok: false, message: `The return address does not fit. That box holds ${returnLimit} lines.` };
  }
  if (recipient.length > recipientLimit) {
    const who = recipient[0] || "The recipient";
    return { ok: false, message: `${who} does not fit the envelope. That box holds ${recipientLimit} lines.` };
  }
  const returnBox = ENVELOPE_10.returnAddress;
  const recipientBox = ENVELOPE_10.recipient;
  if (
    !boxInside(ENVELOPE_10.pageWidth, ENVELOPE_10.pageHeight, returnBox) ||
    !boxInside(ENVELOPE_10.pageWidth, ENVELOPE_10.pageHeight, recipientBox)
  ) {
    return { ok: false, message: "An address leaves the envelope." };
  }
  if (boxesOverlap(returnBox, recipientBox)) {
    return { ok: false, message: "The return address overlaps the recipient." };
  }
  return {
    ok: true,
    returnAddress: { ...returnBox, lines: sender },
    recipient: { ...recipientBox, lines: recipient },
  };
}

/** Spreadsheet columns, in order, become the lines of one address. */
export function addressFromRow(headers: readonly string[], row: readonly string[]): string[] {
  return headers.map((header, index) => (header.trim() ? (row[index] ?? "").trim() : "")).filter(Boolean);
}
