import { Fragment, type Dispatch, type SetStateAction } from "react";
import type { Editor } from "@tiptap/react";
import { findParentNode } from "@tiptap/core";
import { Check, X } from "lucide-react";
import type { TableAction } from "../ui";

export type TableMenu = { x: number; y: number };

export function docTableActions(
  editor: Editor | null,
  setTableMenu: Dispatch<SetStateAction<TableMenu | null>>,
): TableAction[] {
  const table = editor
    ? findParentNode((n) => n.type.name === "table")(editor.state.selection)
    : undefined;
  const run = (command: () => void) => () => {
    setTableMenu(null);
    command();
  };
  const chain = () => editor!.chain().focus();
  const firstRow = table?.node.firstChild;
  const commands: [string, () => boolean][] = [
    ["Insert row above", () => chain().addRowBefore().run()],
    ["Insert row below", () => chain().addRowAfter().run()],
    ["Insert column left", () => chain().addColumnBefore().run()],
    ["Insert column right", () => chain().addColumnAfter().run()],
    ["Delete row", () => chain().deleteRow().run()],
    ["Delete column", () => chain().deleteColumn().run()],
    ["Delete table", () => chain().deleteTable().run()],
    ["Header row", () => chain().toggleHeaderRow().run()],
  ];
  return commands.map(([label, command], i) => ({
    label,
    run: run(command),
    disabled: !table,
    separatorBefore: i === 4 || i === 7,
    checked:
      label === "Header row"
        ? !!firstRow?.childCount &&
          firstRow.content.content.every(
            (cell) => cell.type.name === "tableHeader",
          )
        : undefined,
  }));
}

export function InsertTableDialog({
  editor,
  tableRows,
  setTableRows,
  tableColumns,
  setTableColumns,
  tableHeaderRow,
  setTableHeaderRow,
  setTableOpen,
}: {
  editor: Editor;
  tableRows: number;
  setTableRows: Dispatch<SetStateAction<number>>;
  tableColumns: number;
  setTableColumns: Dispatch<SetStateAction<number>>;
  tableHeaderRow: boolean;
  setTableHeaderRow: Dispatch<SetStateAction<boolean>>;
  setTableOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const insertTable = () => {
    editor
      ?.chain()
      .focus()
      .insertTable({
        rows: tableRows,
        cols: tableColumns,
        withHeaderRow: tableHeaderRow,
      })
      .run();
    setTableOpen(false);
  };

  return (
    <div
      className="gdocs-modal-overlay"
      onClick={() => setTableOpen(false)}
    >
      <div
        className="gdocs-dialog insert-table-dialog"
        role="dialog"
        aria-label="Insert table"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") setTableOpen(false);
        }}
      >
        <div className="dialog-header">
          <h2>Insert table</h2>
          <button
            type="button"
            className="dialog-close-btn"
            aria-label="Close"
            onClick={() => setTableOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="dialog-body">
          <div className="form-field-group">
            <div className="floating-field">
              <label>Rows</label>
              <input
                aria-label="Table rows"
                type="number"
                min="1"
                max="20"
                value={tableRows}
                onChange={(e) => setTableRows(Number(e.target.value))}
              />
            </div>
            <div className="floating-field">
              <label>Columns</label>
              <input
                aria-label="Table columns"
                type="number"
                min="1"
                max="20"
                value={tableColumns}
                onChange={(e) => setTableColumns(Number(e.target.value))}
              />
            </div>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={tableHeaderRow}
              onChange={(e) => setTableHeaderRow(e.target.checked)}
            />
            <span>Header row</span>
          </label>
        </div>
        <div className="dialog-footer">
          <button
            type="button"
            className="dialog-text-btn"
            onClick={() => setTableOpen(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="dialog-primary-btn"
            disabled={
              !Number.isInteger(tableRows) ||
              !Number.isInteger(tableColumns) ||
              tableRows < 1 ||
              tableColumns < 1 ||
              tableRows > 20 ||
              tableColumns > 20
            }
            onClick={insertTable}
          >
            Create table
          </button>
        </div>
      </div>
    </div>
  );
}

export function TableContextMenu({
  editor,
  tableMenu,
  setTableMenu,
  tableActions,
}: {
  editor: Editor;
  tableMenu: TableMenu;
  setTableMenu: Dispatch<SetStateAction<TableMenu | null>>;
  tableActions: () => TableAction[];
}) {
  return (
    <div
      className="context-menu-backdrop"
      onMouseDown={() => setTableMenu(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        setTableMenu(null);
      }}
    >
      <div
        className="menu-content table-context-menu"
        role="menu"
        aria-label="Table options"
        style={{
          left: Math.min(tableMenu.x, window.innerWidth - 230),
          top: Math.min(tableMenu.y, window.innerHeight - 300),
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          const items = [
            ...e.currentTarget.querySelectorAll<HTMLElement>(
              "[role^=menuitem]",
            ),
          ];
          const at = items.indexOf(document.activeElement as HTMLElement);
          if (e.key === "Escape") {
            setTableMenu(null);
            editor.commands.focus();
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const step = e.key === "ArrowDown" ? 1 : -1;
            items[(at + step + items.length) % items.length]?.focus();
          }
        }}
      >
        {tableActions().map((action) => (
          <Fragment key={action.label}>
            {action.separatorBefore ? (
              <div className="menu-separator" role="separator" />
            ) : null}
            <button
              type="button"
              className="menu-item"
              role={
                action.checked === undefined
                  ? "menuitem"
                  : "menuitemcheckbox"
              }
              aria-checked={action.checked}
              autoFocus={action.label === "Insert row above"}
              onClick={action.run}
            >
              <span className="menu-item-label">{action.label}</span>
              {action.checked ? <Check size={14} /> : null}
            </button>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
