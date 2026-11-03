import { tableRangeLabel, type SheetTable } from "@suiteleaf/core";

/** The named tables on this spreadsheet. The painted grid is not this list. */
export function SheetTableNote({ tables }: { tables: SheetTable[] }) {
  if (!tables.length) return null;
  return (
    <section className="sheet-tables" aria-label="Sheet tables">
      <h2>Tables</h2>
      <ul>
        {tables.map((table) => (
          <li key={`${table.sheetId}:${table.name}`}>{tableRangeLabel(table)}</li>
        ))}
      </ul>
    </section>
  );
}
