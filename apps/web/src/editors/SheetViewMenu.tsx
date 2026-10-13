import type { RefObject } from "react";
import { columnName } from "@suiteleaf/core";
import {
  MenuCheckItem,
  MenuItem,
  MenuSeparator,
  SubMenu,
  type EditorActions,
} from "../ui";

/**
 * The Sheets View menu, laid out like Google Sheets (View › Show, View › Freeze).
 * Radix mounts menu content only while it is open, so the sheet state read here is
 * current each time the menu opens.
 */
export function SheetViewMenu({
  actions,
  onPrint,
}: {
  actions: RefObject<EditorActions | undefined>;
  onPrint: () => void;
}) {
  const sheet = actions.current?.sheetActions;
  const view = sheet?.view();
  const options = (
    axis: "rows" | "columns",
    frozen: number,
    current: number,
    max: number,
  ) => {
    const noun = axis === "rows" ? "row" : "column";
    const freeze = (count: number) =>
      axis === "rows" ? sheet?.freezeRows(count) : sheet?.freezeColumns(count);
    const upTo = axis === "rows" ? String(current) : columnName(current - 1);
    const choices: [number, string][] = [
      [0, `No ${noun}s`],
      [1, `1 ${noun}`],
      [2, `2 ${noun}s`],
      [current, `Up to ${noun} ${upTo}`],
    ];
    return choices.map(([count, label], i) => (
      <MenuCheckItem
        key={i}
        checked={i === 3 ? count > 2 && frozen === count : frozen === count}
        disabled={!view || count > max}
        onSelect={() => freeze(count)}
      >
        {label}
      </MenuCheckItem>
    ));
  };
  return (
    <>
      <SubMenu label="Show">
        <MenuCheckItem
          checked={view?.gridlines ?? true}
          disabled={!view}
          onSelect={() => sheet?.showGridlines(!view?.gridlines)}
        >
          Gridlines
        </MenuCheckItem>
        <MenuCheckItem
          checked={view?.formulaBar ?? true}
          disabled={!view}
          onSelect={() => sheet?.showFormulaBar(!view?.formulaBar)}
        >
          Formula bar
        </MenuCheckItem>
      </SubMenu>
      <SubMenu label="Freeze">
        {options(
          "rows",
          view?.frozenRows ?? 0,
          view?.row ?? 1,
          view?.maxFrozenRows ?? 0,
        )}
        <MenuSeparator />
        {options(
          "columns",
          view?.frozenColumns ?? 0,
          view?.column ?? 1,
          view?.maxFrozenColumns ?? 0,
        )}
      </SubMenu>
      <MenuSeparator />
      <MenuItem onSelect={onPrint}>Print layout</MenuItem>
      <MenuItem onSelect={() => sheet?.toggleFilter()}>Toggle filter</MenuItem>
    </>
  );
}
