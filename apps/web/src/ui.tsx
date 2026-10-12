import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
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
        <ChevronRight size={14} />
      </Dropdown.SubTrigger>
      <Dropdown.Portal>
        <Dropdown.SubContent className="menu-content" sideOffset={6}>
          {children}
        </Dropdown.SubContent>
      </Dropdown.Portal>
    </Dropdown.Sub>
  );
}
/** A table command, shared by the Format menu and the table's right-click menu. */
export type TableAction = {
  label: string;
  run: () => void;
  disabled: boolean;
  checked?: boolean;
  separatorBefore?: boolean;
};
/** Rendered when the submenu opens, so `actions()` reads the current selection. */
export function TableMenuItems({ actions }: { actions: () => TableAction[] }) {
  return (
    <>
      {actions().map((action) => (
        <Fragment key={action.label}>
          {action.separatorBefore ? (
            <Dropdown.Separator className="menu-separator" />
          ) : null}
          {action.checked === undefined ? (
            <Dropdown.Item
              className="menu-item"
              disabled={action.disabled}
              onSelect={action.run}
            >
              <span className="menu-item-label">{action.label}</span>
            </Dropdown.Item>
          ) : (
            <Dropdown.CheckboxItem
              className="menu-item"
              disabled={action.disabled}
              checked={action.checked}
              onSelect={action.run}
            >
              <span className="menu-item-label">{action.label}</span>
              {action.checked ? <Check size={14} /> : null}
            </Dropdown.CheckboxItem>
          )}
        </Fragment>
      ))}
    </>
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
    tableActions: () => TableAction[];
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
  };
};
