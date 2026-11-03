import {
  capacityDecision,
  expensiveFormulas,
  inspectSheetCost,
  slowestPhaseNote,
  volatileFormulaAddresses,
  type SheetCostInput,
  type SheetFile,
} from "@suiteleaf/core";

/** Sheets in workbook order, for a cost scan. Cell values stay on the workbook. */
export function costSheets(content: SheetFile["content"]): SheetCostInput[] {
  const charts = content.charts ?? [];
  return content.workbook.sheetOrder.map((id) => {
    const sheet = content.workbook.sheets[id] as
      | {
          name?: string;
          cellData?: SheetCostInput["cellData"];
          conditionalFormats?: unknown[];
        }
      | undefined;
    return {
      name: sheet?.name?.trim() || "Sheet",
      cellData: sheet?.cellData,
      conditionalFormats: Array.isArray(sheet?.conditionalFormats)
        ? sheet.conditionalFormats
        : [],
      charts: charts.filter((chart) => chart.sheetId === id),
    };
  });
}

/** Counts and the largest measured part. Recalculation time is not included. */
export function SheetCostNote({
  content,
  onOpenQuery,
  phases,
}: {
  content: SheetFile["content"];
  onOpenQuery?: () => void;
  phases?: readonly { name: string; elapsedMs: number; skipped?: boolean; failed?: boolean }[];
}) {
  const report = inspectSheetCost(costSheets(content));
  if (report.cancelled) return null;
  const several = content.workbook.sheetOrder.length > 1;
  const labelFor = (id: string) => {
    const sheet = content.workbook.sheets[id] as { name?: string } | undefined;
    const raw = sheet?.name ?? "";
    const name = raw.trim();
    if (!name) return "Sheet";
    if (/[\r\n]/.test(raw)) return "another sheet";
    if (/password|secret|token|authorization|api[-_]?key|credential/i.test(name)) return "another sheet";
    return name;
  };
  const volatile = content.workbook.sheetOrder.flatMap((id) => {
    const sheet = content.workbook.sheets[id] as { cellData?: SheetCostInput["cellData"] } | undefined;
    const addresses = volatileFormulaAddresses(sheet?.cellData);
    return several ? addresses.map((address) => `${labelFor(id)} ${address}`) : addresses;
  });
  const wide = content.workbook.sheetOrder.flatMap((id) => {
    const sheet = content.workbook.sheets[id] as { cellData?: SheetCostInput["cellData"] } | undefined;
    return expensiveFormulas(sheet?.cellData ?? {}).map((item) =>
      several ? { ...item, address: `${labelFor(id)} ${item.address}` } : item,
    );
  });
  return (
    <section className="access-notes" aria-label="Spreadsheet cost">
      <h2>Spreadsheet cost</h2>
      <p>
        {report.sheets} sheets, {report.cells} cells, {report.formulas} formulas,{" "}
        {report.volatileFormulas} volatile, {report.conditionalFormats} rules,{" "}
        {report.charts} charts. The walk took {report.elapsedMs} ms.
      </p>
      <p>{report.dominant.action}</p>
      <p>
        {volatile.length
          ? `Volatile formulas: ${volatile.join(", ")}.`
          : "No volatile formula."}{" "}
        {wide.length
          ? `Wide formulas: ${wide.map((item) => `${item.address} names ${item.refs} cells`).join(", ")}.`
          : "No formula names 64 cells or more."}
      </p>
      <p>{capacityDecision(report.cells).notice}</p>
      {onOpenQuery &&
      (capacityDecision(report.cells).tier === "large" ||
        capacityDecision(report.cells).tier === "beyond") ? (
        <button type="button" onClick={onOpenQuery}>
          Open the query panel
        </button>
      ) : null}
      <p>
        {phases
          ? slowestPhaseNote(phases)
          : "This pass does not time recalculation, import, or painting."}
      </p>
    </section>
  );
}
