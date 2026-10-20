import { Fragment } from "react";
import { MenuItem } from "../ui";

export type ChartMenuEntry = { id: string; title: string; invalid: boolean };
export type PivotMenuEntry = ChartMenuEntry & { stale: boolean };

/** Charts and pivots, opened from the Data menu instead of a toolbar button. */
export function ChartPivotMenu({
  load,
  onEdit,
  onDeleteChart,
  onRefresh,
  onCopy,
}: {
  load: () => { charts: ChartMenuEntry[]; pivots: PivotMenuEntry[] };
  onEdit: (kind: "chart" | "pivot", id: string) => void;
  onDeleteChart: (id: string) => void;
  onRefresh: (id: string) => void;
  onCopy: (id: string) => void;
}) {
  const { charts, pivots } = load();
  if (!charts.length && !pivots.length) {
    return (
      <MenuItem disabled onSelect={() => {}}>
        None yet
      </MenuItem>
    );
  }
  return (
    <>
      {charts.map((chart) => (
        <Fragment key={chart.id}>
          <MenuItem onSelect={() => onEdit("chart", chart.id)}>
            {chart.invalid ? `${chart.title} · source missing` : chart.title}
          </MenuItem>
          <MenuItem onSelect={() => onDeleteChart(chart.id)}>
            {`Delete ${chart.title}`}
          </MenuItem>
        </Fragment>
      ))}
      {pivots.map((pivot) => (
        <Fragment key={pivot.id}>
          <MenuItem onSelect={() => onEdit("pivot", pivot.id)}>
            {pivot.invalid
              ? `${pivot.title} · source missing`
              : pivot.stale
                ? `${pivot.title} · not updated`
                : pivot.title}
          </MenuItem>
          <MenuItem onSelect={() => onRefresh(pivot.id)}>
            {`Refresh ${pivot.title}`}
          </MenuItem>
          <MenuItem onSelect={() => onCopy(pivot.id)}>
            {`Copy ${pivot.title}`}
          </MenuItem>
        </Fragment>
      ))}
    </>
  );
}
