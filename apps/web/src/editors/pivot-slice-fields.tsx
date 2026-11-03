export function PivotSliceFields({
  dateColumn,
  dateGroup,
  slicerColumn,
  slicerText,
  fields,
  onDateColumn,
  onDateGroup,
  onSlicerColumn,
  onSlicerText,
}: {
  dateColumn: number;
  dateGroup: string;
  slicerColumn: number;
  slicerText: string;
  fields: unknown[];
  onDateColumn: (column: number) => void;
  onDateGroup: (group: string) => void;
  onSlicerColumn: (column: number) => void;
  onSlicerText: (text: string) => void;
}) {
  return (
    <>
      <label>
        Date field
        <select
          aria-label="Date field"
          value={dateColumn}
          onChange={(event) => onDateColumn(Number(event.target.value))}
        >
          <option value={-1}>No date group</option>
          {fields.map((value, index) => (
            <option key={index} value={index}>
              {String(value ?? "Blank field")}
            </option>
          ))}
        </select>
      </label>
      {dateColumn >= 0 ? (
        <label>
          Group dates
          <select
            aria-label="Group dates"
            value={dateGroup || "year"}
            onChange={(event) => onDateGroup(event.target.value)}
          >
            <option value="year">Year</option>
            <option value="month">Month</option>
            <option value="quarter">Quarter</option>
          </select>
        </label>
      ) : null}
      <label>
        Slicer field
        <select
          aria-label="Slicer field"
          value={slicerColumn}
          onChange={(event) => onSlicerColumn(Number(event.target.value))}
        >
          <option value={-1}>No slicer</option>
          {fields.map((value, index) => (
            <option key={index} value={index}>
              {String(value ?? "Blank field")}
            </option>
          ))}
        </select>
      </label>
      {slicerColumn >= 0 ? (
        <label>
          Slicer values
          <input
            aria-label="Slicer values"
            value={slicerText}
            onChange={(event) => onSlicerText(event.target.value)}
          />
        </label>
      ) : null}
    </>
  );
}
