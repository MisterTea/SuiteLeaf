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
}: {
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <Dropdown.Item
      className="menu-item"
      disabled={disabled}
      onSelect={onSelect}
    >
      {children}
    </Dropdown.Item>
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
  };
};
