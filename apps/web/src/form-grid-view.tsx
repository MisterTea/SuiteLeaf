import { encodeGridAnswer, formatGridAnswer, gridSelection } from "./form-grid";

/** Each row is a radio group of the columns, so one column can be chosen per row. */
export function GridAnswer({
  questionId,
  rows,
  columns,
  value,
  disabled,
  onChange,
}: {
  questionId: string;
  rows: string[];
  columns: string[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  if (!rows.length || !columns.length) {
    return <p className="form-empty">Add rows and columns to this question.</p>;
  }
  const selected = gridSelection(value);
  return (
    <table className="form-grid">
      <thead>
        <tr>
          <td />
          {columns.map((column, columnIndex) => (
            <th key={columnIndex} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={rowIndex} role="radiogroup" aria-label={row}>
            <th scope="row">{row}</th>
            {columns.map((column, columnIndex) => (
              <td key={columnIndex}>
                <input
                  type="radio"
                  name={`${questionId}-${rowIndex}`}
                  aria-label={`${row} ${column}`}
                  value={column}
                  checked={selected[row] === column}
                  disabled={disabled}
                  onChange={() =>
                    onChange(
                      encodeGridAnswer(rows, columns, { ...selected, [row]: column }),
                    )
                  }
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function GridAnswerLines({ rows, value }: { rows: string[]; value: string }) {
  const text = formatGridAnswer(rows, value);
  if (!text) return null;
  return text.split("\n").map((line, index) => <div key={index}>{line}</div>);
}
