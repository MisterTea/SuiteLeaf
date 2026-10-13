import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import {
  createContext,
  Fragment,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { isUnimplemented, pendingReason } from "./commands";
import { useRegisterCommand } from "./command-palette";
const AfterClose = createContext<{ current: (() => void) | null } | null>(null);
const MenuPath = createContext<string[]>([]);
/** Renders menu children only to register commands, with no popup. */
const MenuRegistrar = createContext(false);
export function useMenuPath() {
  return useContext(MenuPath);
}
export function useRegisteringMenus() {
  return useContext(MenuRegistrar);
}
export function Menu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const afterClose = useRef<(() => void) | null>(null);
  const path = useMemo(() => [label], [label]);
  return (
    <MenuPath.Provider value={path}>
      <MenuRegistrar.Provider value={true}>{children}</MenuRegistrar.Provider>
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
    </MenuPath.Provider>
  );
}
export function MenuItem({
  children,
  onSelect,
  disabled = false,
  shortcut,
  focusesTarget = false,
  searchLabel,
  synonyms,
  group,
  availability,
}: {
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  shortcut?: string;
  /** Run after the menu closes, so focus can go to the editor or a dialog. */
  focusesTarget?: boolean;
  /** Label for command search when the visible children are not plain text. */
  searchLabel?: string;
  synonyms?: string[];
  group?: string;
  /** Return a reason when the command cannot run, or true when it can. */
  availability?: () => true | string;
}) {
  const afterClose = useContext(AfterClose);
  const path = useContext(MenuPath);
  const label = searchLabel ?? (typeof children === "string" ? children : "");
  const pending = isUnimplemented(onSelect);
  const reason = availability?.();
  const unavailable =
    disabled || pending || (typeof reason === "string" && reason.length > 0);
  const title =
    typeof reason === "string"
      ? reason
      : pending
        ? pendingReason(label)
        : undefined;
  useRegisterCommand(
    label
      ? {
          id: [...path, label].join("/"),
          label,
          path,
          shortcut,
          synonyms,
          group,
          pending,
          availability: () => {
            const live = availability?.();
            return typeof live === "string" ? live : true;
          },
          run: onSelect,
        }
      : null,
  );
  if (useContext(MenuRegistrar)) return null;
  return (
    <Dropdown.Item
      className="menu-item"
      disabled={unavailable}
      title={title}
      onSelect={
        focusesTarget && afterClose
          ? () => (afterClose.current = onSelect)
          : onSelect
      }
    >
      <span className="menu-item-label">{children}</span>
      {shortcut ? (
        <span className="menu-item-shortcut">{shortcut}</span>
      ) : null}
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
  const parent = useContext(MenuPath);
  const path = useMemo(() => [...parent, label], [parent, label]);
  const registerOnly = useContext(MenuRegistrar);
  if (registerOnly) {
    return (
      <MenuPath.Provider value={path}>
        <MenuRegistrar.Provider value={true}>{children}</MenuRegistrar.Provider>
      </MenuPath.Provider>
    );
  }
  return (
    <MenuPath.Provider value={path}>
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
    </MenuPath.Provider>
  );
}
/** Run a menu action after the menu closes, so the editor can take focus. */
export function useMenuClose() {
  return useContext(AfterClose);
}
export function MenuSeparator() {
  if (useContext(MenuRegistrar)) return null;
  return <Dropdown.Separator className="menu-separator" />;
}
export function MenuCheckItem({
  children,
  checked,
  onSelect,
  disabled = false,
  synonyms,
  group,
  availability,
}: {
  children: ReactNode;
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
  synonyms?: string[];
  group?: string;
  availability?: () => true | string;
}) {
  const path = useContext(MenuPath);
  const label = typeof children === "string" ? children : "";
  const reason = availability?.();
  const unavailable = disabled || (typeof reason === "string" && !!reason);
  useRegisterCommand(
    label
      ? {
          id: [...path, label].join("/"),
          label,
          path,
          synonyms,
          group,
          availability: () => {
            const live = availability?.();
            return typeof live === "string" ? live : true;
          },
          run: onSelect,
        }
      : null,
  );
  if (useContext(MenuRegistrar)) return null;
  return (
    <Dropdown.CheckboxItem
      className="menu-item menu-check-item"
      checked={checked}
      disabled={unavailable}
      title={typeof reason === "string" ? reason : undefined}
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
  if (useContext(MenuRegistrar)) return null;
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
    /** Why Insert › Link cannot run, if the caret has no selection. */
    linkState?: () => { ok: true } | { ok: false; reason: string };
    insertImage: () => void;
    insertTable: () => void;
    insertHorizontalRule: () => void;
    insertPageBreak: () => void;
    insertComment?: () => void;
    openComments?: () => void;
    insertTableOfContents: (pageNumbers?: boolean) => void;
    insertFootnote: () => void;
    insertEndnote: () => void;
    insertEquation: () => void;
    openPageSetup: () => void;
    openWordCount: () => void;
    openSpelling: () => void;
    openGrammar: () => void;
    openIgnoredGrammar: () => void;
    openDictionary: () => void;
    openCitations: () => void;
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
    insertLink?: () => void;
    undo: () => void;
    redo: () => void;
    cut: () => void;
    copy: () => void;
    paste: () => void;
    deleteValues: () => void;
    insertChart: () => void;
    insertImage?: () => void;
    insertPivot: () => void;
    insertFunction?: (name: string) => void;
    toggleFilter: () => void;
    /** Unsaved filter for someone who cannot edit. Not stored in the file. */
    createFilterView?: () => void;
    applyFilterView?: (value: string) => void;
    clearFilterView?: () => void;
    filterViewChoices?: () => { label: string; value: string }[];
    sortRange?: () => void;
    namedRanges?: () => void;
    groupRows?: () => void;
    trimWhitespace?: () => void;
    removeDuplicates?: () => void;
    splitTextToColumns?: () => void;
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
    openSpelling?: () => void;
    insertPageBreak?: () => void;
    openPrintSettings?: () => void;
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
    insertComment?: () => void;
    openComments?: () => void;
    openResolved?: () => void;
    undoReason?: () => string | undefined;
    redoReason?: () => string | undefined;
    deleteReason?: () => string | undefined;
    openSpelling?: () => void;
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
