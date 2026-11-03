import { useState } from "react";
import { rowsFromCsv, rowsFromJson, type QueryRow } from "@suiteleaf/core";

/** Read a local CSV or JSON table. The status does not include the file name or a cell. */
export function LocalQueryFile({
  onRows,
}: {
  onRows: (rows: QueryRow[]) => string | void;
}) {
  const [status, setStatus] = useState("");
  return (
    <label>
      Local table
      <input
        aria-label="Local table file"
        type="file"
        accept=".csv,.json,text/csv,application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const format = file.name.toLowerCase().endsWith(".json") ? "json" : "csv";
          void file
            .text()
            .then((text) => {
              const loaded = format === "json" ? rowsFromJson(text) : rowsFromCsv(text);
              if (!loaded.ok) {
                setStatus(loaded.error);
                return;
              }
              let note: string | void;
              try {
                note = onRows(loaded.rows);
              } catch {
                setStatus("That file is not a table of text.");
                return;
              }
              setStatus(
                note ||
                  (loaded.rows.length === 1
                    ? "The table has 1 row."
                    : `The table has ${loaded.rows.length} rows.`),
              );
            })
            .catch(() => setStatus("That file is not a table of text."));
        }}
      />
      {status ? <p role="status">{status}</p> : null}
    </label>
  );
}
