export function PivotSortFields({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      Sort rows
      <select aria-label="Sort rows" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Labels A to Z</option>
        <option value="label-desc">Labels Z to A</option>
        <option value="value-desc">Values high to low</option>
        <option value="value-asc">Values low to high</option>
      </select>
    </label>
  );
}
