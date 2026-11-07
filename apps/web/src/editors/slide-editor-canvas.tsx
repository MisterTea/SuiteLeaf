import type { ReactNode, RefObject } from "react";
import { slidePointScale, type Slide, type SlideElement, type SlideFile } from "@suiteleaf/core";
import { slidePictureToEdit } from "./svg-picture-edit";
import { hasTextRuns } from "./slide-runs";
import { SlideTextBody } from "./slide-text";
import { SlideSpellMirror } from "./grid-spelling-ui";
import { proofingLanguage } from "./proofing-language";
import { editorFadeAttrs, editorFadeClass } from "./slide-fade-in";
import { FadeOnClickMark } from "./slide-fade-mark";
import { deckToMarp } from "./slide-marp";
import { MarpBackdrop, type MarpPages } from "./slide-marp-backdrop";
import { SlideFace, type SlideBoxProps, type SlideFaceHooks } from "./slide-surface";
import { MarpSplitHandle } from "./slide-marp-split";
import { MarpTextarea, type MarpDraft } from "./slide-marp-textarea";
import { continueList, listShortcut } from "./slide-list";
import type { ResizeHandle, SlidesEditorState } from "./slide-editor-state";
import type { DeckHistoryApi } from "./slide-editor-history";
import type { SlideElementActions, SlideUpdates } from "./slide-editor-elements";
import type { SlideTextFormat } from "./slide-editor-text";

/** The editor's part of the shared drawing: selection, editing, handles, and table cells. */
export function editorCanvasHooks(
  state: SlidesEditorState,
  {
    file,
    readOnly,
    liveId,
    onError,
    onElementMouseDown,
    onElementPointerDown,
    onElementPointerUp,
    updateElement,
    rememberCaret,
    selectElement,
    revealMarkdown,
  }: Pick<SlideUpdates, "updateElement"> &
    Pick<SlideTextFormat, "rememberCaret"> &
    Pick<SlideElementActions, "selectElement"> & {
      file: SlideFile;
      readOnly: boolean;
      liveId: string | null;
      onError: (s: string) => void;
      onElementMouseDown: (e: React.MouseEvent, elementId: string, handle?: ResizeHandle) => void;
      onElementPointerDown: (e: React.PointerEvent, elementId: string, handle?: ResizeHandle) => void;
      onElementPointerUp: (e: React.PointerEvent) => void;
      revealMarkdown: (lines?: [number, number]) => void;
    },
) {
  const {
    deck, editingId, setEditingId, editingRef, spellCaret, setSpellCaret, selectedElementId,
    setSelectedElementId, selectedElementRef, readOnlyRef, textRange, activeRef, setSvgEdit,
    marpOpen, tableCell, setTableCell,
  } = state;

  const renderHandles = (elementId: string) => (
    <div className="selection-handles" onPointerDown={(e) => {
      const handle = (e.target as HTMLElement).className.match(/handle-(nw|ne|se|sw|n|e|s|w)\b/)?.[1] as ResizeHandle | undefined;
      if (handle) onElementPointerDown(e, elementId, handle);
    }} onPointerUp={onElementPointerUp}>
      <div
        className="resize-handle handle-nw"
        onMouseDown={(e) => onElementMouseDown(e, elementId, "nw")}
      />
      <div
        className="resize-handle handle-n"
        onMouseDown={(e) => onElementMouseDown(e, elementId, "n")}
      />
      <div
        className="resize-handle handle-ne"
        onMouseDown={(e) => onElementMouseDown(e, elementId, "ne")}
      />
      <div
        className="resize-handle handle-e"
        onMouseDown={(e) => onElementMouseDown(e, elementId, "e")}
      />
      <div
        className="resize-handle handle-se"
        onMouseDown={(e) => onElementMouseDown(e, elementId, "se")}
      />
      <div
        className="resize-handle handle-s"
        onMouseDown={(e) => onElementMouseDown(e, elementId, "s")}
      />
      <div
        className="resize-handle handle-sw"
        onMouseDown={(e) => onElementMouseDown(e, elementId, "sw")}
      />
      <div
        className="resize-handle handle-w"
        onMouseDown={(e) => onElementMouseDown(e, elementId, "w")}
      />
    </div>
  );

  /**
   * The editor's words: the box being typed in, and plain text, which is typed into directly.
   * A textarea cannot hang each list item's marker, so list items never use one.
   */
  const editorText = (el: SlideElement) =>
    editingId === el.id || hasTextRuns(el) || el.hang ? (
        <SlideTextBody
          content={el.content}
          runs={el.runs}
          bold={el.bold}
          italic={el.italic}
          underline={el.underline}
          kern={el.kern}
          hang={el.hang}
          fontFamily={el.fontFamily}
          fontSize={el.fontSize}
          lineHeight={el.lineHeight}
          lineHeightPt={el.lineHeightPt}
          align={el.align}
          nowrap={el.nowrap}
          placeholder={el.placeholder}
          editing={editingId === el.id && !readOnly}
          onText={(runs, opts) =>
            updateElement(
              el.id,
              {
                content: runs.map((run) => run.text).join(""),
                runs: hasTextRuns({ runs }) ? runs : undefined,
                bold: false,
                italic: false,
                underline: false,
                ...(opts?.bullet ? { bullet: true } : {}),
              },
              { coalesce: `type:${el.id}` },
            )
          }
          onCaret={(sel) => rememberCaret(el.id, sel)}
        />
      ) : (
        <>
          <SlideSpellMirror
            text={el.content || ""}
            fileId={file.id}
            language={proofingLanguage(deck.proofingLanguage)}
            caret={spellCaret?.id === el.id ? spellCaret.at : null}
          />
          <textarea
            className="element-textarea"
            readOnly={readOnly}
            value={el.content || ""}
            placeholder={el.placeholder ?? "Click to add text"}
            onFocus={(e) => {
              selectElement(el.id);
              setSpellCaret({
                id: el.id,
                at: e.currentTarget.selectionStart ?? 0,
              });
            }}
            onBlur={() =>
              setSpellCaret((current) =>
                current?.id === el.id ? null : current,
              )
            }
            onSelect={(e) =>
              setSpellCaret({
                id: el.id,
                at: e.currentTarget.selectionStart ?? 0,
              })
            }
            onKeyDown={(e) => {
              if (
                e.key !== "Enter" ||
                e.shiftKey ||
                e.altKey ||
                e.metaKey ||
                e.ctrlKey
              )
                return;
              const node = e.currentTarget;
              const caret = node.selectionStart ?? 0;
              if ((node.selectionEnd ?? caret) !== caret) return;
              const next = continueList(node.value, caret);
              if (!next) return;
              e.preventDefault();
              updateElement(
                el.id,
                { content: next.text },
                { coalesce: `type:${el.id}` },
              );
              const pos = next.caret;
              requestAnimationFrame(() =>
                node.setSelectionRange(pos, pos),
              );
            }}
            onChange={(e) => {
              const raw = e.target.value;
              const caret = e.target.selectionStart ?? raw.length;
              const next =
                e.target.selectionEnd === caret
                  ? listShortcut(raw, caret)
                  : null;
              updateElement(
                el.id,
                {
                  content: next?.text ?? raw,
                  ...(next?.bullet ? { bullet: true } : {}),
                },
                { coalesce: `type:${el.id}` },
              );
              setSpellCaret({ id: el.id, at: next?.caret ?? caret });
              if (!next) return;
              const node = e.target;
              const pos = next.caret;
              requestAnimationFrame(() =>
                node.setSelectionRange(pos, pos),
              );
            }}
          />
        </>
    );
  const canvasHooks: SlideFaceHooks = {
    box: (el) => {
      const isSelected = el.id === selectedElementId;
      const position = { "data-element-id": el.id, "data-x": el.x, "data-y": el.y };
      if (el.type === "shape" && el.marpHtml)
        return {
          className: isSelected ? " selected" : "",
          props: {
            ...position,
            "aria-label": "HTML block. Double-click to edit it in the markdown.",
            title: "HTML block. Double-click to edit it in the markdown.",
            onMouseDown: (e) => onElementMouseDown(e, el.id),
            onClick: (e) => e.stopPropagation(),
            onDoubleClick: (e) => {
              e.stopPropagation();
              revealMarkdown(el.marpLines);
            },
          },
        };
      const live = (el.type === "text" || el.type === "table") && el.id === liveId;
      const props: SlideBoxProps = {
        ...position,
        ...editorFadeAttrs(el),
        onMouseDown: (e) => onElementMouseDown(e, el.id),
        onClick: (e) => e.stopPropagation(),
        onPointerDown: (e) => onElementPointerDown(e, el.id),
        onPointerUp: onElementPointerUp,
      };
      if (el.type === "text") {
        props.onMouseDown = (e) => {
          if ((e.target as HTMLElement).closest?.("a[href]")) return;
          const inEditor = (e.target as HTMLElement).closest?.(".element-editor");
          if (editingRef.current === el.id && inEditor) return;
          onElementMouseDown(e, el.id);
        };
        props.onDoubleClick = (e) => {
          e.stopPropagation();
          if (readOnlyRef.current) return;
          editingRef.current = el.id;
          textRange.current = null;
          setEditingId(el.id);
          selectedElementRef.current = el.id;
          setSelectedElementId(el.id);
        };
      }
      const svgPicture = slidePictureToEdit(deck, activeRef.current, el);
      if (svgPicture) {
        if ("edit" in svgPicture)
          props.title = `Double-click to edit ${svgPicture.edit.asset ?? "this picture"} in Drawing`;
        props.onDoubleClick = (e) => {
          e.stopPropagation();
          if ("edit" in svgPicture) setSvgEdit(svgPicture.edit);
          else if ("missing" in svgPicture)
            onError(
              `${svgPicture.missing} did not come in with the deck. Import the deck's folder to bring it in, then try again.`,
            );
          else onError("This picture's SVG could not be read.");
        };
      }
      if (el.type === "image" && el.href)
        props.onMouseDown = (e) => {
          if ((e.target as HTMLElement).closest?.("a[href]")) return;
          onElementMouseDown(e, el.id);
        };
      if (el.type === "audio" || el.type === "video")
        props.onMouseDown = (e) => {
          if ((e.target as HTMLElement).closest?.(".slide-media-play")) return;
          e.preventDefault();
          onElementMouseDown(e, el.id);
        };
      return {
        className: `${isSelected ? " selected" : ""}${live ? " marp-live" : ""}${editorFadeClass(el)}`,
        props,
      };
    },
    text: (el) =>
      editingId === el.id || !(el.preformatted || el.math || el.content?.includes("$"))
        ? editorText(el)
        : undefined,
    before: (el) => <FadeOnClickMark element={el} />,
    after: (el) =>
      el.type === "shape" && el.marpHtml ? (
        <span className="marp-html-label">HTML</span>
      ) : el.id === selectedElementId && !readOnly && !marpOpen && !deck.marp ? (
        renderHandles(el.id)
      ) : null,
    cell: (el, row, col) => ({
      className:
        tableCell?.id === el.id && tableCell.row === row && tableCell.col === col
          ? "slide-cell-selected"
          : undefined,
      onMouseDown: (event) => {
        event.stopPropagation();
        onElementMouseDown(event, el.id);
        setTableCell({ id: el.id, row, col });
      },
    }),
  };
  return canvasHooks;
}

/** The slide being edited, the markdown beside it, and its speaker notes. */
export function SlideCanvasStage({
  state,
  readOnly,
  slideComments,
  activeSlide,
  shownSlide,
  currentSlideIndex,
  canvasHooks,
  marpPages,
  marpSplit,
  setMarpSplit,
  marpInvalid,
  marpPending,
  fittedView,
  showBackdrop,
  liveLines,
  marpDraft,
  typingOnCanvas,
  relayoutMarp,
  selectElement,
  updateSlide,
  onMarpChange,
  followMarkdownCaret,
}: Pick<DeckHistoryApi, "typingOnCanvas" | "relayoutMarp"> &
  Pick<SlideElementActions, "selectElement"> &
  Pick<SlideUpdates, "updateSlide"> & {
    state: SlidesEditorState;
    readOnly: boolean;
    slideComments: { notice: ReactNode; marks: ReactNode; dock: ReactNode };
    activeSlide: Slide;
    shownSlide: Slide;
    currentSlideIndex: number;
    canvasHooks: SlideFaceHooks;
    marpPages: MarpPages | null;
    marpSplit: number;
    setMarpSplit: (next: number, done: boolean) => void;
    marpInvalid: string | null;
    marpPending: boolean;
    fittedView: boolean;
    showBackdrop: boolean;
    liveLines: [number, number] | null;
    marpDraft: RefObject<MarpDraft | null>;
    onMarpChange: (text: string) => void;
    followMarkdownCaret: (text: string, line: number) => void;
  }) {
  const {
    deck, marpOpen, setMarpOpen, stageRef, textPress, setFocusedBox, marpStale, painted, setPainted,
    canvasMotion, snapGuide, marpWarnings, marpAreaRef, showNotes, setShowNotes,
  } = state;
  return (
    <div className="slides-canvas-stage">
      {slideComments.notice}
      {deck.marp ? (
        <button
          type="button"
          className="mobile-marp-view-toggle"
          aria-pressed={marpOpen}
          onClick={() => {
            marpDraft.current?.flush();
            selectElement(null);
            setMarpOpen(!marpOpen);
          }}
        >
          {marpOpen ? "Show slide editor" : "Show markdown"}
        </button>
      ) : null}
      <div
        className={`slide-stage-row${deck.marp && marpOpen ? " showing-markdown" : ""}`}
        style={deck.marp && marpOpen ? { ["--marp-split" as string]: marpSplit } : undefined}
      >
      <div
        className="slide-stage-viewport"
        ref={stageRef}
        onClick={() => {
          if (textPress.current) return;
          selectElement(null);
        }}
        onFocusCapture={(e) => {
          const box = (e.target as HTMLElement).closest?.<HTMLElement>("[data-element-id]");
          setFocusedBox(box?.dataset.elementId ?? null);
        }}
        onBlurCapture={(e) => {
          const box = (e.target as HTMLElement).closest?.("[data-element-id]");
          const next = (e.relatedTarget as HTMLElement | null)?.closest?.("[data-element-id]");
          if (box && box === next) return;
          setFocusedBox(null);
          if (!marpStale.current) return;
          window.setTimeout(() => {
            if (marpStale.current && !typingOnCanvas()) relayoutMarp();
          });
        }}
      >
        {deck.marp && marpInvalid ? (
          <div className="marp-invalid" role="alert">
            <strong>The markdown is invalid.</strong>
            <p>{marpInvalid}</p>
            <p>The slides will show again once the markdown is fixed.</p>
          </div>
        ) : (
        <div
          className={`slide-canvas slide-surface print-slide${fittedView ? " marp-fit" : ""}${marpPending ? " marp-pending" : ""}${showBackdrop && painted ? " marp-painted" : ""}${canvasMotion ? ` deck-motion-${canvasMotion.type}` : ""}`}
          aria-busy={marpPending || undefined}
          style={{
            backgroundColor:
              shownSlide?.background?.color ||
              deck.master?.background?.color ||
              "#ffffff",
            aspectRatio: `${deck.width || 960} / ${deck.height || 540}`,
            ["--deck-motion" as string]: `${canvasMotion?.ms ?? 0}ms`,
            ["--slide-pt-base" as string]: String(slidePointScale(deck.width, deck.pointWidth)),
            ["--slide-draw" as string]: `${deck.width || 960}px`,
          }}
        >
          <div className="slide-canvas-fit">
            {showBackdrop ? (
              <MarpBackdrop
                pages={marpPages}
                index={currentSlideIndex}
                live={liveLines}
                onPainted={setPainted}
              />
            ) : null}
            <SlideFace
              deck={deck}
              slide={shownSlide}
              index={currentSlideIndex}
              hooks={canvasHooks}
            />
            {slideComments.marks}
            {snapGuide?.x != null ? (
              <div
                className="slide-snap-guide"
                style={{ left: `${(snapGuide.x / (deck.width || 960)) * 100}%` }}
              />
            ) : null}
            {snapGuide?.y != null ? (
              <div
                className="slide-snap-guide horizontal"
                style={{ top: `${(snapGuide.y / (deck.height || 540)) * 100}%` }}
              />
            ) : null}
          </div>
        </div>
        )}
      </div>
      {deck.marp && marpOpen ? (
        <MarpSplitHandle split={marpSplit} onSplit={setMarpSplit} />
      ) : null}
      {deck.marp && marpOpen ? (
        <aside className="marp-pane" aria-label="Markdown">
          {marpInvalid
            ? null
            : marpWarnings.map((warning) => (
                <p className="marp-warning" key={warning}>
                  {warning}
                </p>
              ))}
          <MarpTextarea
            source={deck.marpSource ?? deckToMarp(deck)}
            readOnly={readOnly}
            invalid={!!marpInvalid}
            onCommit={onMarpChange}
            areaRef={marpAreaRef}
            draftRef={marpDraft}
            onCaretLine={followMarkdownCaret}
          />
        </aside>
      ) : null}
      {slideComments.dock}
      </div>

      <div id="slide-speaker-notes" className={`speaker-notes-pane${showNotes ? " open" : ""}`}>
        <div
          className="notes-drag-handle"
          onClick={() => setShowNotes(!showNotes)}
          title={
            showNotes ? "Collapse speaker notes" : "Expand speaker notes"
          }
        >
          <div className="notes-drag-bar" />
        </div>
        {showNotes ? (
          <textarea
            className="notes-textarea"
            readOnly={readOnly || !!marpInvalid}
            placeholder="Click to add speaker notes"
            value={activeSlide?.notes || ""}
            onChange={(e) =>
              updateSlide(
                { notes: e.target.value },
                activeSlide ? `notes:${activeSlide.id}` : undefined,
              )
            }
          />
        ) : null}
      </div>
    </div>
  );
}
