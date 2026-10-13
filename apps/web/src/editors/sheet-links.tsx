import { useEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from "react";
import { X } from "lucide-react";
import {
  cellHyperlink,
  cellLabel,
  linkTarget,
  linkedCell,
  safeLink,
} from "@suiteleaf/core";

export type SheetLinkHandle = { open: () => void };

type Draft = {
  editing: boolean;
  text: string;
  url: string;
  error: string;
  row: number;
  column: number;
};

type Card = { url: string; top: number; left: number };

const LINK_ERROR =
  "Enter a web address, an email address, or a mailto: or tel: link.";
const ROW_HEADER = 46;

function oneLine(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function opensOutside(url: string) {
  return /^(https?:|mailto:|tel:)/i.test(url) && safeLink(url);
}

/**
 * Link dialog and the card that opens a cell link in a new tab.
 * Selecting a cell only shows the card; it does not follow the address.
 */
export default function SheetLinks({
  api,
  persist,
  host,
  ref,
}: {
  api: any;
  persist: () => void;
  host: RefObject<HTMLDivElement | null>;
  ref?: Ref<SheetLinkHandle>;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const draftRef = useRef(draft);
  const openRef = useRef<() => void>(() => {});
  const focusOnOpen = useRef(false);
  draftRef.current = draft;

  const sheet = () => api.getActiveWorkbook()?.getActiveSheet();

  const active = () => {
    const grid = sheet();
    const range = grid?.getActiveRange();
    if (!grid || !range) return null;
    const box = range.getRange();
    return {
      grid,
      cell: grid.getRange(box.startRow, box.startColumn, 1, 1),
      row: box.startRow as number,
      column: box.startColumn as number,
    };
  };

  const placeCard = () => {
    if (draftRef.current) {
      setCard(null);
      return;
    }
    const at = active();
    const url = at ? cellHyperlink(at.cell.getCellData()) : null;
    const root = host.current;
    if (!at || !url || !root) {
      setCard(null);
      return;
    }
    const editor = root.closest(".sheets-editor");
    if (!editor) {
      setCard(null);
      return;
    }
    const hostBox = root.getBoundingClientRect();
    const editorBox = editor.getBoundingClientRect();
    let x = ROW_HEADER;
    let y = 46;
    for (let c = 0; c < at.column; c++) x += at.grid.getColumnWidth(c) || 100;
    for (let r = 0; r < at.row; r++) y += at.grid.getRowHeight(r) || 24;
    const rowH = at.grid.getRowHeight(at.row) || 24;
    const width = at.grid.getColumnWidth(at.column) || 100;
    const next = {
      url,
      top: hostBox.top - editorBox.top + y + (rowH - 28) / 2 - 10,
      left: Math.min(
        hostBox.left - editorBox.left + x + width + 8,
        editorBox.width - 300,
      ),
    };
    setCard((current) =>
      current &&
      current.url === next.url &&
      current.top === next.top &&
      current.left === next.left
        ? current
        : next,
    );
  };

  const dismissEditor = () => {
    const unitId = api.getActiveWorkbook()?.getId?.();
    void api.executeCommand?.("sheet.operation.set-cell-edit-visible", {
      visible: false,
      eventType: 4,
      unitId,
      keycode: 27,
    });
  };

  const open = () => {
    const at = active();
    if (!at) return;
    dismissEditor();
    const data = at.cell.getCellData();
    const url = cellHyperlink(data) ?? "";
    focusOnOpen.current = true;
    setDraft({
      editing: !!url,
      text: cellLabel(data),
      url,
      error: "",
      row: at.row,
      column: at.column,
    });
    setCard(null);
  };
  openRef.current = open;
  useImperativeHandle(ref, () => ({ open }));

  useEffect(() => {
    const book = api.getActiveWorkbook?.();
    const sub = book?.onCommandExecuted?.((command: { id?: string }) => {
      const id = command.id ?? "";
      if (/selection|scroll|set-range-values|set-worksheet/.test(id)) placeCard();
    });
    placeCard();
    const root = host.current;
    const onWheel = () => requestAnimationFrame(placeCard);
    root?.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("resize", placeCard);
    return () => {
      sub?.dispose?.();
      root?.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", placeCard);
    };
    // The workbook instance is stable for this editor mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, host]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "k") return;
      const target = event.target;
      if (target instanceof Element && target.closest("[role='dialog']")) return;
      if (!(target instanceof Element) || !target.closest(".sheets-editor")) return;
      event.preventDefault();
      event.stopPropagation();
      openRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (!draft || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const id = draft.text ? "sheet-link-url" : "sheet-link-text";
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }, [draft]);

  const rangeFor = (row: number, column: number) =>
    sheet()?.getRange(row, column, 1, 1);

  const apply = () => {
    if (!draft) return;
    const href = linkTarget(draft.url);
    if (!href) {
      setDraft({ ...draft, error: LINK_ERROR });
      return;
    }
    const range = rangeFor(draft.row, draft.column);
    if (!range) return;
    if (range.getCellData()?.f) {
      setDraft({
        ...draft,
        error: "This cell is a formula. Link a cell that holds words.",
      });
      return;
    }
    const label = oneLine(draft.text) || cellLabel(range.getCellData()) || href;
    range.setValueForCell(linkedCell(label, href));
    range.setFontColor("#1a73e8");
    range.setFontLine("underline");
    persist();
    setDraft(null);
    requestAnimationFrame(placeCard);
  };

  const remove = () => {
    if (!draft) return;
    const range = rangeFor(draft.row, draft.column);
    if (!range) return;
    const label = oneLine(draft.text) || cellLabel(range.getCellData());
    range.setValueForCell({ v: label, t: 1, p: null });
    range.setFontColor(null);
    range.setFontLine(null);
    persist();
    setDraft(null);
    setCard(null);
  };

  const close = () => setDraft(null);

  return (
    <>
      {card && !draft ? (
        <div
          className="sheet-link-card"
          role="group"
          aria-label="Cell link"
          style={{ top: card.top, left: card.left }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {opensOutside(card.url) ? (
            <a href={card.url} target="_blank" rel="noopener noreferrer">
              {card.url}
            </a>
          ) : (
            <span>{card.url}</span>
          )}
          <button type="button" onClick={open}>
            Edit
          </button>
        </div>
      ) : null}
      {draft ? (
        <div className="gdocs-modal-overlay" onClick={close}>
          <form
            className="gdocs-dialog insert-link-dialog"
            role="dialog"
            aria-label={draft.editing ? "Edit link" : "Insert link"}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") close();
            }}
            onSubmit={(event) => {
              event.preventDefault();
              apply();
            }}
          >
            <div className="dialog-header">
              <h2>{draft.editing ? "Edit link" : "Insert link"}</h2>
              <button
                type="button"
                className="dialog-close-btn"
                aria-label="Close link dialog"
                onClick={close}
              >
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <div className="form-field-group">
                <div className="floating-field">
                  <label htmlFor="sheet-link-text">Text</label>
                  <input
                    id="sheet-link-text"
                    aria-label="Link text"
                    value={draft.text}
                    onChange={(event) =>
                      setDraft({ ...draft, text: event.target.value })
                    }
                  />
                </div>
                <div className="floating-field">
                  <label htmlFor="sheet-link-url">Link</label>
                  <input
                    id="sheet-link-url"
                    aria-label="Link address"
                    aria-invalid={!!draft.error}
                    aria-describedby={draft.error ? "sheet-link-error" : undefined}
                    placeholder="Paste a web address or email"
                    value={draft.url}
                    onChange={(event) =>
                      setDraft({ ...draft, url: event.target.value, error: "" })
                    }
                  />
                </div>
                {draft.error ? (
                  <p id="sheet-link-error" className="dialog-error" role="alert">
                    {draft.error}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="dialog-footer">
              {draft.editing ? (
                <button type="button" className="dialog-text-btn" onClick={remove}>
                  Remove link
                </button>
              ) : null}
              <button type="button" className="dialog-text-btn" onClick={close}>
                Cancel
              </button>
              <button
                type="submit"
                className="dialog-primary-btn"
                disabled={!draft.url.trim()}
              >
                Apply
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
