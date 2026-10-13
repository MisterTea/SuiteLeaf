import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import type { JsonNode } from "@suiteleaf/core";
import {
  documentPageSettings,
  type PageSettings,
} from "@suiteleaf/core/document-layout";

/** Header and footer text stored on the document. The page number is not part of it. */
export const FURNITURE_TEXT_LIMIT = 500;

export type FurnitureField = "header" | "footer";

/**
 * One line of header or footer text. Newlines from a paste become spaces so
 * the running header cannot swallow the page number below it.
 */
export function furniturePlainText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").slice(0, FURNITURE_TEXT_LIMIT);
}

/** Writes header or footer text without touching the page-number choice. */
export function applyFurnitureText(
  settings: PageSettings,
  field: FurnitureField,
  value: string,
): PageSettings {
  const text = furniturePlainText(value);
  if (settings[field] === text) return settings;
  return { ...settings, [field]: text };
}

/**
 * This base has one header and one footer for the whole document.
 * Different first page and odd/even headers are not page settings yet.
 */
export function furnitureScopeLabel(field: FurnitureField): string {
  return field === "header" ? "Header · all pages" : "Footer · all pages";
}

/**
 * Double-click the header or footer on the page to edit it in place.
 * The page number is a separate element, so typing in the footer cannot
 * replace it. Escape or a click in the body closes the editor.
 */
export function PageFurniture({
  editor,
  pageCount,
  readOnly,
}: {
  editor: Editor;
  pageCount: number;
  readOnly: boolean;
}) {
  const settings =
    useEditorState({
      editor,
      selector: ({ editor: current }) =>
        documentPageSettings(current.getJSON() as JsonNode),
    }) ?? documentPageSettings({ type: "doc" });
  const [editing, setEditing] = useState<{
    field: FurnitureField;
    pageIndex: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;

  useLayoutEffect(() => {
    const paper = rootRef.current?.closest(".paginated-paper");
    if (!paper) return;
    paper.classList.toggle("is-editing-furniture", editing !== null);
    return () => paper.classList.remove("is-editing-furniture");
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    const close = () => {
      setEditing(null);
      editorRef.current.commands.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      const inField =
        event.target instanceof Element &&
        event.target.closest(".page-furniture-input");
      if (event.key !== "Escape" && !(event.key === "Enter" && inField)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(".document-content")) return;
      if (target.closest(".page-header, .page-footer")) return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [editing]);

  const commit = (field: FurnitureField, value: string) => {
    const current = documentPageSettings(editor.getJSON() as JsonNode);
    const next = applyFurnitureText(current, field, value);
    if (next === current) return;
    editor.view.dispatch(editor.state.tr.setDocAttribute("pageSettings", next));
  };

  const open = (field: FurnitureField, pageIndex: number) => {
    if (readOnly) return;
    setEditing({ field, pageIndex });
  };

  return (
    <div
      ref={rootRef}
      className={`page-furniture${editing ? " is-editing" : ""}`}
      data-furniture-editing={editing?.field ?? ""}
    >
      {Array.from({ length: pageCount }, (_, i) => (
        <FurniturePage
          key={i}
          pageIndex={i}
          pageCount={pageCount}
          settings={settings}
          editing={editing}
          readOnly={readOnly}
          onOpen={open}
          onCommit={commit}
          onTab={(field, pageIndex) => open(otherField(field), pageIndex)}
        />
      ))}
    </div>
  );
}

function otherField(field: FurnitureField): FurnitureField {
  return field === "header" ? "footer" : "header";
}

function editingTargetIsField(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("input"));
}

function FurniturePage({
  pageIndex,
  pageCount,
  settings,
  editing,
  readOnly,
  onOpen,
  onCommit,
  onTab,
}: {
  pageIndex: number;
  pageCount: number;
  settings: PageSettings;
  editing: { field: FurnitureField; pageIndex: number } | null;
  readOnly: boolean;
  onOpen: (field: FurnitureField, pageIndex: number) => void;
  onCommit: (field: FurnitureField, value: string) => void;
  onTab: (field: FurnitureField, pageIndex: number) => void;
}) {
  const headerHere =
    editing?.field === "header" && editing.pageIndex === pageIndex;
  const footerHere =
    editing?.field === "footer" && editing.pageIndex === pageIndex;
  const keyboard = pageIndex === 0 && !readOnly;
  return (
    <div
      className="page-furniture-page"
      style={{ ["--page-index" as string]: pageIndex }}
    >
      <div
        className={`page-header${settings.header ? "" : " is-empty"}${headerHere ? " is-active" : ""}`}
        role={headerHere || !keyboard ? undefined : "button"}
        tabIndex={headerHere || !keyboard ? undefined : 0}
        aria-label={keyboard && !headerHere ? "Edit header, all pages" : undefined}
        title={readOnly ? undefined : "Double-click to edit the header"}
        onMouseDown={(event) => {
          if (readOnly || editingTargetIsField(event.target)) return;
          event.preventDefault();
          if (editing) onOpen("header", pageIndex);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          onOpen("header", pageIndex);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "F2") {
            event.preventDefault();
            onOpen("header", pageIndex);
          }
        }}
      >
        {headerHere ? (
          <div className="page-furniture-scope">{furnitureScopeLabel("header")}</div>
        ) : null}
        {headerHere ? (
          <FurnitureField
            initial={settings.header}
            label="Header for every page"
            onChange={(value) => onCommit("header", value)}
            onTab={() => onTab("header", pageIndex)}
          />
        ) : (
          <span className="page-furniture-text">{settings.header}</span>
        )}
      </div>
      <div
        className={`page-footer${footerHere ? " is-active" : ""}`}
        onMouseDown={(event) => {
          if (readOnly || editingTargetIsField(event.target)) return;
          event.preventDefault();
          if (editing) onOpen("footer", pageIndex);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          onOpen("footer", pageIndex);
        }}
      >
        {footerHere ? (
          <div className="page-furniture-scope">{furnitureScopeLabel("footer")}</div>
        ) : null}
        <div className="page-footer-row">
        <div
          className={`page-footer-text${settings.footer ? "" : " is-empty"}`}
          role={footerHere || !keyboard ? undefined : "button"}
          tabIndex={footerHere || !keyboard ? undefined : 0}
          aria-label={keyboard && !footerHere ? "Edit footer, all pages" : undefined}
          title={readOnly ? undefined : "Double-click to edit the footer"}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "F2") {
              event.preventDefault();
              onOpen("footer", pageIndex);
            }
          }}
        >
          {footerHere ? (
            <FurnitureField
              initial={settings.footer}
              label="Footer for every page"
              onChange={(value) => onCommit("footer", value)}
              onTab={() => onTab("footer", pageIndex)}
            />
          ) : (
            <span className="page-furniture-text">{settings.footer}</span>
          )}
        </div>
        {settings.pageNumbers ? (
          <span className="page-number" title="Page number">
            {pageIndex + 1} / {pageCount}
          </span>
        ) : null}
        </div>
      </div>
    </div>
  );
}

function FurnitureField({
  initial,
  label,
  onChange,
  onTab,
}: {
  initial: string;
  label: string;
  onChange: (value: string) => void;
  onTab: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(() => furniturePlainText(initial));
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.focus();
    field.select();
  }, []);
  return (
    <input
      ref={ref}
      className="page-furniture-input"
      aria-label={label}
      value={value}
      maxLength={500}
      spellCheck={false}
      autoComplete="off"
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onChange={(event) => {
        const next = furniturePlainText(event.target.value);
        setValue(next);
        onChange(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          event.preventDefault();
          onTab();
        }
      }}
    />
  );
}
