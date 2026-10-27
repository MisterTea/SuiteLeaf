import { startTransition, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { lineAt } from "./slide-marp-source";

/** How long typing must pause before the slides follow the markdown. */
export const MARP_TYPING_PAUSE_MS = 500;

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
  const text = area.value;
  const backward = area.selectionDirection === "backward";
  const caret = backward ? area.selectionStart : area.selectionEnd;
  const anchor = backward ? area.selectionEnd : area.selectionStart;
  const lines = text.split("\n");
  const line = lineAt(text, caret);
  const column = caret - (text.lastIndexOf("\n", caret - 1) + 1);
  const height = parseFloat(getComputedStyle(area).lineHeight) || 19;
  const step = Math.max(1, Math.floor(area.clientHeight / height) - 1);
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
    area.setSelectionRange(Math.min(anchor, next), Math.max(anchor, next), next < anchor ? "backward" : "forward");
  else area.setSelectionRange(next, next);
  area.scrollTop += direction * step * height;
  scrollMarkdownTo(area, next);
}

export type MarpDraft = { flush: () => void };

/**
 * The deck's markdown. Typing changes only this box; the slides follow once
 * typing pauses, when the box loses focus, or when `draftRef` is flushed, and
 * they redraw as a low-priority update that more typing can interrupt.
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
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const caretLine = useRef<number | null>(null);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const text = pending.current;
    if (text === null) return;
    pending.current = null;
    // Clearing the draft in the same update shows the deck's markdown as the slides change.
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

  return (
    <textarea
      ref={areaRef}
      className="marp-textarea"
      aria-label={label}
      aria-invalid={invalid || undefined}
      readOnly={readOnly}
      spellCheck={false}
      value={draft ?? source}
      onChange={(e) => {
        pending.current = e.target.value;
        setDraft(e.target.value);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, MARP_TYPING_PAUSE_MS);
      }}
      onKeyDown={(e) => {
        if (e.key !== "PageDown" && e.key !== "PageUp") return;
        if (e.altKey || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        pageCaret(e.currentTarget, e.key === "PageDown" ? 1 : -1, e.shiftKey);
      }}
      onSelect={(e) => {
        const area = e.currentTarget;
        const caret = area.selectionDirection === "backward" ? area.selectionStart : area.selectionEnd;
        const line = lineAt(area.value, caret);
        if (line === caretLine.current) return;
        caretLine.current = line;
        onCaretLine?.(area.value, line);
      }}
      onBlur={() => {
        caretLine.current = null;
        flush();
      }}
    />
  );
}
