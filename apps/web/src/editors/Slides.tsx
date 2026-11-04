import { SlidePrintDeck } from "./slide-print";
import { SlideAccessPanel } from "./slide-access-notes";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { applySlidePictureEdit } from "./svg-picture-edit";

const EmbeddedDrawing = lazy(() => import("./drawing-embed"));
import { titleTextColor, slideAccessWrites, type SlideFile } from "@suiteleaf/core";
import { SlideHandouts } from "./slide-handouts";
import { WordArtDialog } from "./slide-word-art";
import type { EditorActions } from "../ui";
import { deletedSlidesMessage } from "./slide-editing";
import { resetToTheme } from "./slide-theme";
import { useSlideComments } from "./slide-comments-ui";
import { MARP_FIT_REVISION } from "./slide-marp-fit";
import { marpProblem } from "./slide-marp-source";
import { useMarpPages } from "./slide-marp-backdrop";
import { useMarpSplit } from "./slide-marp-split";
import { slideSelectionLabel, type RemoteSlideSelection, type SlideSelection } from "../collab/selection";
import type * as Y from "yjs";
import { useSlidesEditorState } from "./slide-editor-state";
import { useDeckHistory } from "./slide-editor-history";
import { slideCommands, slideOrderActions } from "./slide-editor-commands";
import { useMarpEditing } from "./slide-editor-marp";
import { SlideContextMenu, SlideThumbnails, useThumbnailDrag, type SlideDrag } from "./slide-editor-thumbnails";
import { slideDesign } from "./slide-editor-design";
import { slideElementActions, useSlideUpdates } from "./slide-editor-elements";
import { slideTextFormat } from "./slide-editor-text";
import { useElementDrag } from "./slide-editor-drag";
import { useSlideExports } from "./slide-editor-exports";
import { useShowControls, useShowPlayback } from "./slide-editor-show";
import { useSlidesAgentHost } from "./slide-editor-agent";
import { useSlideEditorActions, useSlideEditorKeys } from "./slide-editor-actions";
import { editorCanvasHooks, SlideCanvasStage } from "./slide-editor-canvas";
import { SlidesToolbar } from "./slide-editor-toolbar";
import { SlideFormatTools } from "./slide-editor-format-tools";
import { SlideEditorPanels } from "./slide-editor-panels";
import { SlideShowOverlay } from "./slide-editor-presenter";

export default function Slides({
  file,
  onChange,
  onActions,
  onError,
  readOnly = false,
  fileId,
  slideId,
  onSlideUrl,
  collabDoc = null,
  remoteSelections = [],
  onLocalSelection,
  onUndoConflict,
}: {
  file: SlideFile;
  onChange: (content: SlideFile["content"], op?: unknown) => void;
  onActions: (actions: EditorActions) => void;
  onError: (s: string) => void;
  /** Viewers can present, but not change slides or text. */
  readOnly?: boolean;
  /** The open file, so each slide can be a link. */
  fileId?: string;
  /** The slide named in the address. A reload opens this slide. */
  slideId?: string;
  /** Keep the address on the slide that is showing. */
  onSlideUrl?: (slideId: string) => void;
  /** Shared room. Remote slides are applied without being written back. */
  collabDoc?: Y.Doc | null;
  /** Another person's slide. It does not change the slide on this screen. */
  remoteSelections?: RemoteSlideSelection[];
  onLocalSelection?: (selection: SlideSelection) => void;
  onUndoConflict?: (text: string) => void;
}) {
  const state = useSlidesEditorState({ file, slideId, onSlideUrl, onChange, readOnly });
  const {
    deck, activeSlideId, selectedElementId, editingId, focusedBox, tableCell, notice,
    contextMenu, setContextMenu, presenting, accessOpen, wordArtOpen, setWordArtOpen,
    handoutsOpen, setHandoutsOpen, svgEdit, setSvgEdit, setPanel, apiRef, deckRef, commitRef,
    anchorRef, readOnlyRef, imageInputRef, audioInputRef, videoInputRef,
  } = state;
  const history = useDeckHistory(state, {
    collabDoc,
    onLocalSelection,
    slideId,
    onChange,
    onError,
    onUndoConflict,
  });
  const { applySelection, commit, undo, redo, marpDraft } = history;

  // Active slide
  const activeSlide =
    deck.slides[activeSlideId] || deck.slides[deck.slideOrder[0]];
  const selectedElement =
    activeSlide?.elements.find((el) => el.id === selectedElementId) || null;
  /** The box being typed in. It shows its own words over MARP's drawing. */
  const liveId = editingId ?? focusedBox ?? tableCell?.id ?? null;
  const liveLines =
    (liveId && activeSlide?.elements.find((el) => el.id === liveId)?.marpLines) || null;
  const slideComments = useSlideComments({
    deck,
    activeSlideId: activeSlide?.id ?? activeSlideId,
    selectedElementId,
    presenting,
    commit,
    onActivate: (slideId, elementId) => {
      anchorRef.current = slideId;
      applySelection(slideId, [slideId], elementId);
    },
  });
  const {
    openComposer: openSlideComment,
    togglePanel: toggleSlideCommentPanel,
    openResolved: openSlideResolved,
  } = slideComments;

  const ordering = slideOrderActions(state, { commit, applySelection, onError });
  const { addSlide, duplicateCurrentSlide, deleteCurrentSlide, moveSlides } = ordering;

  // Drag thumbnails to reorder. `over` is the gap (0..n) the group would land in.
  const [slideDrag, setSlideDrag] = useState<SlideDrag | null>(null);
  const dragRef = useRef<typeof slideDrag>(null);
  const thumbnailsRef = useRef<HTMLDivElement>(null);
  const suppressThumbnailClick = useRef(false);

  /** The deck for tests to read, with embedded pictures named rather than copied. */
  const deckSnapshot = useMemo(
    () =>
      JSON.stringify(
        deck.marpAssets ? { ...deck, marpAssets: Object.keys(deck.marpAssets) } : deck,
      ),
    [deck],
  );
  const marpInvalid = useMemo(
    () => (deck.marp && deck.marpSource !== undefined ? marpProblem(deck.marpSource) : null),
    [deck.marp, deck.marpSource],
  );
  const marpPending =
    !!deck.marp && deck.marpSource !== undefined && !marpInvalid && deck.marpFit !== MARP_FIT_REVISION;
  /** Draw boxes scaled to the canvas, as the fit placed them, also while the next fit runs. */
  const fittedView = !!deck.marpFit || (!!deck.marp && deck.marpSource !== undefined);
  const showBackdrop = !!deck.marp && deck.marpSource !== undefined && !marpInvalid && !deck.marpSourceDirty;
  /**
   * One drawing serves the editor's backdrop, the thumbnails, and the slideshow.
   * It holds still while a box on the slide is being typed in.
   */
  const marpPages = useMarpPages(deck, { paused: !!liveLines });
  const [marpSplit, setMarpSplit] = useMarpSplit();
  /** The slides on either side of the show stay loaded, so MARP's drawing is ready on arrival. */
  const marpShow = !!deck.marp && !!marpPages;

  const { revealMarkdown, followMarkdownCaret, onMarpChange } = useMarpEditing(state, {
    ...history,
    marpInvalid,
  });
  useThumbnailDrag(state, { dragRef, setSlideDrag, thumbnailsRef, suppressThumbnailClick });

  const design = slideDesign(state, { activeSlide, commit });
  const { applyLayoutToSlide, shownSlide } = design;
  apiRef.current = {
    addSlide,
    applyLayout: applyLayoutToSlide,
    openTheme: () => setPanel("theme"),
    openTransition: () => setPanel("transition"),
  };

  const { updateSlide, updateElement } = useSlideUpdates(state, onChange);
  const objects = slideElementActions(state, { commit, updateElement, onError });
  const { selectElement, addTextBox, addShape, addWordArt, deleteSelectedElement } = objects;
  const textFormat = slideTextFormat(state, { updateElement });
  const { toggleBold, toggleItalic, toggleUnderline, alignText } = textFormat;
  const {
    copySelection,
    cutSelection,
    pasteClipboard,
    runCommand,
    applyAnimation,
    applyFadeToSelection,
    fadeReason,
  } = slideCommands(state, { ...history, ...ordering, ...objects, ...textFormat });

  const latestApi = {
    undo,
    redo,
    cut: cutSelection,
    copy: copySelection,
    paste: pasteClipboard,
    insertTextBox: addTextBox,
    insertImage: () => imageInputRef.current?.click(),
    insertAudio: () => audioInputRef.current?.click(),
    insertVideo: () => videoInputRef.current?.click(),
    insertShape: addShape,
    insertWordArt: () => setWordArtOpen(true),
    newSlide: () => addSlide(),
    duplicate: duplicateCurrentSlide,
    deleteSlides: deleteCurrentSlide,
    move: moveSlides,
    toggleBold,
    toggleItalic,
    toggleUnderline,
    align: alignText,
    fadeOnClick: applyFadeToSelection,
    fadeOnClickReason: () => fadeReason(),
    animate: applyAnimation,
    animationReason: fadeReason,
    run: runCommand,
  };
  const api = useRef(latestApi);
  api.current = latestApi;

  const { onElementMouseDown } = useElementDrag(state, { activeSlide, updateElement });
  const deckExports = useSlideExports(state, { file, marpDraft });
  const { printing, printSlides } = deckExports;
  const showControls = useShowControls(state, { file, marpDraft });
  const { beginShow, endShow } = showControls;
  useSlidesAgentHost(state, { file, commit, applySelection, beginShow, endShow, ...deckExports });

  const currentSlideIndex = Math.max(0, deck.slideOrder.indexOf(activeSlideId));
  useSlideEditorActions(state, {
    ...history,
    ...ordering,
    ...deckExports,
    beginShow,
    onActions,
    onChange,
    api,
    openSlideComment,
    toggleSlideCommentPanel,
    openSlideResolved,
  });
  useSlideEditorKeys(state, { api, beginShow });
  const playback = useShowPlayback(state, { ...showControls, activeSlide });

  const canvasHooks = editorCanvasHooks(state, {
    file,
    readOnly,
    liveId,
    onError,
    onElementMouseDown,
    updateElement,
    rememberCaret: textFormat.rememberCaret,
    selectElement,
    revealMarkdown,
  });

  return (
    <div
      className="slides-editor"
      data-deck-snapshot={deckSnapshot}
    >
      <SlidePrintDeck active={printing} deck={deck} />
      {notice && !presenting ? (
        <div className="slides-notice" role="status">
          <span>{deletedSlidesMessage(notice.count)}</span>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={undo}>
            Undo
          </button>
        </div>
      ) : null}
      {contextMenu ? (
        <SlideContextMenu
          contextMenu={contextMenu}
          setContextMenu={setContextMenu}
          duplicateCurrentSlide={duplicateCurrentSlide}
          deleteCurrentSlide={deleteCurrentSlide}
          moveSlides={moveSlides}
        />
      ) : null}
      {/* Slides Toolbar */}
      <SlidesToolbar
        state={state}
        readOnly={readOnly}
        activeSlide={activeSlide}
        currentSlideIndex={currentSlideIndex}
        undo={undo}
        redo={redo}
        addSlide={addSlide}
        {...objects}
        printSlides={printSlides}
        beginShow={beginShow}
        formatTools={
          <SlideFormatTools
            state={state}
            activeSlide={activeSlide}
            selectedElement={selectedElement}
            commit={commit}
            updateElement={updateElement}
            deleteSelectedElement={deleteSelectedElement}
            {...textFormat}
            {...design}
          />
        }
      />

      {selectedElement?.themeOverride && deck.theme && !deck.marp ? (
        <div className="theme-override-bar" role="status">
          <span>Overrides theme</span>
          <button
            type="button"
            onClick={() =>
              updateElement(
                selectedElement.id,
                resetToTheme(selectedElement, deck.theme!),
              )
            }
          >
            Reset to theme
          </button>
        </div>
      ) : selectedElement?.type === "text" && editingId !== selectedElement.id ? (
        <div className="format-hint-bar">
          Double-click a word to format just that word.
        </div>
      ) : null}

      {/* Main Slides Editor Body */}
      {accessOpen ? (
        <SlideAccessPanel
          elements={activeSlide?.elements ?? []}
          order={activeSlide?.readingOrder}
          title={activeSlide?.title ?? ""}
          background={activeSlide?.background?.color ?? "#ffffff"}
          textColor={titleTextColor(activeSlide?.elements ?? [], activeSlide?.title ?? "")}
          texts={Object.fromEntries(
            (activeSlide?.elements ?? [])
              .filter((element) => element.type === "text")
              .map((element) => [element.id, element.content ?? ""]),
          )}
          tables={Object.fromEntries(
            (activeSlide?.elements ?? [])
              .filter((element) => element.type === "table")
              .map((element) => [element.id, element.rows ?? []]),
          )}
          onMove={(order) => updateSlide({ readingOrder: order })}
          onEdit={(nextPieces, nextTexts) => {
            for (const write of slideAccessWrites(activeSlide?.elements ?? [], nextPieces, nextTexts)) {
              const id = write.id;
              if ("alt" in write) {
                updateElement(id, { alt: write.alt }, { coalesce: `access-${id}` });
              } else if ("decorative" in write) {
                updateElement(id, { decorative: write.decorative }, { coalesce: `access-${id}` });
              } else if ("content" in write) {
                updateElement(id, { content: write.content }, { coalesce: `access-${id}` });
              } else {
                updateElement(id, { rows: write.rows }, { coalesce: `access-${id}` });
              }
            }
          }}
        />
      ) : null}
      {remoteSelections.length ? (
        <p className="slides-remote-selections">
          {remoteSelections
            .map((selection) =>
              slideSelectionLabel(selection, deck.slides[selection.slideId]?.title),
            )
            .join(", ")}
        </p>
      ) : null}
      <div className="slides-main">
        {/* Left Thumbnails Panel */}
        <SlideThumbnails
          state={state}
          readOnly={readOnly}
          fileId={fileId}
          marpPages={marpPages}
          slideDrag={slideDrag}
          setSlideDrag={setSlideDrag}
          dragRef={dragRef}
          thumbnailsRef={thumbnailsRef}
          suppressThumbnailClick={suppressThumbnailClick}
          applySelection={applySelection}
          {...ordering}
        />

        {/* Center Slide Canvas */}
        <SlideCanvasStage
          state={state}
          readOnly={readOnly}
          slideComments={slideComments}
          activeSlide={activeSlide}
          shownSlide={shownSlide}
          currentSlideIndex={currentSlideIndex}
          canvasHooks={canvasHooks}
          marpPages={marpPages}
          marpSplit={marpSplit}
          setMarpSplit={setMarpSplit}
          marpInvalid={marpInvalid}
          marpPending={marpPending}
          fittedView={fittedView}
          showBackdrop={showBackdrop}
          liveLines={liveLines}
          marpDraft={marpDraft}
          typingOnCanvas={history.typingOnCanvas}
          relayoutMarp={history.relayoutMarp}
          selectElement={selectElement}
          updateSlide={updateSlide}
          onMarpChange={onMarpChange}
          followMarkdownCaret={followMarkdownCaret}
        />
        <SlideEditorPanels
          state={state}
          file={file}
          activeSlide={activeSlide}
          applyDeck={history.applyDeck}
          applySelection={applySelection}
          commit={commit}
          updateElement={updateElement}
          selectElement={selectElement}
          {...design}
        />
      </div>

      {/* Presentation Fullscreen Mode Modal */}
      {presenting ? (
        <SlideShowOverlay
          state={state}
          file={file}
          marpShow={marpShow}
          marpPages={marpPages}
          controls={showControls}
          playback={playback}
        />
      ) : null}
      {wordArtOpen ? (
        <WordArtDialog
          onCancel={() => setWordArtOpen(false)}
          onInsert={(text, style) => {
            addWordArt(text, style);
            setWordArtOpen(false);
          }}
        />
      ) : null}
      {handoutsOpen ? (
        <SlideHandouts deck={deck} onClose={() => setHandoutsOpen(false)} />
      ) : null}
      {svgEdit ? (
        <Suspense fallback={null}>
          <EmbeddedDrawing
            svg={svgEdit.svg}
            name={svgEdit.asset ?? undefined}
            parentTitle={file.title}
            readOnly={readOnly}
            onClose={(svg) => {
              setSvgEdit(null);
              if (svg === null || readOnlyRef.current) return;
              const applied = applySlidePictureEdit(deckRef.current, svgEdit, svg);
              if ("error" in applied) onError(applied.error);
              else commitRef.current(applied.deck);
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
