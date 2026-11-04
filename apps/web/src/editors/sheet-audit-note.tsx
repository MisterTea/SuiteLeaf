import { useState } from "react";
import {
  auditFormula,
  cellsToRecalculate,
  evaluationTrace,
  nextFormulaError,
  recalculateAcrossSheets,
  recalculateDirty,
  structuredSource,
  type SheetFile,
} from "@suiteleaf/core";

/** Precedents and dependents for one cell. Cell values are not shown. */
export function SheetAuditNote({ content }: { content: SheetFile["content"] }) {
  const [address, setAddress] = useState("A1");
  const [asked, setAsked] = useState("A1");
  const id = content.workbook.sheetOrder[0];
  const sheet = content.workbook.sheets[id];
  const structured = structuredSource(id, content.tables, sheet?.cellData);
  const audit = auditFormula({ cellData: sheet?.cellData }, asked, {
    name: sheet?.name || "Sheet1",
    others: content.workbook.sheetOrder
      .filter((sheetId) => sheetId !== id)
      .flatMap((sheetId) => {
        const other = content.workbook.sheets[sheetId];
        return other ? [{ name: other.name, cellData: other.cellData }] : [];
      }),
  });
  const recalc = cellsToRecalculate({ cellData: sheet?.cellData }, asked, structured);
  const calculated = recalculateDirty({ cellData: sheet?.cellData }, asked, structured);
  const across = recalculateAcrossSheets(
    content.workbook.sheetOrder.flatMap((sheetId) => {
      const item = content.workbook.sheets[sheetId];
      return item ? [{ name: item.name, cellData: item.cellData }] : [];
    }),
    `${sheet?.name || "Sheet1"}!${asked}`,
  );
  const home = `${sheet?.name || "Sheet1"}!`;
  const otherCalculated = across.calculated
    .map((address) => (address.startsWith(home) ? address.slice(home.length) : address))
    .filter((address) => address.includes("!"));
  const nextError = nextFormulaError(
    { cellData: sheet?.cellData },
    asked,
    content.workbook.sheetOrder
      .filter((sheetId) => sheetId !== id)
      .flatMap((sheetId) => {
        const other = content.workbook.sheets[sheetId];
        return other ? [{ name: other.name, cellData: other.cellData }] : [];
      }),
  );
  const traced = evaluationTrace(
    { cellData: sheet?.cellData },
    asked,
    content.workbook.sheetOrder.flatMap((sheetId) => {
      const item = content.workbook.sheets[sheetId];
      return item?.name ? [{ name: item.name, cellData: item.cellData }] : [];
    }),
  );
  const listed = recalc.cells.join(", ") || "none";
  const done = calculated.calculated.join(", ") || "none";
  const skipped = calculated.left.join(", ") || "none";
  return (
    <section className="access-notes" aria-label="Formula audit">
      <h2>Formula audit</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setAsked(address);
        }}
      >
        <label>
          Cell
          <input
            aria-label="Audit cell"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </label>
        <button type="submit">Show references</button>
        <button
          type="button"
          onClick={() => {
            if (!nextError.address) return;
            setAddress(nextError.address);
            if (!nextError.address.includes("!")) setAsked(nextError.address);
          }}
        >
          Next error
        </button>
      </form>
      <p>Precedents: {audit.precedents.join(", ") || "none"}.</p>
      <p>Dependents: {audit.dependents.join(", ") || "none"}.</p>
      <p>{audit.trace}</p>
      {audit.cycle ? <p>{audit.cycle}</p> : null}
      {audit.error ? <p>Error {audit.error} at {audit.address}.</p> : null}
      <p>
        Recalculate: {listed}.{recalc.unlisted ? " One formula uses a range that is too large to list." : ""}
      </p>
      <p>{nextError.note}</p>
      <p>
        Calculated: {done}. Left: {skipped}.
        {otherCalculated.length ? ` Other sheets: ${otherCalculated.join(", ")}.` : ""}
      </p>
      <p>Evaluation: {traced.note}</p>
      <p>
        This pass calculates a direct reference, a small sum, average, count, minimum, or maximum, a
        round, an absolute value, a whole number rounded down, a square root, a remainder, a power, the opposite of one cell, the length of one cell, trimmed text from one cell, characters from the start, end, or middle of text, joined text, a number formatted as text, lower case text from one cell, capital text from one cell, whether both of two cells are true, whether either of two cells is true, a fallback when a cell is an error, an exact lookup down a column or across a row, an exact lookup in a second range, a product of a small range, the median of a small range, a count of filled cells, a sum of the rows that match, a count of the rows that match, a count of the rows that match every condition, an average of the rows that match, a sum of the rows that match every condition, an average of the rows that match every condition, a cell picked by position, an exact match position, the year, month, and day of a date, a date built from three numbers, today's date, the current time, a random number, a random whole number, a cell offset from another, a cell named by text, a value from the first true cell, a comparison of a cell with a number or another cell, a comparison inside AND, OR, NOT, and IFS, a written criterion such as greater than a number, or the word Pass, and a choice between two cells. It does not show cell values.
      </p>
    </section>
  );
}
