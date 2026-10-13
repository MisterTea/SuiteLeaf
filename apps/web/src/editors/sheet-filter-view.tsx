import { useEffect, useState } from "react";
import { MenuItem } from "../ui";

/** Reads filter-view choices when the submenu opens, not when the menu bar last rendered. */
export function FilterViewChoices({
  load,
  onPick,
}: {
  load: () => { label: string; value: string }[];
  onPick: (value: string) => void;
}) {
  const [items, setItems] = useState<{ label: string; value: string }[]>([]);
  useEffect(() => {
    setItems(load());
  }, [load]);
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
