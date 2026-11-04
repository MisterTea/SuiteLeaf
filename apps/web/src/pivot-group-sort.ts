/** Keep each group's detail rows together, ordered by the group total. */

export function orderGroupsByTotal(
  rows: string[],
  groupOf: (row: string) => string,
  totalOf: (group: string) => unknown,
  direction: "asc" | "desc",
  tie: (left: string, right: string) => number,
): string[] {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const group = groupOf(row);
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  const dir = direction === "desc" ? -1 : 1;
  return [...groups.entries()]
    .sort(([left], [right]) => {
      const leftTotal = Number(totalOf(left));
      const rightTotal = Number(totalOf(right));
      const delta =
        (Number.isFinite(leftTotal) ? leftTotal : 0) - (Number.isFinite(rightTotal) ? rightTotal : 0);
      return delta ? delta * dir : tie(left, right);
    })
    .flatMap(([, members]) => members);
}
