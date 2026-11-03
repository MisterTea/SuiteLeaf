/**
 * Two source columns for a pivot difference. A bad choice does not repeat the name.
 */
export function pivotDifferenceFromForm(input: {
  name: string;
  left: number;
  right: number;
  columnCount: number;
}): { name: string; left: number; right: number } | undefined {
  const name = input.name.replace(/[\r\n]/g, " ").replace(/\s+/g, " ").trim();
  if (!name) return undefined;
  if (
    name.length > 40 ||
    !Number.isInteger(input.left) ||
    !Number.isInteger(input.right) ||
    input.left < 0 ||
    input.right < 0 ||
    input.left >= input.columnCount ||
    input.right >= input.columnCount ||
    input.left === input.right
  ) {
    throw new Error("Choose two columns for the calculated field.");
  }
  return { name, left: input.left, right: input.right };
}

export function PivotDifferenceFields({
  name,
  left,
  right,
  fields,
  onName,
  onLeft,
  onRight,
}: {
  name: string;
  left: number;
  right: number;
  fields: readonly unknown[];
  onName: (name: string) => void;
  onLeft: (column: number) => void;
  onRight: (column: number) => void;
}) {
  const column = (value: number, label: string, change: (column: number) => void) => (
    <label>
      {label}
      <select aria-label={label} value={value} onChange={(event) => change(Number(event.target.value))}>
        <option value={-1}>Choose a column</option>
        {fields.map((field, index) => (
          <option key={index} value={index}>
            {String(field)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <label>
        Subtract columns
        <input
          aria-label="Subtract columns"
          value={name}
          placeholder="Margin"
          onChange={(event) => onName(event.target.value)}
        />
      </label>
      {column(left, "Left column", onLeft)}
      {column(right, "Right column", onRight)}
    </>
  );
}
