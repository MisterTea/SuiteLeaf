import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import type { JsonNode } from "@suiteleaf/core";
import {
  documentPageSettings,
  pageFace,
  pageSideInsets,
  type PageSettings,
} from "@suiteleaf/core/document-layout";
import { DocWatermark } from "./doc-watermark";

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

/** Which stored header or footer a page shows. Shared text stays header/footer. */
export type FurnitureSlot =
  | FurnitureField
  | "firstHeader"
  | "firstFooter"
  | "evenHeader"
  | "evenFooter"
  | "oddHeader"
  | "oddFooter";

/**
 * Page 1 uses the letterhead when a different first page is on.
 * Later even and odd pages use their own text when that split is on.
 * Otherwise every page shares header and footer.
 */
export function furnitureSlot(
  settings: PageSettings,
  field: FurnitureField,
  pageIndex: number,
): FurnitureSlot {
  if (pageIndex === 0 && settings.differentFirstPage)
    return field === "header" ? "firstHeader" : "firstFooter";
  if (settings.differentOddEven) {
    const even = (pageIndex + 1) % 2 === 0;
    if (field === "header") return even ? "evenHeader" : "oddHeader";
    return even ? "evenFooter" : "oddFooter";
  }
  return field;
}

/** Writes one header or footer field without touching the page-number choice. */
export function applyFurnitureText(
  settings: PageSettings,
  field: FurnitureSlot,
  value: string,
): PageSettings {
  const text = furniturePlainText(value);
  if (settings[field] === text) return settings;
  return { ...settings, [field]: text };
}

/** Writes the header or footer that this page is showing. Other pages stay put. */
export function applyPageFurniture(
  settings: PageSettings,
  pageIndex: number,
  field: FurnitureField,
  value: string,
): PageSettings {
  return applyFurnitureText(
    settings,
    furnitureSlot(settings, field, pageIndex),
    value,
  );
}

const SCOPE_LABEL: Record<FurnitureSlot, string> = {
  header: "Header · all pages",
  footer: "Footer · all pages",
  firstHeader: "Header · first page",
  firstFooter: "Footer · first page",
  evenHeader: "Header · even pages",
  evenFooter: "Footer · even pages",
  oddHeader: "Header · odd pages",
  oddFooter: "Footer · odd pages",
};

const INPUT_LABEL: Record<FurnitureSlot, string> = {
  header: "Header for every page",
  footer: "Footer for every page",
  firstHeader: "First page header",
  firstFooter: "First page footer",
  evenHeader: "Even page header",
  evenFooter: "Even page footer",
  oddHeader: "Odd page header",
  oddFooter: "Odd page footer",
};

const BUTTON_LABEL: Record<FurnitureSlot, string> = {
  header: "Edit header, all pages",
  footer: "Edit footer, all pages",
  firstHeader: "Edit header, first page",
  firstFooter: "Edit footer, first page",
  evenHeader: "Edit header, even pages",
  evenFooter: "Edit footer, even pages",
  oddHeader: "Edit header, odd pages",
  oddFooter: "Edit footer, odd pages",
};

/** Shared-header label. A letterhead or odd/even page uses furnitureSlot instead. */
export function furnitureScopeLabel(field: FurnitureField): string {
  return SCOPE_LABEL[field];
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

  const commit = (field: FurnitureField, pageIndex: number, value: string) => {
    const current = documentPageSettings(editor.getJSON() as JsonNode);
    const next = applyPageFurniture(current, pageIndex, field, value);
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
          onCommit={(field, value) => commit(field, i, value)}
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
  const face = pageFace(settings, pageIndex, pageCount);
  const insets = pageSideInsets(settings, pageIndex + 1);
  const headerSlot = furnitureSlot(settings, "header", pageIndex);
  const footerSlot = furnitureSlot(settings, "footer", pageIndex);
  const headerHere =
    editing?.field === "header" && editing.pageIndex === pageIndex;
  const footerHere =
    editing?.field === "footer" && editing.pageIndex === pageIndex;
  const keyboard = pageIndex === 0 && !readOnly;
  return (
    <div
      className="page-furniture-page"
      data-number-side={face.numberSide}
      data-header-align={face.headerAlign}
      data-letterhead={
        pageIndex === 0 && settings.differentFirstPage && face.header
          ? "true"
          : undefined
      }
      style={
        {
          ["--page-index" as string]: pageIndex,
          ["--gutter-left" as string]: `${insets.left - settings.left}px`,
          ["--gutter-right" as string]: `${insets.right - settings.right}px`,
        } as CSSProperties
      }
    >
      <DocWatermark text={settings.watermark} />
      {face.numberSide === "top-right" ? (
        <span className="page-number page-number-top">{face.pageNumber}</span>
      ) : null}
      <div
        className={`page-header align-${face.headerAlign}${face.header ? "" : " is-empty"}${headerHere ? " is-active" : ""}`}
        role={headerHere || !keyboard ? undefined : "button"}
        tabIndex={headerHere || !keyboard ? undefined : 0}
        aria-label={
          keyboard && !headerHere ? BUTTON_LABEL[headerSlot] : undefined
        }
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
          <div className="page-furniture-scope">{SCOPE_LABEL[headerSlot]}</div>
        ) : null}
        {headerHere ? (
          <FurnitureField
            initial={face.header}
            label={INPUT_LABEL[headerSlot]}
            onChange={(value) => onCommit("header", value)}
            onTab={() => onTab("header", pageIndex)}
          />
        ) : (
          <span className="page-header-text">{face.header}</span>
        )}
      </div>
      <div
        className={`page-footer number-${face.numberSide === "top-right" ? "none" : face.numberSide}${footerHere ? " is-active" : ""}`}
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
        {face.numberSide === "left" ? (
          <span className="page-number">{face.pageNumber}</span>
        ) : null}
        <span
          className={`page-footer-text${face.footer ? "" : " is-empty"}`}
          role={footerHere || !keyboard ? undefined : "button"}
          tabIndex={footerHere || !keyboard ? undefined : 0}
          aria-label={
            keyboard && !footerHere ? BUTTON_LABEL[footerSlot] : undefined
          }
          title={readOnly ? undefined : "Double-click to edit the footer"}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === "F2") {
              event.preventDefault();
              onOpen("footer", pageIndex);
            }
          }}
        >
          {footerHere ? (
            <span className="page-furniture-scope">{SCOPE_LABEL[footerSlot]}</span>
          ) : null}
          {footerHere ? (
            <FurnitureField
              initial={face.footer}
              label={INPUT_LABEL[footerSlot]}
              onChange={(value) => onCommit("footer", value)}
              onTab={() => onTab("footer", pageIndex)}
            />
          ) : (
            face.footer
          )}
        </span>
        {face.numberSide === "right" || face.numberSide === "center" ? (
          <span className="page-number">{face.pageNumber}</span>
        ) : null}
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
