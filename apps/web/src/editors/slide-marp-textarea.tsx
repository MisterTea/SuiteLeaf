import { sourceEditor, sourceValue, sourceSelection, selectSourceRange, sourceHeight, sourceScrollTop, setSourceScrollTop } from "./slide-source-control";
import React, {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import ace, { type Ace } from "ace-builds";
import "ace-builds/src-noconflict/mode-markdown";
import "ace-builds/src-noconflict/mode-xml";
import "ace-builds/src-noconflict/mode-dot";
import "ace-builds/src-noconflict/theme-github";
import "ace-builds/src-noconflict/theme-github_dark";
import { lineAt } from "./slide-marp-source";

/** How long typing must pause before the slides follow the markdown. */
export const MARP_TYPING_PAUSE_MS = 500;

// Safe stub for headless / test environments without ResizeObserver
if (typeof window !== "undefined" && typeof (window as any).ResizeObserver === "undefined") {
  (window as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const MIRRORED = [
  "boxSizing",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "tabSize",
  "wordSpacing",
  "whiteSpace",
  "overflowWrap",
  "wordBreak",
] as const;

/** How far down the box's content a character sits, counting lines the box wraps. */
function offsetTop(area: HTMLTextAreaElement, offset: number): number {
  const style = getComputedStyle(area);
  const mirror = document.createElement("div");
  for (const key of MIRRORED) mirror.style[key] = style[key];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.left = "-10000px";
  mirror.style.top = "0";
  mirror.style.boxSizing = "border-box";
  mirror.style.width = `${area.clientWidth}px`;
  mirror.textContent = area.value.slice(0, offset);
  const mark = document.createElement("span");
  mark.textContent = "\u200b";
  mirror.append(mark);
  document.body.append(mirror);
  const top = mark.offsetTop;
  mirror.remove();
  return top;
}

/** Bring a character of the markdown into view, a third of the way down, unless it already shows. */
export function scrollMarkdownTo(area: HTMLTextAreaElement, offset: number) {
  const editor = (area as any)?.__aceEditor as Ace.Editor | undefined;
  if (editor) {
    const doc = editor.getSession().getDocument();
    const pos = doc.indexToPosition(offset, 0);
    const firstRow = editor.getFirstVisibleRow();
    const lastRow = editor.getLastVisibleRow();
    if (pos.row >= firstRow && pos.row <= lastRow) return;
    editor.scrollToLine(pos.row, true, true, () => {});
    return;
  }
  const top = offsetTop(area, offset);
  const line = parseFloat(getComputedStyle(area).lineHeight) || 19;
  if (top >= area.scrollTop && top + line <= area.scrollTop + area.clientHeight) return;
  area.scrollTop = Math.max(0, top - area.clientHeight / 3);
}

/**
 * Page Down and Page Up move the caret a screen of lines as well as the view.
 * A Mac only scrolls a text box, which would leave the slide behind.
 */
function pageCaret(area: HTMLTextAreaElement, direction: 1 | -1, extend: boolean) {
  const text = sourceValue(area);
  const selection = sourceSelection(area);
  const caret = selection.backward ? selection.start : selection.end;
  const anchor = selection.backward ? selection.end : selection.start;
  const lines = text.split("\n");
  const line = lineAt(text, caret);
  const column = caret - (text.lastIndexOf("\n", caret - 1) + 1);
  const height = sourceEditor(area)?.renderer.lineHeight || parseFloat(getComputedStyle(area).lineHeight) || 19;
  const step = Math.max(1, Math.floor(sourceHeight(area) / height) - 1);
  const target = Math.min(lines.length - 1, Math.max(0, line + direction * step));
  let next = 0;
  for (let i = 0; i < target; i++) next += lines[i].length + 1;
  next =
    target === line
      ? direction > 0
        ? text.length
        : 0
      : next + Math.min(column, lines[target].length);
  if (extend)
    selectSourceRange(area, Math.min(anchor, next), Math.max(anchor, next), next < anchor ? "backward" : "forward");
  else selectSourceRange(area, next);
  setSourceScrollTop(area, sourceScrollTop(area) + direction * step * height);
  scrollMarkdownTo(area, next);
}

function getIsDark(): boolean {
  if (typeof document === "undefined") return false;
  return (
    document.documentElement.classList.contains("dark-theme") ||
    document.documentElement.getAttribute("data-theme") === "dark"
  );
}

export type MarpDraft = { flush: () => void };

/**
 * The deck's markdown editor powered by Ace, featuring line numbers and syntax highlighting.
 * Typing changes only this box; the slides follow once typing pauses, when the box loses focus,
 * or when `draftRef` is flushed, and they redraw as a low-priority update that more typing can interrupt.
 */
export function MarpTextarea({
  source,
  readOnly,
  invalid,
  onCommit,
  areaRef,
  draftRef,
  onCaretLine,
  label = "Presentation markdown",
  mode = "markdown",
}: {
  source: string;
  readOnly: boolean;
  invalid: boolean;
  onCommit: (text: string) => void;
  areaRef: RefObject<HTMLTextAreaElement | null>;
  draftRef: RefObject<MarpDraft | null>;
  /** The caret moved onto another line, by a click, a key, or typing. */
  onCaretLine?: (text: string, line: number) => void;
  label?: string;
  mode?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Ace.Editor | null>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const onCaretLineRef = useRef(onCaretLine);
  onCaretLineRef.current = onCaretLine;
  const caretLine = useRef<number | null>(null);
  const isInternalChange = useRef(false);
  const isInsideEffect = useRef(false);
  const labelRef = useRef(label);
  labelRef.current = label;

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const text = pending.current;
    if (text === null) return;
    pending.current = null;
    startTransition(() => {
      commitRef.current(text);
      setDraft(null);
    });
  }, []);

  useEffect(() => {
    draftRef.current = { flush };
    return () => {
      flush();
      draftRef.current = null;
    };
  }, [draftRef, flush]);

  useEffect(() => {
    isInsideEffect.current = true;
    try {
      const container = containerRef.current;
      if (!container) return;

    const isDark = getIsDark();
    const editor = ace.edit(container, {
      mode: `ace/mode/${mode}`,
      theme: isDark ? "ace/theme/github_dark" : "ace/theme/github",
      readOnly,
      showLineNumbers: true,
      showGutter: true,
      wrap: true,
      showPrintMargin: false,
      highlightActiveLine: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      tabSize: 2,
      useSoftTabs: true,
      value: source,
    });

    editor.session.setUseWorker(false);
    editor.setValue(source, -1);
    editorRef.current = editor;

    const textarea = editor.textInput.getElement() as HTMLTextAreaElement;
    (textarea as any).__aceEditor = editor;
    textarea.classList.add("marp-textarea");

    // Track internal Ace buffer manipulation during resetSelection so it doesn't overwrite whole document
    let isAceBuffer = false;
    const patchReset = (methodName: string) => {
      const orig = (editor.textInput as any)?.[methodName]?.bind(editor.textInput);
      if (orig) {
        (editor.textInput as any)[methodName] = function (...args: any[]) {
          isAceBuffer = true;
          try {
            return orig(...args);
          } finally {
            isAceBuffer = false;
          }
        };
      }
    };
    patchReset("resetSelection");
    patchReset("$resetSelection");

    // Intercept setAttribute so Ace cannot overwrite aria-label with its internal cursor announcements
    const origSetAttribute = textarea.setAttribute.bind(textarea);
    textarea.setAttribute = (name: string, val: string) => {
      if (name.toLowerCase() === "aria-label") {
        return origSetAttribute("aria-label", labelRef.current);
      }
      return origSetAttribute(name, val);
    };
    origSetAttribute("aria-label", label);

    if (invalid) {
      origSetAttribute("aria-invalid", "true");
    } else {
      textarea.removeAttribute("aria-invalid");
    }
    textarea.readOnly = readOnly;
    textarea.spellcheck = false;

    const nativeValueGetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.get;
    if (areaRef) areaRef.current = textarea;

    // Ignore synthetic mousedown directly targeting the hidden input textarea
    const onEditorMouseDown = (e: any) => {
      if (e.domEvent?.target === textarea) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    editor.on("mousedown", onEditorMouseDown);

    // Stop propagation of synthetic mouse events on textarea so Ace's document capture doesn't reset caret
    const stopMouse = (e: MouseEvent) => {
      e.stopPropagation();
    };
    textarea.addEventListener("mousedown", stopMouse);
    textarea.addEventListener("mouseup", stopMouse);

    // PageDown / PageUp handling
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "PageDown" && e.key !== "PageUp") return;
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      pageCaret(textarea, e.key === "PageDown" ? 1 : -1, e.shiftKey);
    };
    textarea.addEventListener("keydown", onKeyDown, true);

    // Typing changes inside Ace session
    const onSessionChange = () => {
      if (isInternalChange.current) return;
      const text = editor.getValue();
      pending.current = text;
      setDraft(text);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, MARP_TYPING_PAUSE_MS);
    };
    editor.session.on("change", onSessionChange);

    // Changes dispatched directly on the textarea (e.g. testing-library fireEvent.change)
    const onTextareaChange = (event: Event) => {
      // Programmatic whole-source changes are accepted; native changes belong to Ace's input buffer.
      if (isAceBuffer || event.isTrusted) return;
      const nextVal = nativeValueGetter?.call(textarea) ?? textarea.value;
      if (typeof nextVal === "string" && editor.getValue() !== nextVal) {
        isInternalChange.current = true;
        try {
          editor.setValue(nextVal, -1);
        } finally {
          isInternalChange.current = false;
        }
        pending.current = nextVal;
        setDraft(nextVal);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, MARP_TYPING_PAUSE_MS);
      }
    };
    textarea.addEventListener("change", onTextareaChange);

    // Cursor / caret line updates
    const onCursor = () => {
      if (isAceBuffer || isInternalChange.current || document.activeElement !== textarea) return;
      const range = editor.getSelectionRange();
      const line = range.start.row;
      if (line === caretLine.current) return;
      caretLine.current = line;
      if (!isInsideEffect.current && document.activeElement === textarea && typeof flushSync === "function") {
        flushSync(() => {
          onCaretLineRef.current?.(editor.getValue(), line);
        });
      } else {
        onCaretLineRef.current?.(editor.getValue(), line);
      }
    };
    editor.selection.on("changeCursor", onCursor);
    textarea.addEventListener("select", onCursor);

    // Blur flushes pending draft
    const onBlur = () => {
      caretLine.current = null;
      flush();
    };
    editor.on("blur", onBlur);
    textarea.addEventListener("blur", onBlur);

    // Resize observer
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        editor.resize();
      });
      resizeObserver.observe(container);
    }

    // Dark theme observer
    let themeObserver: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      themeObserver = new MutationObserver(() => {
        const dark = getIsDark();
        editor.setTheme(dark ? "ace/theme/github_dark" : "ace/theme/github");
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-theme"],
      });
    }

      return () => {
        isInternalChange.current = true;
        editor.off("mousedown", onEditorMouseDown);
        editor.session.off("change", onSessionChange);
        textarea.removeEventListener("change", onTextareaChange);
        textarea.removeEventListener("select", onCursor);
        textarea.removeEventListener("blur", onBlur);
        textarea.removeEventListener("keydown", onKeyDown, true);
        textarea.removeEventListener("mousedown", stopMouse);
        textarea.removeEventListener("mouseup", stopMouse);
        if (areaRef && areaRef.current === textarea) {
          areaRef.current = null;
        }
        resizeObserver?.disconnect();
        themeObserver?.disconnect();
        editor.destroy();
        container.innerHTML = "";
        editorRef.current = null;
      };
    } finally {
      isInsideEffect.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update editor value when source prop or draft changes externally
  useEffect(() => {
    isInsideEffect.current = true;
    try {
      const editor = editorRef.current;
      if (!editor) return;
      const target = draft ?? source;
      if (editor.getValue() !== target) {
        isInternalChange.current = true;
        try {
          const cursor = editor.getCursorPosition();
          editor.setValue(target, -1);
          editor.moveCursorToPosition(cursor);

        } finally {
          isInternalChange.current = false;
        }
      }
    } finally {
      isInsideEffect.current = false;
    }
    const active = editorRef.current;
    if (active && document.activeElement === active.textInput.getElement())
      onCaretLineRef.current?.(active.getValue(), active.getCursorPosition().row);
  }, [source, draft]);

  // Update readOnly
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setReadOnly(readOnly);
    const textarea = editor.textInput.getElement() as HTMLTextAreaElement;
    if (textarea) textarea.readOnly = readOnly;
  }, [readOnly]);

  // Update aria-invalid
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const textarea = editor.textInput.getElement() as HTMLTextAreaElement;
    if (!textarea) return;
    if (invalid) textarea.setAttribute("aria-invalid", "true");
    else textarea.removeAttribute("aria-invalid");
  }, [invalid]);

  // Update aria-label
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const textarea = editor.textInput.getElement() as HTMLTextAreaElement;
    if (!textarea) return;
    textarea.setAttribute("aria-label", label);
  }, [label]);

  // Update mode
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.session.setMode(`ace/mode/${mode}`);
  }, [mode]);

  return (
    <div
      className={`marp-editor-host${invalid ? " marp-editor-invalid" : ""}`}
      style={{
        flex: 1,
        width: "100%",
        height: "100%",
        minHeight: 0,
        position: "relative",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        ref={containerRef}
        className="marp-ace-editor"
        style={{
          flex: 1,
          width: "100%",
          height: "100%",
          minHeight: 0,
        }}
      />
    </div>
  );
}
