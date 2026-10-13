import { MenuItem } from "../ui";

/** Reads filter-view choices when this submenu renders, so the first open already lists them. */
export function FilterViewChoices({
  load,
  onPick,
}: {
  load: () => { label: string; value: string }[];
  onPick: (value: string) => void;
}) {
  const items = load();
  return (
    <>
      {items.map((choice) => (
        <MenuItem key={choice.value} onSelect={() => onPick(choice.value)}>
          {choice.label}
        </MenuItem>
      ))}
    </>
  );
}
