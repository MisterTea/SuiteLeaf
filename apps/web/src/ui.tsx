import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import {
  createContext,
  Fragment,
  useContext,
  useRef,
  type ReactNode,
} from "react";
const AfterClose = createContext<{ current: (() => void) | null } | null>(null);
export function Menu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const afterClose = useRef<(() => void) | null>(null);
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className="menu-trigger">{label}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className="menu-content"
          sideOffset={4}
          onCloseAutoFocus={(e) => {
            const run = afterClose.current;
            afterClose.current = null;
            if (!run) return;
            e.preventDefault();
            run();
          }}
        >
          <AfterClose.Provider value={afterClose}>
            {children}
          </AfterClose.Provider>
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
  focusesTarget = false,
}: {
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  shortcut?: string;
  /** Run after the menu closes, so focus can go to the editor or a dialog. */
  focusesTarget?: boolean;
}) {
  const afterClose = useContext(AfterClose);
  return (
    <Dropdown.Item
      className="menu-item"
      disabled={disabled}
      onSelect={
        focusesTarget && afterClose
          ? () => (afterClose.current = onSelect)
          : onSelect
      }
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
    insertPageBreak: () => void;
    insertComment?: () => void;
    openComments?: () => void;
    insertTableOfContents: (pageNumbers?: boolean) => void;
    insertFootnote: () => void;
    insertEndnote: () => void;
    openPageSetup: () => void;
    openWordCount: () => void;
    openSpelling: () => void;
    openDictionary: () => void;
    clearFormatting: () => void;
    align: (alignment: "left" | "center" | "right" | "justify") => void;
    toggleBold: () => void;
    toggleItalic: () => void;
    toggleUnderline: () => void;
    toggleStrike: () => void;
    toggleSuperscript: () => void;
    toggleSubscript: () => void;
    toggleBulletList: () => void;
    toggleOrderedList: () => void;
    tableActions: () => TableAction[];
    openSuggestions?: () => void;
  };
  sheetActions?: {
    dataValidation?: () => void;
    conditionalFormatting?: () => void;
    openComments?: () => void;
    insertComment?: () => void;
    tabsProtection?: () => void;
    insertCheckbox?: () => void;
    insertDropdown?: () => void;
    undo: () => void;
    redo: () => void;
    cut: () => void;
    copy: () => void;
    paste: () => void;
    deleteValues: () => void;
    insertChart: () => void;
    insertPivot: () => void;
    toggleFilter: () => void;
    sortRange?: () => void;
    hasFilter?: () => boolean;
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
  slideActions?: {
    undo: () => void;
    redo: () => void;
    cut: () => void;
    copy: () => void;
    paste: () => void;
    insertTextBox: () => void;
    insertImage: () => void;
    insertShape: (shape: "rect" | "roundRect" | "ellipse") => void;
    newSlide: () => void;
    duplicate: () => void;
    deleteSlides: () => void;
    move: (where: "up" | "down" | "start" | "end") => void;
    toggleBold: () => void;
    toggleItalic: () => void;
    align: (alignment: "left" | "center" | "right") => void;
    applyLayout: (
      layout: "title" | "title-body" | "section" | "two-column" | "blank",
    ) => void;
    openTheme: () => void;
    openTransition: () => void;
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
