import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { TextRun } from "@suiteleaf/core";
import {
  cleanRun,
  hasTextRuns,
  mergeRuns,
  plainText,
  runsOf,
  runsToHtml,
} from "./slide-runs";
import "./slide-text.css";

export function runStyle(run: TextRun): CSSProperties {
  return {
    fontWeight: run.bold ? 700 : 400,
    fontStyle: run.italic ? "italic" : "normal",
    textDecoration: run.underline ? "underline" : "none",
    ...(run.color ? { color: run.color } : {}),
  };
}

/** Box font, unless runs already carry per-word weight, style, and colour. */
export function boxFont(el: {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  runs?: TextRun[];
}): CSSProperties {
  if (hasTextRuns(el)) {
    return { fontWeight: 400, fontStyle: "normal", textDecoration: "none" };
  }
  return {
    fontWeight: el.bold ? 700 : 400,
    fontStyle: el.italic ? "italic" : "normal",
    textDecoration: el.underline ? "underline" : "none",
  };
}

export function RunSpans({
  content,
  runs,
  bold,
  italic,
  underline,
}: {
  content?: string;
  runs?: TextRun[];
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}) {
  if (!hasTextRuns({ runs })) return <>{content}</>;
  return runsOf({ content, runs, bold, italic, underline }).map((run, index) => (
    <span key={index} style={runStyle(run)}>
      {run.text}
    </span>
  ));
}

type StyleAttr = Partial<Pick<TextRun, "bold" | "italic" | "underline" | "color">>;

function styleFrom(el: HTMLElement): StyleAttr {
  const next: StyleAttr = {};
  if (el.dataset.bold === "1" || el.tagName === "B" || el.tagName === "STRONG")
    next.bold = true;
  if (el.dataset.italic === "1" || el.tagName === "I" || el.tagName === "EM")
    next.italic = true;
  if (el.dataset.underline === "1" || el.tagName === "U") next.underline = true;
  if (el.dataset.color) next.color = el.dataset.color;
  return next;
}

/** Read the editor DOM back into runs. Typing stays inside the span it started in. */
export function runsFromDom(root: HTMLElement): TextRun[] {
  const runs: TextRun[] = [];
  const walk = (node: Node, style: StyleAttr) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\u00a0/g, " ");
      if (text) runs.push(cleanRun({ ...style, text }));
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      runs.push({ ...style, text: "\n" });
      return;
    }
    const next = { ...style, ...styleFrom(node) };
    const block = node.tagName === "DIV" || node.tagName === "P";
    if (block && runs.length && !runs[runs.length - 1]?.text.endsWith("\n"))
      runs.push({ text: "\n" });
    for (const child of node.childNodes) walk(child, next);
  };
  for (const child of root.childNodes) walk(child, {});
  return mergeRuns(runs);
}

export function selectionOffsets(
  root: HTMLElement,
): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  const measure = (node: Node, offset: number) => {
    const pre = document.createRange();
    pre.selectNodeContents(root);
    pre.setEnd(node, offset);
    return pre.toString().length;
  };
  const start = measure(sel.anchorNode, sel.anchorOffset);
  const end = measure(sel.focusNode, sel.focusOffset);
  return start <= end ? { start, end } : { start: end, end: start };
}

export function restoreSelection(root: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = node.textContent?.length ?? 0;
    if (!startNode && seen + len >= start) {
      startNode = node;
      startOffset = start - seen;
    }
    if (seen + len >= end) {
      endNode = node;
      endOffset = end - seen;
      break;
    }
    seen += len;
  }
  if (!startNode || !endNode) return;
  const range = document.createRange();
  range.setStart(startNode, Math.min(startOffset, startNode.textContent?.length ?? 0));
  range.setEnd(endNode, Math.min(endOffset, endNode.textContent?.length ?? 0));
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function SlideTextBody({
  content,
  runs,
  bold,
  italic,
  underline,
  placeholder,
  editing,
  onText,
  onCaret,
}: {
  content?: string;
  runs?: TextRun[];
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  placeholder?: string;
  editing: boolean;
  onText: (runs: TextRun[]) => void;
  onCaret: (sel: { start: number; end: number } | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onTextRef = useRef(onText);
  const onCaretRef = useRef(onCaret);
  onTextRef.current = onText;
  onCaretRef.current = onCaret;
  const signature = JSON.stringify(runsOf({ content, runs, bold, italic, underline }));

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const expected = runsOf({ content, runs, bold, italic, underline });
    if (JSON.stringify(runsFromDom(node)) === JSON.stringify(expected)) {
      node.dataset.empty = plainText(expected) ? "false" : "true";
      return;
    }
    const sel =
      editing && document.activeElement === node ? selectionOffsets(node) : null;
    node.innerHTML = runsToHtml(expected);
    node.dataset.empty = plainText(expected) ? "false" : "true";
    if (sel) restoreSelection(node, sel.start, sel.end);
  }, [signature, editing, content, runs, bold, italic, underline]);

  useLayoutEffect(() => {
    if (!editing) return;
    const node = ref.current;
    if (!node || document.activeElement === node) return;
    node.focus();
  }, [editing]);

  useLayoutEffect(() => {
    if (!editing) return;
    const node = ref.current;
    if (!node) return;
    const report = () => onCaretRef.current(selectionOffsets(node));
    document.addEventListener("selectionchange", report);
    return () => document.removeEventListener("selectionchange", report);
  }, [editing]);

  return (
    <div
      ref={ref}
      className="element-textarea element-editor"
      contentEditable={editing}
      suppressContentEditableWarning
      role={editing ? "textbox" : undefined}
      aria-multiline={editing ? true : undefined}
      aria-label={placeholder || "Slide text"}
      data-placeholder={placeholder || "Click to add text"}
      spellCheck={false}
      onMouseDown={(e) => {
        if (editing) e.stopPropagation();
      }}
      onInput={() => {
        const node = ref.current;
        if (!node) return;
        onTextRef.current(runsFromDom(node));
      }}
    />
  );
}
