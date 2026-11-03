import { assignComboAxes, chartSummary, checkSheetGrid, formulaErrorNotes, seriesFromHeaders, type SheetA11yGrid, type SheetFile } from "@suiteleaf/core";

export function sheetHeaderNotes(content: SheetFile["content"]): {
  sheetId: string;
  sheet: string;
  message: string;
  column: number;
}[] {
  return content.workbook.sheetOrder.flatMap((id) => {
    const sheet = content.workbook.sheets[id];
    const grid = (sheet?.cellData ?? {}) as SheetA11yGrid;
    const name = sheet?.name?.trim() || "Sheet";
    return checkSheetGrid(grid).map((finding) => ({
      sheetId: id,
      sheet: name,
      message: finding.message,
      column: finding.column,
    }));
  });
}

function headerText(cell: unknown): string {
  const value =
    cell && typeof cell === "object" && "v" in cell ? (cell as { v?: unknown }).v : cell;
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "";
}

function comboSeries(chart: SheetFile["content"]["charts"][number], content: SheetFile["content"]) {
  const stored = chart.excel?.series;
  if (stored?.some((item) => item.axis === 2)) return stored;
  if (stored?.length) return assignComboAxes(stored);
  const sheet = content.workbook.sheets[chart.source.sheetId];
  const row = (sheet?.cellData as SheetA11yGrid | undefined)?.[String(chart.source.startRow)] ?? {};
  const headers: string[] = [];
  for (let column = chart.source.startColumn; column <= chart.source.endColumn; column += 1) {
    headers.push(headerText(row[String(column)]));
  }
  return seriesFromHeaders(headers);
}

export function SheetAccessNote({
  content,
  onSelect,
}: {
  content: SheetFile["content"];
  onSelect?: (sheetId: string, column: number, row?: number) => void;
}) {
  const notes = sheetHeaderNotes(content);
  const errors = content.workbook.sheetOrder.flatMap((id) => {
    const sheet = content.workbook.sheets[id];
    const grid = (sheet?.cellData ?? {}) as SheetA11yGrid;
    const name = sheet?.name?.trim() || "Sheet";
    return formulaErrorNotes(grid).map((finding) => ({
      sheetId: id,
      sheet: name,
      ...finding,
    }));
  });
  const charts = content.charts.map((chart) => ({
    id: chart.id,
    summary: chartSummary({
      title: chart.title,
      type: chart.type,
      invalid: chart.invalid,
      series: chart.type === "combo" ? comboSeries(chart, content) : chart.excel?.series,
      categories: chart.excel?.biff?.categories,
      legend: chart.excel?.legend,
    }),
  }));
  return (
    <section className="access-notes" aria-label="Spreadsheet accessibility">
      <h2>Spreadsheet accessibility</h2>
      {charts.map((chart) => (
        <p key={chart.id}>{chart.summary}</p>
      ))}
      {notes.length === 0 && errors.length === 0 ? (
        <p>No notes for this spreadsheet.</p>
      ) : (
        <ul>
          {notes.map((note) => (
            <li key={`${note.sheetId}-header-${note.column}`}>
              <button type="button" onClick={() => onSelect?.(note.sheetId, note.column, 0)}>
                {note.sheet}: {note.message}
              </button>
            </li>
          ))}
          {errors.map((note) => (
            <li key={`${note.sheetId}-error-${note.address}`}>
              <button type="button" onClick={() => onSelect?.(note.sheetId, note.column, note.row)}>
                {note.sheet}: {note.message}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p>This is not a WCAG claim.</p>
    </section>
  );
}
