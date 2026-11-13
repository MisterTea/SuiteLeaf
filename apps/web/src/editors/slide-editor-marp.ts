import { sourceValue, selectSourceRange, sourceHeight, setSourceScrollTop } from "./slide-source-control";
import { useEffect, useRef } from "react";
import type { SlideFile } from "@suiteleaf/core";
import { deckToMarp } from "./slide-marp";
import { fitMarpDeck, MARP_FIT_REVISION } from "./slide-marp-fit";
import { marpLineStart, marpSlideAtLine, marpSlideScrollLine } from "./slide-marp-source";
import { deckFromMarkdown, keepUnchangedParts, withMarpLayout } from "./slide-marp-sync";
import { scrollMarkdownTo } from "./slide-marp-textarea";
import type { SlidesEditorState } from "./slide-editor-state";
import type { DeckHistoryApi } from "./slide-editor-history";

/** A MARP deck's markdown pane: laying slides out from it, and keeping it beside the slide. */
export function useMarpEditing(
  state: SlidesEditorState,
  {
    marpInvalid,
    applyDeck,
    applySelection,
    commit,
    typingOnCanvas,
    relayoutMarp,
  }: Pick<
    DeckHistoryApi,
    "applyDeck" | "applySelection" | "commit" | "typingOnCanvas" | "relayoutMarp"
  > & { marpInvalid: string | null },
) {
  const {
    deck, deckRef, readOnlyRef, setDeck, historyRef, commitRef, editingId, marpStale, setMarpOpen,
    marpAreaRef, activeSlideId, marpOpen, selectedElementId, activeRef, anchorRef, setMarpWarnings,
  } = state;

  // A MARP deck saved before its markdown was kept starts from the markdown its slides write.
  useEffect(() => {
    const start = deckRef.current;
    if (!start.marp || start.marpSource !== undefined) return;
    const next = deckFromMarkdown(start, deckToMarp(start)).deck;
    if (readOnlyRef.current) {
      deckRef.current = next;
      setDeck(next);
      return;
    }
    historyRef.current!.amend(next);
    applyDeck(next);
    // Runs once, for the deck the editor opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fitToken = useRef(0);
  useEffect(() => {
    if (!deck.marp || !deck.marpSource || deck.marpFit === MARP_FIT_REVISION || marpInvalid) return;
    const token = ++fitToken.current;
    const source = deck.marpSource;
    const settle = (laid: SlideFile["content"] | null) => {
      const current = deckRef.current;
      if (token !== fitToken.current || current.marpSource !== source || current.marpFit === MARP_FIT_REVISION)
        return;
      const next = laid
        ? keepUnchangedParts(current, withMarpLayout(current, laid))
        : { ...current, marpFit: MARP_FIT_REVISION };
      if (readOnlyRef.current) {
        deckRef.current = next;
        setDeck(next);
        return;
      }
      commitRef.current(next, "marp-fit");
    };
    const handle = window.setTimeout(() => {
      const stale = () => token !== fitToken.current || deckRef.current.marpSource !== source;
      void fitMarpDeck(deckRef.current, { stale })
        .then((laid) => (stale() ? undefined : settle(laid)))
        .catch((error: unknown) => {
          console.error(error instanceof Error ? error.message : error);
          settle(null);
        });
    }, 120);
    return () => window.clearTimeout(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [deck.marp, deck.marpSource, deck.marpFit, marpInvalid]);

  useEffect(() => {
    if (!editingId && marpStale.current && !typingOnCanvas()) relayoutMarp();
    // Only a change of the box being edited ends a typing session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  /** Open the markdown pane with these lines selected and in view. */
  const revealMarkdown = (lines?: [number, number]) => {
    if (!lines) return;
    setMarpOpen(true);
    requestAnimationFrame(() => {
      const area = marpAreaRef.current;
      if (!area) return;
      const all = sourceValue(area).split("\n");
      const start = all.slice(0, lines[0]).join("\n").length + (lines[0] > 0 ? 1 : 0);
      const end = all.slice(0, lines[1]).join("\n").length;
      area.focus();
      selectSourceRange(area, start, Math.max(start, end));
      const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 19;
      setSourceScrollTop(area, Math.max(0, lines[0] * lineHeight - sourceHeight(area) / 3));
    });
  };

  // Choosing a slide shows where it is written, unless the markdown caret is what moved the slide.
  const shownMarkdownSlide = useRef(activeSlideId);
  useEffect(() => {
    if (shownMarkdownSlide.current === activeSlideId) return;
    shownMarkdownSlide.current = activeSlideId;
    if (!deck.marp || !marpOpen || selectedElementId) return;
    const area = marpAreaRef.current;
    if (!area || document.activeElement === area) return;
    const index = deckRef.current.slideOrder.indexOf(activeSlideId);
    const line = marpSlideScrollLine(sourceValue(area), index);
    if (line === null) return;
    const at = marpLineStart(sourceValue(area), line);
    selectSourceRange(area, at, at);
    scrollMarkdownTo(area, at);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [deck.marp, marpOpen, activeSlideId, selectedElementId]);

  // Choosing a box on the slide shows where it is written, without leaving the slide.
  useEffect(() => {
    if (!deck.marp || !marpOpen || !selectedElementId) return;
    const lines = deckRef.current.slides[activeRef.current]?.elements.find(
      (el) => el.id === selectedElementId,
    )?.marpLines;
    const area = marpAreaRef.current;
    if (!lines || !area || document.activeElement === area) return;
    const at = marpLineStart(sourceValue(area), lines[0]);
    selectSourceRange(area, at, at);
    scrollMarkdownTo(area, at);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [deck.marp, marpOpen, selectedElementId]);

  /** The slide follows the caret in the markdown. */
  const followMarkdownCaret = (text: string, line: number) => {
    const order = deckRef.current.slideOrder;
    const id = order[Math.min(marpSlideAtLine(text, line), order.length - 1)];
    if (!id || id === activeRef.current) return;
    anchorRef.current = id;
    applySelection(id, [id], null);
  };

  const onMarpChange = (text: string) => {
    if (readOnlyRef.current) return;
    marpStale.current = false;
    const result = deckFromMarkdown(deckRef.current, text);
    setMarpWarnings(result.warnings);
    commit(keepUnchangedParts(deckRef.current, result.deck), "marp");
    if (!result.deck.slides[activeRef.current]) {
      const id = result.deck.slideOrder[0];
      applySelection(id, [id], null);
    }
  };

  return { revealMarkdown, followMarkdownCaret, onMarpChange };
}
