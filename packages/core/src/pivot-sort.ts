/** How the pivot dialog names a row-order choice. An empty choice is labels A to Z. */

export type PivotSort = { by: "label" | "value"; direction: "asc" | "desc" };

export function pivotSortFromForm(choice: string): PivotSort | undefined {
  if (choice === "label-desc") return { by: "label", direction: "desc" };
  if (choice === "value-desc") return { by: "value", direction: "desc" };
  if (choice === "value-asc") return { by: "value", direction: "asc" };
  return undefined;
}

export function pivotSortChoice(sort: PivotSort | undefined): string {
  if (!sort) return "";
  if (sort.by === "label" && sort.direction === "desc") return "label-desc";
  if (sort.by === "value" && sort.direction === "desc") return "value-desc";
  if (sort.by === "value" && sort.direction === "asc") return "value-asc";
  return "";
}
