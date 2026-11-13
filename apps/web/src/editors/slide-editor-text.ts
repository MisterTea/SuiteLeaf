import { handStyle } from "./slide-theme";
import { runsOf } from "./slide-runs";
import { rangeColor, rangeHas, styleSelection, styleWholeBox } from "./slide-run-format";
import { toggleSlideCellMark } from "./slide-table-format";
import type { SlidesEditorState } from "./slide-editor-state";
import type { SlideUpdates } from "./slide-editor-elements";

/** Bold, italic, underline, colour, and alignment for the selected words or box. */
export function slideTextFormat(
  state: SlidesEditorState,
  { updateElement, textDeck }: Pick<SlideUpdates, "updateElement"> & { textDeck: () => typeof state.deck },
) {
  const {
    deckRef, activeDeckSlide, textRange, setCaretMarks, selectedElementRef, editingRef,
    setEditingId, stageRef, tableCellRef,
  } = state;

  const rememberCaret = (
    id: string,
    sel: { start: number; end: number } | null,
  ) => {
    if (!sel) return;
    textRange.current = { id, ...sel };
    const slide = activeDeckSlide(textDeck());
    const el = slide?.elements.find((item) => item.id === id);
    if (!el) return;
    const runs = runsOf(el);
    const next = {
      id,
      bold: rangeHas(runs, sel.start, sel.end, "bold"),
      italic: rangeHas(runs, sel.start, sel.end, "italic"),
      underline: rangeHas(runs, sel.start, sel.end, "underline"),
      color: rangeColor(runs, sel.start, sel.end),
    };
    setCaretMarks((prev) =>
      prev &&
      prev.id === next.id &&
      prev.bold === next.bold &&
      prev.italic === next.italic &&
      prev.underline === next.underline &&
      prev.color === next.color
        ? prev
        : next,
    );
  };

  const selectedText = () => {
    const slide = activeDeckSlide(textDeck());
    const el = slide?.elements.find(
      (item) => item.id === selectedElementRef.current,
    );
    return el?.type === "text" ? el : null;
  };

  const selectionIn = (id: string) => {
    const stored = textRange.current;
    if (editingRef.current === id && stored?.id === id && stored.end > stored.start)
      return stored;
    const area = stageRef.current?.querySelector<HTMLTextAreaElement>(
      `[data-element-id="${CSS.escape(id)}"] textarea`,
    );
    if (
      area &&
      document.activeElement === area &&
      area.selectionEnd > area.selectionStart
    )
      return { id, start: area.selectionStart, end: area.selectionEnd };
    return null;
  };
  const formatText = (kind: "bold" | "italic" | "underline") => {
    const slide = activeDeckSlide(textDeck());
    const selected = slide?.elements.find(
      (item) => item.id === selectedElementRef.current,
    );
    const cell = tableCellRef.current;
    if (
      selected?.type === "table" &&
      cell?.id === selected.id &&
      (kind === "bold" || kind === "italic")
    ) {
      const next = toggleSlideCellMark(selected, cell.row, cell.col, kind);
      if (next) updateElement(selected.id, next);
      return;
    }
    const el = selectedText();
    if (!el) return;
    const range = selectionIn(el.id);
    if (range) {
      const next = styleSelection(el, range.start, range.end, { type: kind });
      updateElement(el.id, next);
      textRange.current = range;
      if (editingRef.current !== el.id) {
        editingRef.current = el.id;
        setEditingId(el.id);
      }
      const runs = runsOf(next);
      setCaretMarks({
        id: el.id,
        bold: rangeHas(runs, range.start, range.end, "bold"),
        italic: rangeHas(runs, range.start, range.end, "italic"),
        underline: rangeHas(runs, range.start, range.end, "underline"),
        color: rangeColor(runs, range.start, range.end),
      });
      return;
    }
    if (editingRef.current === el.id) return;
    updateElement(el.id, styleWholeBox(el, kind));
  };
  const toggleBold = () => formatText("bold");
  const toggleItalic = () => formatText("italic");
  const toggleUnderline = () => formatText("underline");
  const applyAccent = () => {
    const el = selectedText();
    if (!el) return;
    const color = (deckRef.current.theme?.accent ?? "#188038").toLowerCase();
    const range = selectionIn(el.id);
    if (range) {
      const next = styleSelection(el, range.start, range.end, {
        type: "color",
        color,
      });
      updateElement(el.id, next);
      textRange.current = range;
      if (editingRef.current !== el.id) {
        editingRef.current = el.id;
        setEditingId(el.id);
      }
      const runs = runsOf(next);
      setCaretMarks({
        id: el.id,
        bold: rangeHas(runs, range.start, range.end, "bold"),
        italic: rangeHas(runs, range.start, range.end, "italic"),
        underline: rangeHas(runs, range.start, range.end, "underline"),
        color: rangeColor(runs, range.start, range.end),
      });
      return;
    }
    if (editingRef.current === el.id) return;
    // A MARP box's own color is the theme's; the markdown colors its words.
    if (deckRef.current.marp)
      updateElement(el.id, styleSelection(el, 0, (el.content ?? "").length, { type: "color", color }));
    else updateElement(el.id, handStyle({ color }));
  };
  const alignText = (alignment: "left" | "center" | "right") => {
    const el = selectedText();
    if (el) updateElement(el.id, { align: alignment });
  };

  return {
    rememberCaret,
    selectedText,
    selectionIn,
    formatText,
    toggleBold,
    toggleItalic,
    toggleUnderline,
    applyAccent,
    alignText,
  };
}

export type SlideTextFormat = ReturnType<typeof slideTextFormat>;
