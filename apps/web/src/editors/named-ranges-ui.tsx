import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from "react";
import { AbsoluteRefType } from "@univerjs/core";
import {
  IDefinedNamesService,
  IFunctionService,
  LexerTreeBuilder,
  serializeRangeWithSheet,
} from "@univerjs/engine-formula";
import { X } from "lucide-react";
import {
  a1,
  displayRef,
  namedRangeError,
  type NamedRangeRecord,
} from "./named-ranges";

type Engine = { get: (id: unknown) => any };

export type NamedRangesHandle = { open: () => void };

function listed(
  map: Record<string, { id: string; name: string; formulaOrRefString: string; hidden?: boolean }> | null | undefined,
): NamedRangeRecord[] {
  return Object.values(map ?? {})
    .filter((item) => item?.name && !item.hidden && !item.name.startsWith("_xlnm."))
    .map((item) => ({
      id: item.id,
      name: item.name,
      ref: item.formulaOrRefString,
      hidden: item.hidden,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function NamedRanges({
  api,
  engine,
  persist,
  ref,
}: {
  api: any;
  engine: Engine | null;
  persist: () => void;
  ref?: Ref<NamedRangesHandle>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [names, setNames] = useState<NamedRangeRecord[]>([]);
  const [selection, setSelection] = useState("");
  const [absolute, setAbsolute] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [status, setStatus] = useState("");
  const [errorOverride, setErrorOverride] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const book = () => api.getActiveWorkbook?.();
  const service = () => engine?.get(IDefinedNamesService);

  const refresh = () => {
    const workbook = book();
    const defined = service();
    if (!workbook || !defined) return;
    const sheet = workbook.getActiveSheet?.();
    const active = sheet?.getSheetName?.() ?? "";
    setSheetName(active);
    setNames(listed(defined.getDefinedNameMap(workbook.getId())));
    const current = defined.getCurrentRange?.()?.range ?? workbook.getActiveRange?.()?.getRange?.();
    setSelection(current ? a1(current) : "");
    if (!sheet || !current || !engine) {
      setAbsolute("");
      return;
    }
    const lexer = engine.get(LexerTreeBuilder);
    const raw = serializeRangeWithSheet(active, current);
    setAbsolute(
      lexer.convertRefersToAbsolute(
        raw,
        AbsoluteRefType.ALL,
        AbsoluteRefType.ALL,
        active,
      ),
    );
  };

  const showNameInBox = () => {
    const defined = service();
    if (!defined) return;
    defined.setCurrentRange(defined.getCurrentRange());
  };

  useImperativeHandle(ref, () => ({
    open: () => {
      setDraft("");
      setEditingId(null);
      setStatus("");
      setErrorOverride(null);
      setOpen(true);
      refresh();
    },
  }));

  useEffect(() => {
    if (!open) return;
    refresh();
    const focus = window.setTimeout(() => input.current?.focus(), 40);
    const workbook = book();
    const defined = service();
    const onCommand = (command: { id?: string }) => {
      if (
        command.id === "sheet.operation.set-selections" ||
        command.id === "univer.command.undo" ||
        command.id === "univer.command.redo"
      ) {
        if (command.id !== "sheet.operation.set-selections") {
          setStatus("");
          setDraft("");
          setEditingId(null);
        }
        refresh();
      }
    };
    const commands = workbook?.onCommandExecuted?.(onCommand);
    const updates = defined?.update$?.subscribe?.(() => {
      if (!workbook) return;
      const next = listed(defined.getDefinedNameMap(workbook.getId()));
      setStatus((text) => {
        const mentioned = /now use ([A-Za-z_][A-Za-z0-9_]*)/.exec(text)?.[1];
        if (mentioned && !next.some((item) => item.name === mentioned)) return "";
        return text;
      });
      refresh();
    });
    const ranges = defined?.currentRange$?.subscribe?.(() => refresh());
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", escape);
    return () => {
      window.clearTimeout(focus);
      commands?.dispose?.();
      updates?.unsubscribe?.();
      ranges?.unsubscribe?.();
      document.removeEventListener("keydown", escape);
    };
    // The workbook facade is stable for this editor instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const editing = names.find((item) => item.id === editingId);
  const sheets: string[] = book()?.getSheets?.().map((sheet: { getSheetName: () => string }) => sheet.getSheetName()) ?? [];
  const isFunction = (name: string) => {
    try {
      return !!engine?.get(IFunctionService).hasExecutor(name.toUpperCase());
    } catch {
      return false;
    }
  };
  const error = draft
    ? namedRangeError(draft, { names, editingId, sheetNames: sheets, isFunction })
    : null;
  const unchanged = !!editing && draft === editing.name;
  const canSave = !!draft.trim() && !error && !unchanged && (!!editing || !!absolute);
  const matching = names.find((item) => item.ref === absolute);

  const save = () => {
    const workbook = book();
    if (!workbook || !canSave || !absolute) return;
    try {
      if (editing) {
        const defined = workbook.getDefinedName(editing.name);
        if (!defined) return;
        const previous = editing.name;
        workbook.updateDefinedNameBuilder(defined.toBuilder().setName(draft).build());
        setStatus(
          `Formulas that used ${previous} now use ${draft}. Undo changes the name and those formulas together.`,
        );
        setEditingId(null);
        setDraft("");
      } else {
        workbook.insertDefinedName(draft, absolute);
        setStatus(`Added ${draft} for ${displayRef(absolute, sheetName)}.`);
        setDraft("");
      }
      showNameInBox();
      refresh();
      persist();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      setStatus("");
      const reason = namedRangeError(draft, {
        names,
        editingId,
        sheetNames: sheets,
        isFunction,
      });
      setErrorOverride(
        reason ??
          (message && !/invalid/i.test(message)
            ? message
            : `${draft} can't be used as a name. Try a word like Rent.`),
      );
    }
  };

  const shownError = errorOverride ?? error;
  const jump = (item: NamedRangeRecord) => {
    const id = book()?.getId?.();
    if (id) service()?.focusRange(id, item.id);
    setStatus("");
  };
  const beginRename = (item: NamedRangeRecord) => {
    setEditingId(item.id);
    setDraft(item.name);
    setErrorOverride(null);
    setStatus("");
    window.setTimeout(() => {
      input.current?.focus();
      input.current?.select();
    }, 0);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSave) save();
  };

  if (!open) return null;
  return (
    <aside
      className="named-ranges-panel"
      role="dialog"
      aria-labelledby="named-ranges-title"
    >
      <div className="dialog-header">
        <h2 id="named-ranges-title">Named ranges</h2>
        <button
          type="button"
          className="dialog-close-btn"
          aria-label="Close named ranges"
          onClick={() => setOpen(false)}
        >
          <X size={18} />
        </button>
      </div>
      <p className="named-range-selection">
        {matching ? (
          <>
            This selection is <strong>{matching.name}</strong>
            {selection ? <> · {selection}</> : null}
          </>
        ) : selection ? (
          <>
            Selection <strong>{selection}</strong>
          </>
        ) : (
          "Select the cells you want to name."
        )}
      </p>
      <form onSubmit={submit}>
        <label className="named-range-field">
          {editing ? `New name for ${editing.name}` : "Name"}
          <input
            ref={input}
            aria-label="Range name"
            aria-invalid={shownError ? true : undefined}
            value={draft}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setDraft(event.target.value);
              setErrorOverride(null);
              setStatus("");
            }}
          />
        </label>
        {shownError ? (
          <p className="dialog-error" role="alert">
            {shownError}
          </p>
        ) : null}
        {status ? <p className="named-range-status">{status}</p> : null}
        <div className="dialog-footer">
          {editing ? (
            <button
              type="button"
              className="dialog-text-btn"
              onClick={() => {
                setEditingId(null);
                setDraft("");
                setErrorOverride(null);
              }}
            >
              Cancel
            </button>
          ) : null}
          <button type="submit" className="dialog-primary-btn" disabled={!canSave}>
            {editing ? "Rename" : "Add"}
          </button>
        </div>
      </form>
      <h3 className="named-ranges-heading">In this workbook</h3>
      {names.length ? (
        <ul className="named-range-list">
          {names.map((item) => (
            <li
              key={item.id}
              className={item.id === editingId ? "is-editing" : undefined}
            >
              <button
                type="button"
                className="named-range-jump"
                aria-label={`Go to ${item.name}, ${displayRef(item.ref, sheetName)}`}
                onClick={() => jump(item)}
              >
                <strong>{item.name}</strong>
                <span>{displayRef(item.ref, sheetName)}</span>
              </button>
              <button
                type="button"
                className="dialog-text-btn"
                aria-label={`Rename ${item.name}`}
                onClick={() => beginRename(item)}
              >
                Rename
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="named-ranges-empty">
          No named ranges yet. Add one for the selection above, then use it in a
          formula such as =SUM(Rent).
        </p>
      )}
    </aside>
  );
}
