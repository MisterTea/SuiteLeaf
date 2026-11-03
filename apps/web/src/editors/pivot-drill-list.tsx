import { drillGroupRows, type PivotSlice } from "@suiteleaf/core";

type Cell = string | number | boolean | null;

/** The source rows for one grouped pivot total. The note does not repeat the typed group. */
export function PivotDrillList({
  values,
  slice,
  group,
  onGroup,
}: {
  values: Cell[][];
  slice: PivotSlice;
  group: string;
  onGroup: (group: string) => void;
}) {
  const view = drillGroupRows(values, slice, group);
  return (
    <>
      <label>
        Show source rows
        <input
          aria-label="Show source rows"
          value={group}
          onChange={(event) => onGroup(event.target.value)}
        />
      </label>
      <p>{view.note}</p>
      <ul>
        {view.rows.slice(1).map((row, index) => (
          <li key={index}>{row.map((cell) => String(cell ?? "")).join(", ")}</li>
        ))}
      </ul>
    </>
  );
}
