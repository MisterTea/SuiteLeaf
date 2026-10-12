import * as Dropdown from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
export function Menu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="menu-trigger">{label}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content className="menu-content" sideOffset={4}>
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
export function MenuItem({
  children,
  onSelect,
  disabled = false,
  shortcut,
}: {
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  shortcut?: string;
}) {
  return (
    <Dropdown.Item
      className="menu-item"
      disabled={disabled}
      onSelect={onSelect}
    >
      <span className="menu-item-label">{children}</span>
      {shortcut ? <span className="menu-item-shortcut">{shortcut}</span> : null}
    </Dropdown.Item>
  );
}
export function SubMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Dropdown.Sub>
      <Dropdown.SubTrigger className="menu-item">
        <span className="menu-item-label">{label}</span>
        <span className="menu-item-shortcut" aria-hidden="true">
          ›
        </span>
      </Dropdown.SubTrigger>
      <Dropdown.Portal>
        <Dropdown.SubContent className="menu-content" sideOffset={6}>
          {children}
        </Dropdown.SubContent>
      </Dropdown.Portal>
    </Dropdown.Sub>
  );
}
export function MenuSeparator() {
  return <Dropdown.Separator className="menu-separator" />;
}
export function MenuCheckItem({
  children,
  checked,
  onSelect,
  disabled = false,
}: {
  children: ReactNode;
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <Dropdown.CheckboxItem
      className="menu-item menu-check-item"
      checked={checked}
      disabled={disabled}
      onSelect={onSelect}
    >
      <span className="menu-item-check" aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
      <span className="menu-item-label">{children}</span>
    </Dropdown.CheckboxItem>
  );
}
export function Tool({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`tool ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export type EditorActions = {
  flush: () => Promise<void>;
  export: (format: string) => Promise<void>;
  print: () => Promise<void>;
  present?: () => void;
  docActions?: {
    undo: () => void;
    redo: () => void;
    openFind: () => void;
    selectAll: () => void;
    insertLink: () => void;
    insertImage: () => void;
    insertTable: () => void;
    insertHorizontalRule: () => void;
    clearFormatting: () => void;
    align: (alignment: "left" | "center" | "right" | "justify") => void;
    toggleBold: () => void;
    toggleItalic: () => void;
    toggleUnderline: () => void;
    toggleStrike: () => void;
    toggleBulletList: () => void;
    toggleOrderedList: () => void;
    tableAddRow: () => void;
    tableAddColumn: () => void;
    tableDeleteRow: () => void;
    tableDeleteColumn: () => void;
    tableDelete: () => void;
    hasTable: boolean;
  };
  sheetActions?: {
    dataValidation?: () => void;
    conditionalFormatting?: () => void;
    openComments?: () => void;
    insertComment?: () => void;
    tabsProtection?: () => void;
    insertCheckbox?: () => void;
    undo: () => void;
    redo: () => void;
    insertChart: () => void;
    insertPivot: () => void;
    toggleFilter: () => void;
    formatCurrency: () => void;
    formatPercent: () => void;
    toggleBold: () => void;
    toggleItalic: () => void;
    toggleStrike: () => void;
    clearFormatting: () => void;
    align: (alignment: "left" | "center" | "right") => void;
    view: () => SheetView;
    freezeRows: (count: number) => void;
    freezeColumns: (count: number) => void;
    showGridlines: (visible: boolean) => void;
    showFormulaBar: (visible: boolean) => void;
  };
};
export type SheetView = {
  frozenRows: number;
  frozenColumns: number;
  /** 1-based row and column of the active cell. */
  row: number;
  column: number;
  /** The most rows or columns that can be frozen and still leave room to scroll. */
  maxFrozenRows: number;
  maxFrozenColumns: number;
  gridlines: boolean;
  formulaBar: boolean;
};
