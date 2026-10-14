/**
 * Words on the sheet border control, in the order Nia sees them.
 * `type` is the Univer BorderType member (BOTTOM, OUTSIDE, ALL, NONE).
 * Applying a kind still goes through the range API; this list is only the words.
 */
export const sheetBorderKinds = [
  { label: "Bottom", type: "BOTTOM" },
  { label: "Outside", type: "OUTSIDE" },
  { label: "All", type: "ALL" },
  { label: "None", type: "NONE" },
] as const;

export type SheetBorderTypeName = (typeof sheetBorderKinds)[number]["type"];

/**
 * Each word replaces the selection's borders.
 * None only clears. The others clear first so a previous All or Bottom
 * cannot leave lines the new word did not ask for.
 */
export function borderTypesToApply(
  type: SheetBorderTypeName,
): SheetBorderTypeName[] {
  return type === "NONE" ? ["NONE"] : ["NONE", type];
}

type BorderEdge = { s?: number | null } | null | undefined;

/** Sides that draw a line. Null and zero-width edges are clear. Order is t, r, b, l. */
export function visibleBorderSides(
  border:
    | {
        t?: BorderEdge;
        r?: BorderEdge;
        b?: BorderEdge;
        l?: BorderEdge;
      }
    | null
    | undefined,
): string {
  if (!border) return "";
  return (["t", "r", "b", "l"] as const)
    .filter((side) => {
      const edge = border[side];
      return !!edge && Number(edge.s) > 0;
    })
    .join("");
}
