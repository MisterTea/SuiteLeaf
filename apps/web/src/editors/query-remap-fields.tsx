import { useState } from "react";

/** Map a missing column name onto a column that is still in the source. */
export function QueryRemap({
  disabled,
  onRemap,
}: {
  disabled: boolean;
  onRemap: (from: string, to: string) => string;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  return (
    <div>
      <label>
        Old column
        <input aria-label="Old column" value={from} onChange={(event) => setFrom(event.target.value)} />
      </label>
      <label>
        New column
        <input aria-label="New column" value={to} onChange={(event) => setTo(event.target.value)} />
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setNote(onRemap(from, to))}
      >
        Use this column instead
      </button>
      {note ? <p>{note}</p> : null}
    </div>
  );
}
