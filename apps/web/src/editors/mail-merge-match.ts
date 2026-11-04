/** A plain decimal, or null when the text is not one. `1e2` and `10 beds` are not plain decimals. */

export function plainMergeNumber(value: string): number | null {
  const text = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/** Whether two merge values are the same. Plain numbers written two ways match. Other text must match exactly. */

export function sameWritten(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  const left = plainMergeNumber(actual);
  const right = plainMergeNumber(expected);
  return left !== null && right !== null && left === right;
}
