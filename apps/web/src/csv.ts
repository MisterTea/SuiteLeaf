/** Infer ordinary numbers without executing formulas or losing identifier precision. */
export function csvCell(value: string): {
  v: string | number | boolean;
  t: number;
} {
  if (/^(TRUE|FALSE)$/.test(value)) return { v: value === "TRUE", t: 3 };
  if (/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    const number = Number(value),
      digits = value.replace(/[eE].*$/, "").replace(/\D/g, "").length;
    if (
      Number.isFinite(number) &&
      digits <= 15 &&
      (!Number.isInteger(number) || Number.isSafeInteger(number))
    )
      return { v: number, t: 2 };
  }
  return { v: value, t: 1 };
}
