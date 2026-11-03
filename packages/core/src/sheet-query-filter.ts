import { joinKey } from "./sheet-query-order";

/** Whether one cell stays after a filter step. `ne` keeps every other value. `contains` keeps a cell that includes the text. A blank search keeps only a blank cell. Two plain numbers match. */
export function filterKeeps(
  value: string,
  equals: string,
  match?: "eq" | "ne" | "contains",
): boolean {
  if (match === "contains") return equals === "" ? value === "" : value.includes(equals);
  const same = joinKey(value) === joinKey(equals);
  return match === "ne" ? !same : same;
}
