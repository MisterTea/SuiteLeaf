import { semanticPoint, semanticTextLength } from "./slide-text-selection";
import { readSlideMath } from "./slide-math";
import { textAreaWidthPt } from "./slide-office-wrap";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { TextRun } from "@suiteleaf/core";
import { paintFontFamily } from "@suiteleaf/core";
import {
  cleanRun,
  hasTextRuns,
  mergeRuns,
  plainText,
  replaceRunRange,
  runsOf,
  runsToHtml,
} from "./slide-runs";
import { continueList, listShortcut } from "./slide-list";
import "./slide-text.css";

export function runStyle(run: TextRun, baseFontSize?: number): CSSProperties {
  return {
    fontWeight: run.bold ? 700 : 400,
    fontStyle: run.italic ? "italic" : "normal",
    textDecoration: [run.underline ? "underline" : "", run.strike ? "line-through" : ""]
      .filter(Boolean)
      .join(" ") || "none",
    ...(run.color ? { color: run.color } : {}),
    ...(run.highlight ? { backgroundColor: run.highlight } : {}),
    ...(run.fontSize
      ? {
          fontSize: baseFontSize
            ? `${run.fontSize / baseFontSize}em`
            : `${run.fontSize}px`,
        }
      : {}),
    ...(run.caps === "all" ? { textTransform: "uppercase" as const } : {}),
    ...(run.caps === "small"
      ? { fontVariantCaps: "small-caps" as const, fontSynthesis: "small-caps" as const }
      : {}),
    ...(run.baseline
      ? { position: "relative" as const, top: `${-run.baseline / 100}em`, lineHeight: 0 }
      : {}),
    ...(run.font ? { fontFamily: paintFontFamily(run.font) } : {}),
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
  fontSize,
}: {
  content?: string;
  runs?: TextRun[];
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
}) {
  if (!hasTextRuns({ runs })) return <>{content}</>;
  return runsOf({ content, runs, bold, italic, underline }).map(
    (run, index) => (
      <span key={index} style={runStyle(run, fontSize)}>
        {run.scriptScale ? <span style={{ fontSize: "calc(100% * 2 / 3)" }}>{run.text}</span> : run.text}
      </span>
    ),
  );
}

type StyleAttr = Partial<
  Pick<
    TextRun,
    | "bold"
    | "italic"
    | "underline"
    | "strike"
    | "color"
    | "highlight"
    | "fontSize"
    | "font"
    | "paragraphBreak"
    | "baseline"
    | "scriptScale"
    | "scriptStrut"
    | "tracking"
    | "listMarker"
    | "href"
  >
>;

function styleFrom(el: HTMLElement): StyleAttr {
  const next: StyleAttr = {};
  if (el.dataset.bold === "1" || el.tagName === "B" || el.tagName === "STRONG")
    next.bold = true;
  if (el.dataset.italic === "1" || el.tagName === "I" || el.tagName === "EM")
    next.italic = true;
  if (el.dataset.underline === "1" || el.tagName === "U") next.underline = true;
  if (el.dataset.strike === "1" || el.tagName === "S" || el.tagName === "DEL") next.strike = true;
  if (el.dataset.color) next.color = el.dataset.color;
  if (el.dataset.highlight) next.highlight = el.dataset.highlight;
  if (el.dataset.fontSize && Number(el.dataset.fontSize) > 0)
    next.fontSize = Number(el.dataset.fontSize);
  if (el.dataset.listMarker === "1") next.listMarker = true;
  if (el.dataset.paragraphBreak === "1") next.paragraphBreak = true;
  if (el.dataset.baseline && Number(el.dataset.baseline))
    next.baseline = Number(el.dataset.baseline);
  if (el.dataset.scriptScale === "1") next.scriptScale = true;
  if (Number(el.dataset.scriptStrut) > 0) next.scriptStrut = Number(el.dataset.scriptStrut);
  if (el.dataset.tracking && Number.isFinite(Number(el.dataset.tracking)))
    next.tracking = Math.max(-4000, Math.min(4000, Number(el.dataset.tracking)));
  if (el.dataset.font) next.font = el.dataset.font;
  if (el.dataset.href && /^(https?:|mailto:)/i.test(el.dataset.href))
    next.href = el.dataset.href;
  return next;
}

/** Read the editor DOM back into runs. Typing stays inside the span it started in. */
function paragraphMetrics(el: HTMLElement): Partial<TextRun> {
  const next: Partial<TextRun> = {};
  if (el.dataset.paraDistributed === "1") next.paraDistributed = true;
  const margin = Number(el.dataset.paraMargin);
  const hang = Number(el.dataset.paraHang);
  const before = Number(el.dataset.spaceBefore);
  if (margin) next.paraMargin = margin;
  if (hang) next.paraHang = hang;
  const first = Number(el.dataset.paraFirst);
  if (first) next.paraFirst = first;
  if (before) next.spaceBefore = before;
  const align = el.dataset.paraAlign;
  if (align === "left" || align === "center" || align === "right" || align === "justify")
    next.paraAlign = align;
  const line = Number(el.dataset.paraLine);
  if (line > 0) next.paraLine = line;
  const linePoints = Number(el.dataset.paraLinePt);
  if (linePoints > 0) next.paraLinePt = linePoints;
  return next;
}

export function runsFromDom(root: HTMLElement): TextRun[] {
  const runs: TextRun[] = [];
  let stamp: Partial<TextRun> | null = null;
  const walk = (node: Node, style: StyleAttr) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\u00a0/g, " ");
      if (text) {
        const bulletSrc = node.parentElement
          ?.closest("[data-bullet-src]")
          ?.getAttribute("data-bullet-src");
        runs.push(
          cleanRun({
            ...style,
            ...stamp,
            text,
            ...(bulletSrc ? { bulletSrc } : {}),
          }),
        );
        stamp = null;
      }
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.slideMath) {
      const math = readSlideMath(node.dataset.slideMath);
      if (math) { runs.push(cleanRun({ ...style, ...stamp, ...math })); stamp = null; return; }
    }
    if (node.tagName === "BR") {
      runs.push({ ...style, text: "\n" });
      return;
    }
    // Each mixed-size hard break is its own line. The break sits before that line.
    if (node.dataset.slideLine === "1") {
      if (runs.length && !runs[runs.length - 1]?.text.endsWith("\n")) {
        const fontSize = Number(node.dataset.fontSize);
        runs.push({
          text: "\n",
          ...(fontSize > 0 ? { fontSize } : {}),
        });
      }
      for (const child of node.childNodes) walk(child, style);
      return;
    }
    const next = { ...style, ...styleFrom(node) };
    const para = node.dataset.slidePara === "1";
    const block = node.tagName === "DIV" || node.tagName === "P" || para;
    if (block && runs.length && !runs[runs.length - 1]?.text.endsWith("\n")) {
      runs.push(
        para
          ? cleanRun({ text: "\n", paragraphBreak: true, ...paragraphMetrics(node) })
          : { text: "\n" },
      );
    } else if (para && !runs.length) stamp = paragraphMetrics(node);
    for (const child of node.childNodes) walk(child, next);
  };
  for (const child of root.childNodes) walk(child, {});
  return mergeRuns(runs);
}

export function selectionOffsets(
  root: HTMLElement,
): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode)
    return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode))
    return null;
  const measure = (node: Node, offset: number) => {
    const pre = document.createRange();
    pre.selectNodeContents(root);
    pre.setEnd(node, offset);
    return semanticTextLength(pre.cloneContents());
  };
  const start = measure(sel.anchorNode, sel.anchorOffset);
  const end = measure(sel.focusNode, sel.focusOffset);
  return start <= end ? { start, end } : { start: end, end: start };
}

export function restoreSelection(
  root: HTMLElement,
  start: number,
  end: number,
) {
  const first = semanticPoint(root, start);
  const last = semanticPoint(root, end);
  if (!first || !last) return;
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset);
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
  kern,
  hang,
  fontFamily,
  fontSize,
  lineHeight,
  lineHeightPt,
  align,
  nowrap,
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
  kern?: number;
  /** Shared hanging indent, in slide pixels, when list items do not each carry one. */
  hang?: number;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  lineHeightPt?: number;
  align?: "left" | "center" | "right" | "justify";
  nowrap?: boolean;
  placeholder?: string;
  editing: boolean;
  onText: (runs: TextRun[], opts?: { bullet?: boolean }) => void;
  onCaret: (sel: { start: number; end: number } | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onTextRef = useRef(onText);
  const onCaretRef = useRef(onCaret);
  onTextRef.current = onText;
  onCaretRef.current = onCaret;
  const measuredWithFonts = useRef(false);
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) setFontsReady(true);
    });
    return () => {
      live = false;
    };
  }, []);
  const signature = JSON.stringify(
    runsOf({ content, runs, bold, italic, underline }),
  );

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const expected = runsOf({ content, runs, bold, italic, underline });
    const remeasure = fontsReady && !measuredWithFonts.current;
    const unwrapForEditing = editing && !!node.querySelector("[data-slide-soft-line]");
    if (!remeasure && !unwrapForEditing && JSON.stringify(runsFromDom(node)) === JSON.stringify(expected)) {
      node.dataset.empty = plainText(expected) ? "false" : "true";
      return;
    }
    const sel =
      editing && document.activeElement === node
        ? selectionOffsets(node)
        : null;
    const widthPt = fontsReady && !editing ? textAreaWidthPt(node, fontSize) : undefined;
    const style = getComputedStyle(node);
    const unitPt = fontSize ? (parseFloat(style.getPropertyValue("--canvas-fit")) || 1) / (parseFloat(style.fontSize) / fontSize) : 1;
    node.innerHTML = runsToHtml(expected, kern, hang, { fontFamily, fontSize, bold, italic, lineHeight, lineHeightPt, align, nowrap, widthPt, unitPt });
    node.dataset.empty = plainText(expected) ? "false" : "true";
    if (fontsReady) measuredWithFonts.current = true;
    if (sel) restoreSelection(node, sel.start, sel.end);
  }, [signature, editing, content, runs, bold, italic, underline, kern, hang, fontFamily, fontSize, lineHeight, lineHeightPt, align, nowrap, fontsReady]);

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
      onDoubleClick={(event) => {
        if (!editing) return;
        const root = ref.current;
        if (!root) return;
        if ((window.getSelection()?.toString() ?? "").trim()) return;
        const doc = root.ownerDocument;
        const caret =
          doc.caretRangeFromPoint?.(event.clientX, event.clientY) ??
          (() => {
            const pos = doc.caretPositionFromPoint?.(
              event.clientX,
              event.clientY,
            );
            if (!pos) return null;
            const range = doc.createRange();
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
            return range;
          })();
        const node = caret?.startContainer;
        if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node))
          return;
        const text = node.textContent ?? "";
        let start = caret.startOffset;
        let end = start;
        while (start > 0 && !/\s/.test(text[start - 1] ?? "")) start -= 1;
        while (end < text.length && !/\s/.test(text[end] ?? "")) end += 1;
        if (end <= start) return;
        const range = doc.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        const selection = doc.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }}
      onKeyDown={(e) => {
        if (
          e.key !== "Enter" ||
          e.shiftKey ||
          e.altKey ||
          e.metaKey ||
          e.ctrlKey
        )
          return;
        const node = ref.current;
        if (!node) return;
        const sel = selectionOffsets(node);
        if (!sel || sel.start !== sel.end) return;
        const current = runsFromDom(node);
        const next = continueList(plainText(current), sel.start);
        if (!next) return;
        e.preventDefault();
        const runs = replaceRunRange(
          current,
          next.from,
          next.to,
          next.replacement,
        );
        node.innerHTML = runsToHtml(runs, kern, hang, { fontFamily, fontSize, bold, italic, lineHeight, lineHeightPt, align, nowrap });
        node.dataset.empty = plainText(runs) ? "false" : "true";
        restoreSelection(node, next.caret, next.caret);
        onTextRef.current(runs);
      }}
      onInput={() => {
        const node = ref.current;
        if (!node) return;
        const current = runsFromDom(node);
        const sel = selectionOffsets(node);
        const text = plainText(current);
        if (sel && sel.start === sel.end) {
          const next = listShortcut(text, sel.start);
          if (next) {
            const runs = replaceRunRange(
              current,
              next.from,
              next.to,
              next.replacement,
            );
            node.innerHTML = runsToHtml(runs, kern, hang, { fontFamily, fontSize, bold, italic, lineHeight, lineHeightPt, align, nowrap });
            node.dataset.empty = plainText(runs) ? "false" : "true";
            restoreSelection(node, next.caret, next.caret);
            onTextRef.current(runs, next.bullet ? { bullet: true } : undefined);
            return;
          }
        }
        onTextRef.current(current);
      }}
    />
  );
}
