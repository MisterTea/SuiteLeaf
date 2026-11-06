/** Cell mutations contain partial properties; preserve the existing value and style. */
export function mergeSheetCellPatch(previous: string | undefined, json: string, overrideStyle: boolean): string {
  const patch = JSON.parse(json);
  if (!previous || !patch || typeof patch !== "object") return json;
  const old = JSON.parse(previous);
  const next = { ...old, ...patch };
  if (patch.s && typeof patch.s === "object" && !overrideStyle) {
    next.s = { ...(old?.s ?? {}), ...patch.s };
  }
  return JSON.stringify(next);
}
