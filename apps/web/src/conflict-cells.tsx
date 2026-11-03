import { useState } from "react";

/** Ask which cells to copy from the other spreadsheet. The status does not repeat the address. */
export function ConflictCells({
  onTake,
}: {
  onTake: (addresses: string[]) => Promise<string | null>;
}) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState("");
  return (
    <span className="drive-conflict-cells">
      <input
        aria-label="Cells to take from SuiteDrive"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button
        type="button"
        onClick={() => {
          const addresses = text.split(/[\s,]+/).filter((part) => part.length > 0);
          void onTake(addresses)
            .then((reason) => {
              setStatus(reason ?? "Those cells were taken from the other copy.");
            })
            .catch(() => {
              setStatus("Those cells were not taken.");
            });
        }}
      >
        Take these cells
      </button>
      {status ? <p role="status">{status}</p> : null}
    </span>
  );
}
