import { SlidePrintDeck, useSlidePrint } from "./slide-print";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { heightForNewShape, isSvgDataUri, svgDataUri, svgFromDataUri } from "./svg-data";
import { marpMediaSrc } from "./slide-marp-import";

const EmbeddedDrawing = lazy(() => import("./drawing-embed"));
import {
  Play,
  Plus,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Type,
  Square,
  Circle,
  ImagePlus,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  Undo2,
  Redo2,
  X,
  Printer,
  MousePointer2,
  Minus,
  StickyNote,
  Blend,
  Palette,
  PaintBucket,
  Paintbrush,
  LayoutTemplate,
  FileText,
} from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  filename,
  slideOp,
  type SlideFile,
  type Slide,
  type SlideElement,
  type SlideTheme,
} from "@suiteleaf/core";
import { exportBinary, exportText, printDocument } from "../storage";
import { PresenterNextSlide } from "./slide-master-ui";
import { SlideHandouts } from "./slide-handouts";
import { WordArtDialog } from "./slide-word-art";
import { SlideMasterPanel } from "./slide-master-panel";
import { AnimationPane } from "./slide-animation-pane";
import { SlideshowRecorder } from "./slide-record";
import { readMaster } from "./slide-master";
import { Menu, MenuItem, Tool, type EditorActions } from "../ui";
import { FontControls } from "./font-controls";
import { MenuSearchPill } from "../command-palette";
import {
  applyBackground,
  applyLayout,
  type Layout,
} from "./slide-layouts";
import { useAgentHost } from "../ai/host";
import { slideSnapshot, slideSpellingReview, slideTools, type SlidesAgentContext } from "../ai/tools/slides";
import {
  DeckHistory,
  arrowsTaken,
  canDeleteSlides,
  canMove,
  centeredTextBox,
  commandFromKey,
  deletedSlidesMessage,
  deleteSlides,
  duplicateSlides,
  extendSelection,
  logoImage,
  mediaDataUrl,
  mediaElement,
  mediaMime,
  moveSelection,
  pastedElements,
  pasteSlides,
  rangeIds,
  reorderGroup,
  shapeElement,
  wordArtElement,
  toggleId,
  type WordArtStyle,
  typingContext,
  withElements,
  withoutElements,
  type MoveWhere,
  type SlideCommand,
} from "./slide-editing";
import {
  DECK_THEMES,
  THEME_FONTS,
  TRANSITION_CHOICES,
  applyDeckTheme,
  customizeTheme,
  handStyle,
  layoutWithTheme,
  paintSlide,
  resetToTheme,
  setTransitionDuration,
  setTransitions,
  shapeDefaults,
  slideFromTheme,
  textDefaults,
  transitionMs,
  type TransitionType,
} from "./slide-theme";
import { SlideDesignPanel, useReducedMotion } from "./slide-design-panel";
import {
  hasTextRuns,
  rangeColor,
  rangeHas,
  replaceRunRange,
  runsOf,
  styleSelection,
  styleWholeBox,
} from "./slide-runs";
import { SlideTextBody } from "./slide-text";
import { useSlideThemeLibrary } from "./slide-theme-library";
import { replaceSlideWord } from "./grid-spelling";
import { SlideSpellMirror, SlideSpelling } from "./grid-spelling-ui";
import { useSlideComments } from "./slide-comments-ui";
import { toggleSlideCellMark } from "./slide-table-format";
import {
  applySlideAnimation,
  FADE_ON_CLICK,
  audienceClass,
  audiencePhase,
  editorFadeAttrs,
  editorFadeClass,
  fadeOnClickIds,
  fadeOnClickReason,
  type SlideAnimationKind,
  moveShowCursor,
  samePlace,
  startOfShow,
  type ShowCursor,
  type ShowMove,
} from "./slide-fade-in";
import { FadeOnClickMark } from "./slide-fade-mark";
import {
  deckToMarp,
  isMarpChrome,
  isMarpTitle,
  reorderFittedMarpItem,
  reorderMarpItem,
  reflowMarp,
  switchMarpLayout,
} from "./slide-marp";
import { deckToHtml } from "./slide-html";
import { fitMarpDeck, MARP_FIT_REVISION } from "./slide-marp-fit";
import { marpLineStart, marpProblem, marpSlideAtLine } from "./slide-marp-source";
import { deckFromMarkdown, keepUnchangedParts, syncMarpSource, withMarpLayout } from "./slide-marp-sync";
import { MarpBackdrop, useMarpPages } from "./slide-marp-backdrop";
import { SlideFace, SlideStill, type SlideBoxProps, type SlideFaceHooks } from "./slide-surface";
import { MarpSplitHandle, useMarpSplit } from "./slide-marp-split";
import { MarpTextarea, scrollMarkdownTo, type MarpDraft } from "./slide-marp-textarea";
import { continueList, listShortcut } from "./slide-list";

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";


export default function Slides({
  file,
  onChange,
  onActions,
  onError,
  readOnly = false,
}: {
  file: SlideFile;
  onChange: (content: SlideFile["content"], op?: unknown) => void;
  onActions: (actions: EditorActions) => void;
  onError: (s: string) => void;
  /** Viewers can present, but not change slides or text. */
  readOnly?: boolean;
}) {
  const [deck, setDeck] = useState<SlideFile["content"]>(() =>
    structuredClone(file.content),
  );
  const [activeSlideId, setActiveSlideId] = useState<string>(
    file.content.slideOrder[0] || "",
  );
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null,
  );
  /**
   * The SVG picture open in Drawing and what it was when it opened. In a MARP
   * deck, `asset` is the file the markdown names, which Drawing edits instead.
   */
  const [svgEdit, setSvgEdit] = useState<{ id: string; svg: string; asset: string | null } | null>(null);
  const [tableCell, setTableCell] = useState<{
    id: string;
    row: number;
    col: number;
  } | null>(null);
  const tableCellRef = useRef(tableCell);
  tableCellRef.current = tableCell;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [caretMarks, setCaretMarks] = useState<{
    id: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    color?: string;
  } | null>(null);
  const [selectedSlideIds, setSelectedSlideIds] = useState<string[]>([
    file.content.slideOrder[0] || "",
  ]);
  const [notice, setNotice] = useState<{ count: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [historyMarks, setHistoryMarks] = useState({
    undo: false,
    redo: false,
  });
  const [showNotes, setShowNotes] = useState(true);
  const [presenting, setPresenting] = useState(false);
  const [handoutsOpen, setHandoutsOpen] = useState(false);
  const [wordArtOpen, setWordArtOpen] = useState(false);
  const [showCursor, setShowCursor] = useState<ShowCursor>(() => startOfShow());
  const presentSlideIndex = showCursor.slideIndex;
  const [showSpeakerNotes, setShowSpeakerNotes] = useState(false);
  const [blankScreen, setBlankScreen] = useState<string | null>(null);
  const [showStartedAt, setShowStartedAt] = useState(0);
  const [clock, setClock] = useState(0);
  const [panel, setPanel] = useState<"theme" | "transition" | "animation" | "master" | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<SlideshowRecorder | null>(null);
  const [marpOpen, setMarpOpen] = useState(() => !!file.content.marp);
  const [marpWarnings, setMarpWarnings] = useState<string[]>([]);
  const [previewTheme, setPreviewTheme] = useState<SlideTheme | null>(null);
  const [transitionScope, setTransitionScope] = useState<"all" | "selected">(
    "all",
  );
  const [transitionDuration, setDuration] = useState(0.4);
  const [chosenTransition, setChosenTransition] = useState<TransitionType | null>(
    null,
  );
  const [transitionStatus, setTransitionStatus] = useState("");
  const [canvasMotion, setCanvasMotion] = useState<{
    type: TransitionType;
    ms: number;
  } | null>(null);
  const [showMotion, setShowMotion] = useState<{
    index: number;
    type: TransitionType | null;
  }>({ index: -1, type: null });
  const themeEdits = useRef(new Map<string, SlideTheme>());
  const apiRef = useRef<{
    addSlide: (layout: Layout) => void;
    applyLayout: (layout: Layout) => void;
    openTheme: () => void;
    openTransition: () => void;
  }>({
    addSlide: () => {},
    applyLayout: () => {},
    openTheme: () => {},
    openTransition: () => {},
  });
  const reducedMotion = useReducedMotion();
  const { themes: libraryThemes, save: saveLibraryTheme } = useSlideThemeLibrary();

  // Undo/Redo history. Typing in one box collapses into a single step.
  const historyRef = useRef<DeckHistory | null>(null);
  if (!historyRef.current)
    historyRef.current = new DeckHistory(structuredClone(file.content));
  const deckRef = useRef(deck);
  deckRef.current = deck;
  const activeRef = useRef(activeSlideId);
  activeRef.current = activeSlideId;
  const selectedRef = useRef(selectedSlideIds);
  selectedRef.current = selectedSlideIds;
  const selectedElementRef = useRef(selectedElementId);
  selectedElementRef.current = selectedElementId;
  const editingRef = useRef(editingId);
  editingRef.current = editingId;
  const textRange = useRef<{ id: string; start: number; end: number } | null>(
    null,
  );
  const anchorRef = useRef(activeSlideId);
  const presentingRef = useRef(false);
  presentingRef.current = presenting;
  const handoutsRef = useRef(false);
  handoutsRef.current = handoutsOpen;
  const showCursorRef = useRef(showCursor);
  showCursorRef.current = showCursor;
  const moveShowRef = useRef<(where: ShowMove) => void>(() => {});
  const pendingFocus = useRef<string | null>(null);
  /** A press that started in a text box. A click must not drop the selection. */
  const textPress = useRef(false);
  const dragMoved = useRef(false);
  const [spellCaret, setSpellCaret] = useState<{ id: string; at: number } | null>(
    null,
  );
  const liveDirty = useRef(false);
  const clipboard = useRef<
    | { kind: "elements"; elements: SlideElement[] }
    | { kind: "slides"; slides: Slide[] }
    | null
  >(null);
  const commitRef = useRef<
    (next: SlideFile["content"], key?: string) => void
  >(() => {});
  const marpOpenRef = useRef(false);
  marpOpenRef.current = marpOpen;
  /** Typing on the canvas changed the markdown; lay the slide out once the box is left. */
  const marpStale = useRef(false);
  /** MARP's own drawing of the slide is showing behind the boxes. */
  const [painted, setPainted] = useState(false);
  const [focusedBox, setFocusedBox] = useState<string | null>(null);
  const marpAreaRef = useRef<HTMLTextAreaElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const spellingRef = useRef<{ open: () => void }>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{
    elementId: string;
    startX: number;
    startY: number;
    initX: number;
    initY: number;
    handle?: ResizeHandle;
    initW?: number;
    initH?: number;
    reorder?: boolean;
    fitted?: boolean;
  } | null>(null);

  const refreshMarks = () =>
    setHistoryMarks({
      undo: historyRef.current!.canUndo,
      redo: historyRef.current!.canRedo,
    });

  const applyDeck = (next: SlideFile["content"]) => {
    if (readOnlyRef.current) return;
    const op = slideOp(deckRef.current, next);
    deckRef.current = next;
    setDeck(next);
    onChange(next, op);
  };

  const applySelection = (
    activeId: string,
    selected: string[],
    elementId?: string | null,
  ) => {
    activeRef.current = activeId;
    selectedRef.current = selected;
    setActiveSlideId(activeId);
    setSelectedSlideIds(selected);
    if (elementId !== undefined) {
      selectedElementRef.current = elementId;
      setSelectedElementId(elementId);
      if (elementId !== editingRef.current) {
        editingRef.current = null;
        setEditingId(null);
        textRange.current = null;
      }
    }
  };

  const typingOnCanvas = () => {
    if (editingRef.current) return true;
    const active = document.activeElement as HTMLElement | null;
    return (
      !!active &&
      !!stageRef.current?.contains(active) &&
      active.matches("textarea, [contenteditable='true'], [contenteditable='']")
    );
  };

  // Commit changes and push to undo history. In a MARP deck the markdown is the
  // source of truth, so a canvas edit is written into it first.
  const commit = (next: SlideFile["content"], key?: string) => {
    if (readOnlyRef.current) return;
    if (key === "marp-fit") {
      historyRef.current!.amend(next);
      applyDeck(next);
      return;
    }
    const tip = historyRef.current!.tip;
    if (next.marp && tip.marp && tip.marpSource !== undefined && next.marpSource === tip.marpSource) {
      const synced = syncMarpSource(tip, next, { editing: typingOnCanvas() });
      if ("error" in synced) {
        onError(synced.error);
        liveDirty.current = false;
        applyDeck(historyRef.current!.snapshot());
        return;
      }
      next = synced.deck;
      if (synced.relayout === "later") marpStale.current = true;
    }
    historyRef.current!.commit(next, key);
    applyDeck(next);
    setNotice(null);
    refreshMarks();
    liveDirty.current = false;
  };
  commitRef.current = commit;

  /** Lay the slides out again from the markdown, without adding an undo step. */
  const relayoutMarp = () => {
    marpStale.current = false;
    if (readOnlyRef.current || !deckRef.current.marp) return;
    const next = { ...deckRef.current, marpFit: false };
    historyRef.current!.amend(next);
    applyDeck(next);
  };

  const restore = (next: SlideFile["content"] | null) => {
    if (!next) return;
    const oldOrder = deckRef.current.slideOrder;
    const previousActive = activeRef.current;
    const previousIndex = oldOrder.indexOf(previousActive);
    const neighbor =
      oldOrder[previousIndex - 1] || oldOrder[previousIndex + 1] || "";
    const elementId = selectedElementRef.current;
    applyDeck(next);
    const appeared = next.slideOrder.filter((id) => !oldOrder.includes(id));
    if (appeared.length) {
      applySelection(appeared[0], appeared, null);
      setNotice(null);
      refreshMarks();
      liveDirty.current = false;
      return;
    }
    const active = next.slideOrder.includes(previousActive)
      ? previousActive
      : next.slideOrder.includes(neighbor)
        ? neighbor
        : next.slideOrder[
            Math.min(Math.max(previousIndex, 0), next.slideOrder.length - 1)
          ] ||
          next.slideOrder[0] ||
          "";
    const selected = selectedRef.current.filter((id) =>
      next.slideOrder.includes(id),
    );
    if (active && !selected.includes(active)) selected.push(active);
    const slide = next.slides[active];
    const keep =
      active === previousActive &&
      !!elementId &&
      !!slide?.elements.some((el) => el.id === elementId);
    applySelection(active, selected.length ? selected : active ? [active] : [], keep ? elementId : null);
    setNotice(null);
    refreshMarks();
    liveDirty.current = false;
  };

  /** Markdown typed in the pane that the slides have not followed yet. */
  const marpDraft = useRef<MarpDraft | null>(null);
  const flushMarpDraft = () => marpDraft.current?.flush();

  const undo = () => {
    flushMarpDraft();
    marpStale.current = false;
    restore(historyRef.current!.undo());
  };
  const redo = () => {
    flushMarpDraft();
    marpStale.current = false;
    restore(historyRef.current!.redo());
  };

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

  const chosenSlides = () => {
    const order = deckRef.current.slideOrder;
    const ids = order.filter((id) => selectedRef.current.includes(id));
    return ids.length ? ids : activeRef.current ? [activeRef.current] : [];
  };

  // Add new slide
  const addSlide = (layout: Layout = "title-body") => {
    const prev = deckRef.current;
    const marpLayout: Layout =
      prev.marp && layout !== "two-column" ? "title-body" : layout;
    const current =
      prev.slides[activeRef.current] || prev.slides[prev.slideOrder[0]];
    const slide = slideFromTheme(marpLayout, prev.theme, current?.transition);
    const idx = Math.max(0, prev.slideOrder.indexOf(activeRef.current));
    const slideOrder = [...prev.slideOrder];
    slideOrder.splice(idx + 1, 0, slide.id);
    commit({
      ...prev,
      slideOrder,
      slides: { ...prev.slides, [slide.id]: slide },
    });
    anchorRef.current = slide.id;
    applySelection(slide.id, [slide.id], null);
  };

  const duplicateCurrentSlide = () => {
    const result = duplicateSlides(
      deckRef.current,
      chosenSlides(),
      () => crypto.randomUUID(),
    );
    if (!result.newIds.length) return;
    commit(result.deck);
    anchorRef.current = result.newIds[0];
    applySelection(result.newIds[0], result.newIds, null);
  };

  const deleteCurrentSlide = () => {
    const result = deleteSlides(deckRef.current, chosenSlides());
    if ("error" in result) {
      onError(result.error);
      return;
    }
    commit(result.deck);
    anchorRef.current = result.activeId;
    applySelection(result.activeId, [result.activeId], null);
    setNotice({ count: result.removed });
  };

  const moveSlides = (where: MoveWhere) => {
    const prev = deckRef.current;
    const slideOrder = moveSelection(prev.slideOrder, chosenSlides(), where);
    if (slideOrder === prev.slideOrder) return;
    commit({ ...prev, slideOrder });
  };

  // Drag thumbnails to reorder. `over` is the gap (0..n) the group would land in.
  const [slideDrag, setSlideDrag] = useState<{
    ids: string[];
    startY: number;
    over: number | null;
  } | null>(null);
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
      const all = area.value.split("\n");
      const start = all.slice(0, lines[0]).join("\n").length + (lines[0] > 0 ? 1 : 0);
      const end = all.slice(0, lines[1]).join("\n").length;
      area.focus();
      area.setSelectionRange(start, Math.max(start, end));
      const lineHeight = parseFloat(getComputedStyle(area).lineHeight) || 19;
      area.scrollTop = Math.max(0, lines[0] * lineHeight - area.clientHeight / 3);
    });
  };

  // Choosing a box on the slide shows where it is written, without leaving the slide.
  useEffect(() => {
    if (!deck.marp || !marpOpen || !selectedElementId) return;
    const lines = deckRef.current.slides[activeRef.current]?.elements.find(
      (el) => el.id === selectedElementId,
    )?.marpLines;
    const area = marpAreaRef.current;
    if (!lines || !area || document.activeElement === area) return;
    const at = marpLineStart(area.value, lines[0]);
    area.setSelectionRange(at, at);
    scrollMarkdownTo(area, at);
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

  useEffect(() => {
    const gapAt = (y: number) => {
      const rows = [
        ...(thumbnailsRef.current?.querySelectorAll(".thumbnail-row") ?? []),
      ];
      const i = rows.findIndex((row) => {
        const r = row.getBoundingClientRect();
        return y < r.top + r.height / 2;
      });
      return i === -1 ? rows.length : i;
    };
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.over === null && Math.abs(e.clientY - drag.startY) < 6) return;
      const over = gapAt(e.clientY);
      if (over === drag.over) return;
      const next = { ...drag, over };
      dragRef.current = next;
      setSlideDrag(next);
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setSlideDrag(null);
      if (drag.over === null) return;
      suppressThumbnailClick.current = true;
      setTimeout(() => (suppressThumbnailClick.current = false));
      const prev = deckRef.current;
      const slideOrder = reorderGroup(prev.slideOrder, drag.ids, drag.over);
      if (slideOrder === prev.slideOrder) return;
      commitRef.current({ ...prev, slideOrder });
    };
    const onDragStart = (event: DragEvent) => event.preventDefault();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("dragend", onUp);
    window.addEventListener("dragstart", onDragStart);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("dragend", onUp);
      window.removeEventListener("dragstart", onDragStart);
    };
  }, []);

  useEffect(() => {
    thumbnailsRef.current
      ?.querySelector(`[data-slide-id="${activeSlideId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeSlideId, deck.slideOrder]);

  const applyLayoutToSlide = (layout: Layout) => {
    if (!activeSlide) return;
    const chosen: Layout = deck.marp && layout !== "two-column" ? "title-body" : layout;
    const laid = deck.marp
      ? switchMarpLayout(
          activeSlide,
          chosen === "two-column" ? "two-column" : "title-body",
          deck.width,
        )
      : deck.theme
        ? layoutWithTheme(activeSlide, chosen, deck.theme)
        : applyLayout(activeSlide, chosen);
    const next = deck.marp && deck.theme ? paintSlide(laid, deck.theme) : laid;
    commit({
      ...deck,
      slides: { ...deck.slides, [activeSlide.id]: next },
    });
  };

  const setDeckBackground = (color: string, keepSections: boolean) =>
    commit({ ...deck, slides: applyBackground(deck.slides, color, keepSections) });

  const activeDeckSlide = (prev: SlideFile["content"]) =>
    prev.slides[activeRef.current] || prev.slides[prev.slideOrder[0]];

  if (deck.theme) themeEdits.current.set(deck.theme.id, deck.theme);
  const resolveTheme = (theme: SlideTheme) =>
    themeEdits.current.get(theme.id) ?? theme;
  const shownSlide =
    previewTheme && activeSlide ? paintSlide(activeSlide, previewTheme) : activeSlide;

  const useTheme = (theme: SlideTheme) => {
    // Copy so a library snapshot and this deck do not share one object.
    const copy = { ...theme };
    themeEdits.current.set(copy.id, copy);
    setPreviewTheme(null);
    commit(applyDeckTheme(deck, copy));
  };
  const transitionTargets = () =>
    transitionScope === "all" ? deck.slideOrder : selectedSlideIds;
  const describeTransition = (type: TransitionType, count: number) => {
    if (type === "none")
      return count === deck.slideOrder.length
        ? "Cut on every slide"
        : `Cut on ${count} slides`;
    const label = TRANSITION_CHOICES.find((choice) => choice.type === type)?.label;
    const where =
      count === deck.slideOrder.length ? "all slides" : `${count} slides`;
    return `${label} · ${transitionDuration.toFixed(1)} s · ${where}`;
  };
  const pickTransition = (type: TransitionType) =>
    applyTransitionTo(type, transitionTargets());
  apiRef.current = {
    addSlide,
    applyLayout: applyLayoutToSlide,
    openTheme: () => setPanel("theme"),
    openTransition: () => setPanel("transition"),
  };

  const playTransition = () => {
    const current = activeSlide?.transition;
    const type = current?.type && current.type !== "none" ? current.type : chosenTransition;
    if (!type || type === "none") return;
    const ms = transitionMs(
      { type, duration: current?.duration ?? transitionDuration },
      reducedMotion,
    );
    if (ms === 0) return;
    setCanvasMotion(null);
    requestAnimationFrame(() => setCanvasMotion({ type, ms }));
  };
  const applyTransitionTo = (type: TransitionType, ids: readonly string[]) => {
    setChosenTransition(type);
    commit(setTransitions(deck, ids, { type, duration: transitionDuration }));
    setTransitionStatus(describeTransition(type, ids.length));
  };


  // Update active slide properties. `coalesce` folds repeated edits (typing) into one undo.
  const updateSlide = useCallback((partial: Partial<Slide>, coalesce?: string) => {
    const prev = deckRef.current;
    const active =
      prev.slides[activeRef.current] || prev.slides[prev.slideOrder[0]];
    if (!active) return;
    commitRef.current(
      {
        ...prev,
        slides: { ...prev.slides, [active.id]: { ...active, ...partial } },
      },
      coalesce,
    );
  }, []);

  // Update a specific element on the active slide.
  const updateElement = useCallback(
    (
      elementId: string,
      partial: Partial<SlideElement>,
      mode?: { live?: boolean; coalesce?: string },
    ) => {
      if (readOnlyRef.current) return;
      const prev = deckRef.current;
      const active =
        prev.slides[activeRef.current] || prev.slides[prev.slideOrder[0]];
      if (!active) return;
      const next = {
        ...prev,
        slides: {
          ...prev.slides,
          [active.id]: {
            ...active,
            elements: active.elements.map((el) =>
              el.id === elementId ? { ...el, ...partial } : el,
            ),
          },
        },
      };
      if (mode?.live) {
        deckRef.current = next;
        liveDirty.current = true;
        setDeck(next);
        onChange(next, slideOp(prev, next));
        return;
      }
      commitRef.current(next, mode?.coalesce);
    },
    [onChange],
  );

  const selectElement = (id: string | null) => {
    selectedElementRef.current = id;
    setSelectedElementId(id);
    if (id !== editingRef.current) {
      editingRef.current = null;
      setEditingId(null);
      textRange.current = null;
    }
  };

  const rememberCaret = (
    id: string,
    sel: { start: number; end: number } | null,
  ) => {
    if (!sel) return;
    textRange.current = { id, ...sel };
    const slide = activeDeckSlide(deckRef.current);
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

  const insertOnActive = (elements: SlideElement[], focusId?: string) => {
    const slide = activeDeckSlide(deckRef.current);
    if (!slide || !elements.length) return;
    commit(withElements(deckRef.current, slide.id, elements));
    selectElement(elements[elements.length - 1].id);
    if (focusId) pendingFocus.current = focusId;
  };

  const addTextBox = () => {
    const prev = deckRef.current;
    const box = {
      ...centeredTextBox(prev.width, prev.height, () => crypto.randomUUID()),
      ...textDefaults(prev.theme),
    };
    if (!prev.marp || prev.marpFit) {
      insertOnActive([box], box.id);
      return;
    }
    const slide = activeDeckSlide(prev);
    if (!slide) return;
    box.placeholder = "Click to add text";
    box.fontSize = 20;
    box.y = 10000;
    const nextSlide = reflowMarp(
      { ...slide, elements: [...slide.elements, box] },
      prev.width,
    );
    commit({ ...prev, slides: { ...prev.slides, [slide.id]: nextSlide } });
    selectElement(box.id);
    pendingFocus.current = box.id;
  };

  const addShape = (shapeType: "rect" | "roundRect" | "ellipse") => {
    const shape = {
      ...shapeElement(
        shapeType,
        deckRef.current.width,
        deckRef.current.height,
        () => crypto.randomUUID(),
      ),
      ...shapeDefaults(deckRef.current.theme),
    };
    insertOnActive([shape]);
  };

  const addWordArt = (text: string, style: WordArtStyle) => {
    const words = text.trim();
    if (!words) return;
    const prev = deckRef.current;
    const slide = activeDeckSlide(prev);
    if (!slide) return;
    const taken = slide.elements.filter((el) => el.wordArt).length;
    const art = wordArtElement(
      words,
      style,
      prev.width,
      prev.height,
      () => crypto.randomUUID(),
      taken,
    );
    insertOnActive([art]);
  };

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    if (picked.size > 5 * 1024 * 1024) {
      onError("Please choose an image smaller than 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const prev = deckRef.current;
      const image = logoImage(
        String(reader.result),
        picked.name,
        () => crypto.randomUUID(),
        prev.width,
      );
      const slide = activeDeckSlide(prev);
      if (!slide) return;
      if (!prev.marp || prev.marpFit) {
        commitRef.current(withElements(prev, slide.id, [image]));
        selectElement(image.id);
        return;
      }
      image.y = 10000;
      const nextSlide = reflowMarp(
        { ...slide, elements: [...slide.elements, image] },
        prev.width,
      );
      commitRef.current({
        ...prev,
        slides: { ...prev.slides, [slide.id]: nextSlide },
      });
      selectElement(image.id);
    };
    reader.readAsDataURL(picked);
  };

  const handleMediaUpload =
    (kind: "audio" | "video") => (e: ChangeEvent<HTMLInputElement>) => {
      const picked = e.target.files?.[0];
      e.target.value = "";
      if (!picked) return;
      const mime = mediaMime(picked, kind);
      if (!mime) {
        onError(
          kind === "audio"
            ? "Choose a WAV, MP3, or Ogg audio file."
            : "Choose an MP4 or WebM video.",
        );
        return;
      }
      if (picked.size > 5 * 1024 * 1024) {
        onError(
          kind === "audio"
            ? "Please choose an audio file smaller than 5 MB."
            : "Please choose a video smaller than 5 MB.",
        );
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const raw = reader.result;
        if (typeof raw !== "string" || !raw) {
          onError(
            kind === "audio"
              ? "Could not read that audio file."
              : "Could not read that video.",
          );
          return;
        }
        const prev = deckRef.current;
        const slide = activeDeckSlide(prev);
        if (!slide) return;
        const taken = slide.elements.filter((el) => el.type === kind).length;
        const media = mediaElement(
          kind,
          mediaDataUrl(raw, mime),
          picked.name,
          () => crypto.randomUUID(),
          prev.width,
          prev.height,
          taken,
        );
        if (!prev.marp) {
          commitRef.current(withElements(prev, slide.id, [media]));
          selectElement(media.id);
          return;
        }
        media.y = 10000;
        const nextSlide = reflowMarp(
          { ...slide, elements: [...slide.elements, media] },
          prev.width,
        );
        commitRef.current({
          ...prev,
          slides: { ...prev.slides, [slide.id]: nextSlide },
        });
        selectElement(media.id);
      };
      reader.onerror = () =>
        onError(
          kind === "audio"
            ? "Could not read that audio file."
            : "Could not read that video.",
        );
      reader.readAsDataURL(picked);
    };

  const deleteSelectedElement = () => {
    const elementId = selectedElementRef.current;
    const slide = activeDeckSlide(deckRef.current);
    if (!elementId || !slide?.elements.some((el) => el.id === elementId)) return;
    commit(withoutElements(deckRef.current, slide.id, [elementId]));
    selectElement(null);
  };

  const selectedText = () => {
    const slide = activeDeckSlide(deckRef.current);
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
    const slide = activeDeckSlide(deckRef.current);
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

  const copySelection = () => {
    const deckNow = deckRef.current;
    const slide = activeDeckSlide(deckNow);
    const el = slide?.elements.find(
      (item) => item.id === selectedElementRef.current,
    );
    if (el) {
      clipboard.current = { kind: "elements", elements: [structuredClone(el)] };
      return;
    }
    const ids = chosenSlides();
    if (!ids.length) return;
    clipboard.current = {
      kind: "slides",
      slides: ids.map((id) => structuredClone(deckNow.slides[id])),
    };
  };

  const cutSelection = () => {
    copySelection();
    if (clipboard.current?.kind === "elements") deleteSelectedElement();
    else if (clipboard.current?.kind === "slides") deleteCurrentSlide();
  };

  const pasteClipboard = () => {
    const clip = clipboard.current;
    const deckNow = deckRef.current;
    const slide = activeDeckSlide(deckNow);
    if (!clip || !slide) return;
    if (clip.kind === "elements") {
      const placed = pastedElements(
        slide.elements,
        clip.elements,
        () => crypto.randomUUID(),
        { width: deckNow.width, height: deckNow.height },
      );
      commit(withElements(deckNow, slide.id, placed));
      selectElement(placed[placed.length - 1]?.id ?? null);
      return;
    }
    const after = chosenSlides().at(-1) || slide.id;
    const result = pasteSlides(deckNow, clip.slides, after, () =>
      crypto.randomUUID(),
    );
    if (!result.newIds.length) return;
    commit(result.deck);
    anchorRef.current = result.newIds[0];
    applySelection(result.newIds[0], result.newIds, null);
  };

  const stepSlide = (where: "next" | "prev") => {
    const order = deckRef.current.slideOrder;
    const to = order.indexOf(activeRef.current) + (where === "next" ? 1 : -1);
    if (to < 0 || to >= order.length) return;
    const nextId = order[to];
    anchorRef.current = nextId;
    applySelection(nextId, [nextId], null);
  };

  const runCommand = (command: SlideCommand) => {
    switch (command.type) {
      case "undo":
        undo();
        break;
      case "redo":
        redo();
        break;
      case "duplicate":
        duplicateCurrentSlide();
        break;
      case "delete": {
        const slide = activeDeckSlide(deckRef.current);
        const elementId = selectedElementRef.current;
        if (elementId && slide?.elements.some((el) => el.id === elementId))
          deleteSelectedElement();
        else deleteCurrentSlide();
        break;
      }
      case "copy":
        copySelection();
        break;
      case "cut":
        cutSelection();
        break;
      case "paste":
        pasteClipboard();
        break;
      case "new-slide":
        addSlide();
        break;
      case "bold":
        toggleBold();
        break;
      case "italic":
        toggleItalic();
        break;
      case "underline":
        toggleUnderline();
        break;
      case "move":
        moveSlides(command.where);
        break;
      case "go":
        stepSlide(command.where);
        break;
    }
  };

  const applyAnimation = (kind: SlideAnimationKind | null) => {
    const elementId = selectedElementRef.current;
    const slideId = activeRef.current;
    if (!elementId || !slideId) return;
    const next = applySlideAnimation(deckRef.current, slideId, elementId, kind);
    if (next) commit(next);
  };
  const applyFadeToSelection = () => applyAnimation(FADE_ON_CLICK);
  const fadeReason = (kind: SlideAnimationKind = FADE_ON_CLICK) => {
    const slide = deckRef.current.slides[activeRef.current];
    const el = slide?.elements.find(
      (item) => item.id === selectedElementRef.current,
    );
    return fadeOnClickReason(el, kind);
  };

  const api = useRef({
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
  });
  api.current = {
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

  // Mouse drag & resize handlers for elements
  const onElementMouseDown = (
    e: React.MouseEvent,
    elementId: string,
    handle?: ResizeHandle,
  ) => {
    e.stopPropagation();
    textPress.current = !!(e.target as HTMLElement).closest?.(
      ".element-textarea, .element-editor",
    );
    dragMoved.current = false;
    selectedElementRef.current = elementId;
    setSelectedElementId(elementId);
    setTableCell((current) => (current?.id === elementId ? current : null));
    if (!handle && editingRef.current && editingRef.current !== elementId) {
      editingRef.current = null;
      setEditingId(null);
      textRange.current = null;
    }
    const el = activeSlide.elements.find((item) => item.id === elementId);
    if (!el || readOnlyRef.current) return;
    if (
      el.type === "text" &&
      (el.math || el.preformatted || el.hang || hasTextRuns(el) || el.content?.includes("$")) &&
      deckRef.current.marp
    ) {
      editingRef.current = elementId;
      setEditingId(elementId);
    }
    if (deckRef.current.marp) {
      if (handle || isMarpTitle(el) || isMarpChrome(el)) return;
      draggingRef.current = {
        elementId,
        startX: e.clientX,
        startY: e.clientY,
        initX: el.x,
        initY: el.y,
        reorder: true,
        fitted: !!deckRef.current.marpFit,
      };
      return;
    }
    if (marpOpenRef.current) return;

    draggingRef.current = {
      elementId,
      startX: e.clientX,
      startY: e.clientY,
      initX: el.x,
      initY: el.y,
      handle,
      initW: el.width,
      initH: el.height,
    };
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current || !stageRef.current) return;
      const {
        elementId,
        startX,
        startY,
        initX,
        initY,
        handle,
        initW = 100,
        initH = 50,
        reorder,
        fitted,
      } = draggingRef.current;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < 8) return;
      dragMoved.current = true;
      textPress.current = false;
      if (reorder) {
        const canvas = stageRef.current.querySelector(".slide-canvas");
        const slide =
          deckRef.current.slides[activeRef.current] ||
          deckRef.current.slides[deckRef.current.slideOrder[0]];
        if (!canvas || !slide) return;
        const rect = canvas.getBoundingClientRect();
        const width = deckRef.current.width || 960;
        const height = deckRef.current.height || 540;
        const nextSlide = (fitted ? reorderFittedMarpItem : reorderMarpItem)(
          slide,
          elementId,
          {
            x: ((e.clientX - rect.left) / rect.width) * width,
            y: ((e.clientY - rect.top) / rect.height) * height,
          },
          width,
        );
        if (!nextSlide) return;
        const prev = deckRef.current;
        const next = {
          ...prev,
          slides: { ...prev.slides, [slide.id]: nextSlide },
        };
        deckRef.current = next;
        liveDirty.current = true;
        setDeck(next);
        onChangeRef.current(next, slideOp(prev, next));
        return;
      }
      if (deckRef.current.marp) return;
      const stageRect = stageRef.current.getBoundingClientRect();
      const scale = stageRect.width / (deck.width || 960);

      const dx = (e.clientX - startX) / scale;
      const dy = (e.clientY - startY) / scale;

      if (handle) {
        let newX = initX;
        let newY = initY;
        let newW = initW;
        let newH = initH;

        if (handle.includes("e")) {
          newW = Math.max(30, Math.round(initW + dx));
        }
        if (handle.includes("s")) {
          newH = Math.max(20, Math.round(initH + dy));
        }
        if (handle.includes("w")) {
          const change = Math.min(dx, initW - 30);
          newX = Math.round(initX + change);
          newW = Math.round(initW - change);
        }
        if (handle.includes("n")) {
          const change = Math.min(dy, initH - 20);
          newY = Math.round(initY + change);
          newH = Math.round(initH - change);
        }

        updateElement(
          elementId,
          { x: newX, y: newY, width: newW, height: newH },
          { live: true },
        );
      } else {
        const newX = Math.round(initX + dx);
        const newY = Math.round(initY + dy);
        updateElement(elementId, { x: newX, y: newY }, { live: true });
      }
    };

    const onMouseUp = () => {
      setTimeout(() => {
        textPress.current = false;
        dragMoved.current = false;
      }, 0);
      if (!draggingRef.current) return;
      draggingRef.current = null;
      if (!liveDirty.current) return;
      liveDirty.current = false;
      const next = deckRef.current;
      if (JSON.stringify(next) === JSON.stringify(historyRef.current!.tip))
        return;
      commitRef.current(next);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [deck.width, updateElement]);

  // Export handlers
  const { printing, print: printDeck } = useSlidePrint(file.title, printDocument);
  const printSlides = useCallback(() => {
    marpDraft.current?.flush();
    return printDeck();
  }, [printDeck]);

  const exportTxt = async () => {
    const lines: string[] = [];
    lines.push(`Title: ${file.title}`);
    lines.push(`Slides: ${deck.slideOrder.length}\n`);

    deck.slideOrder.forEach((id, i) => {
      const s = deck.slides[id];
      if (!s) return;
      const heading = s.elements
        .find((el) => el.type === "text" && !el.wordArt && el.content?.trim())
        ?.content?.trim()
        .split("\n")[0];
      lines.push(`--- Slide ${i + 1}: ${s.title || heading || "Untitled"} ---`);
      for (const el of s.elements) {
        if (el.type === "text" && el.content) lines.push(el.content);
        if (el.type === "table" && el.rows) {
          lines.push(el.rows.map((r) => r.join("\t")).join("\n"));
        }
        if ((el.type === "audio" || el.type === "video") && el.alt)
          lines.push(`${el.type === "audio" ? "Audio" : "Video"}: ${el.alt}`);
      }
      if (s.notes) lines.push(`[Speaker notes: ${s.notes}]`);
      lines.push("");
    });

    await exportText(filename(file.title, "txt"), lines.join("\n"));
  };

  const exportHtml = async () => {
    await exportText(filename(file.title, "html"), deckToHtml(deck, file.title));
  };

  const exportMarp = async () => {
    const current = deckRef.current;
    await exportText(
      filename(file.title, "md"),
      current.marp && current.marpSource !== undefined ? current.marpSource : deckToMarp(current),
    );
  };

  const exportPptx = async () => {
    const { exportPptx: writePptx } = await import("@suiteleaf/core/pptx-export");
    await exportBinary(
      filename(file.title, "pptx"),
      await writePptx({ ...file, title: file.title, content: deckRef.current }),
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  };

  const exportTxtRef = useRef(exportTxt);
  exportTxtRef.current = exportTxt;
  const exportHtmlRef = useRef(exportHtml);
  exportHtmlRef.current = exportHtml;
  const exportMarpRef = useRef(exportMarp);
  exportMarpRef.current = exportMarp;
  const exportPptxRef = useRef(exportPptx);
  exportPptxRef.current = exportPptx;

  const [controlsVisible, setControlsVisible] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsHoveredRef = useRef(false);
  const showFullscreenRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const beginShow = useCallback((fromIndex: number, withNotes?: boolean) => {
    marpDraft.current?.flush();
    const next = startOfShow(fromIndex);
    showCursorRef.current = next;
    setShowCursor(next);
    if (withNotes !== undefined) setShowSpeakerNotes(withNotes);
    setBlankScreen(null);
    setControlsVisible(true);
    const now = Date.now();
    setShowStartedAt(now);
    setClock(now);
    setPresenting(true);
    // Browsers only allow fullscreen from inside the click or key press.
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) {
      showFullscreenRef.current = true;
      root.requestFullscreen().then(
        () => {
          if (!showFullscreenRef.current)
            document.exitFullscreen().catch(() => {});
        },
        () => {
          showFullscreenRef.current = false;
        },
      );
    }
  }, []);

  moveShowRef.current = (where) => {
    setBlankScreen(null);
    const order = deckRef.current.slideOrder;
    const current = showCursorRef.current;
    const next = moveShowCursor(
      current,
      where,
      (index) =>
        fadeOnClickIds(deckRef.current.slides[order[index]]?.elements ?? []),
      order.length,
    );
    if (samePlace(current, next) && current.enteringId === next.enteringId)
      return;
    showCursorRef.current = next;
    setShowCursor(next);
  };

  const endShow = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    if (recorder) {
      void recorder.stop().then(async (blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!bytes.length) return;
        await exportBinary(filename(file.title, "webm"), bytes, blob.type || "video/webm");
      });
    }
    setPresenting(false);
    if (showFullscreenRef.current) {
      showFullscreenRef.current = false;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }, [file.title]);

  useAgentHost("editor", () => {
    const ctx: SlidesAgentContext = {
      title: file.title,
      deck: () => deckRef.current,
      commit: (next) => {
        deckRef.current = next;
        commit(next);
      },
      activeSlideId,
      selectedElementId,
      select: (slideId, elementId) => {
        applySelection(slideId, [slideId], elementId ?? null);
      },
      copyElements: (slideId, elementIds) => {
        const slide = deckRef.current.slides[slideId];
        const elements = elementIds
          .map((id) => slide?.elements.find((el) => el.id === id))
          .filter((el): el is SlideElement => !!el)
          .map((el) => structuredClone(el));
        if (!elements.length) return false;
        clipboard.current = { kind: "elements", elements };
        applySelection(slideId, [slideId], elements[0].id);
        return true;
      },
      pasteElements: (slideId) => {
        const clip = clipboard.current;
        const deckNow = deckRef.current;
        const slide = deckNow.slides[slideId];
        if (!clip || clip.kind !== "elements" || !slide) return [];
        const placed = pastedElements(slide.elements, clip.elements, () => crypto.randomUUID(), {
          width: deckNow.width,
          height: deckNow.height,
        });
        commit(withElements(deckNow, slideId, placed));
        const last = placed[placed.length - 1];
        applySelection(slideId, [slideId], last?.id ?? null);
        return placed.map((el) => ({ id: el.id, type: el.type, x: el.x, y: el.y, shapeType: el.shapeType }));
      },
      presenting,
      present: (index, withNotes) => beginShow(index, withNotes),
      goToShowSlide: (index) => {
        setBlankScreen(null);
        const next = startOfShow(index);
        showCursorRef.current = next;
        setShowCursor(next);
      },
      showIndex: presentSlideIndex,
      endShow,
      readImage: (f) =>
        new Promise((resolve, reject) => {
          if (f.size > 5 * 1024 * 1024) return reject(new Error("Choose an image smaller than 5 MB."));
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Could not read that image."));
          reader.readAsDataURL(f);
        }),
      exportAs: (format) =>
        format === "pptx"
          ? exportPptxRef.current()
          : format === "html"
            ? exportHtmlRef.current()
            : exportTxtRef.current(),
    };
    return {
      kind: "slide",
      snapshot: () => slideSnapshot(ctx),
      tools: slideTools(ctx),
      review: () => slideSpellingReview(ctx),
    };
  });

  const currentSlideIndex = Math.max(0, deck.slideOrder.indexOf(activeSlideId));
  const slideApi = useRef({
    undo,
    redo,
    duplicate: duplicateCurrentSlide,
    delete: deleteCurrentSlide,
    undoReason: (): string | undefined =>
      historyRef.current?.canUndo ? undefined : "Nothing to undo",
    redoReason: (): string | undefined =>
      historyRef.current?.canRedo ? undefined : "Nothing to redo",
    deleteReason: (): string | undefined =>
      canDeleteSlides(deckRef.current.slideOrder, chosenSlides())
        ? undefined
        : deckRef.current.slideOrder.length <= 1
          ? "Presentations must have at least one slide."
          : "Select a slide to delete.",
  });
  slideApi.current = {
    undo,
    redo,
    duplicate: duplicateCurrentSlide,
    delete: deleteCurrentSlide,
    undoReason: () =>
      historyRef.current?.canUndo ? undefined : "Nothing to undo",
    redoReason: () =>
      historyRef.current?.canRedo ? undefined : "Nothing to redo",
    deleteReason: () =>
      canDeleteSlides(deckRef.current.slideOrder, chosenSlides())
        ? undefined
        : deckRef.current.slideOrder.length <= 1
          ? "Presentations must have at least one slide."
          : "Select a slide to delete.",
  };

  // Wire editor actions for workspace header
  useEffect(() => {
    onActions({
      flush: async () => {
        flushMarpDraft();
        onChange(deckRef.current);
      },
      export: async (format: string) => {
        flushMarpDraft();
        if (format === "md") await exportMarpRef.current();
        else if (format === "pptx") await exportPptxRef.current();
        else if (format === "html") await exportHtmlRef.current();
        else await exportTxtRef.current();
      },
      print: printSlides,
      present: () =>
        beginShow(
          Math.max(0, deckRef.current.slideOrder.indexOf(activeSlideId)),
        ),
      slideActions: {
        undo: () => api.current.undo(),
        redo: () => api.current.redo(),
        cut: () => api.current.cut(),
        copy: () => api.current.copy(),
        paste: () => api.current.paste(),
        insertTextBox: () => api.current.insertTextBox(),
        insertImage: () => api.current.insertImage(),
        insertAudio: () => api.current.insertAudio(),
        insertVideo: () => api.current.insertVideo(),
        insertShape: (shape) => api.current.insertShape(shape),
        insertWordArt: () => api.current.insertWordArt(),
        newSlide: () => api.current.newSlide(),
        duplicate: () => api.current.duplicate(),
        deleteSlides: () => api.current.deleteSlides(),
        move: (where) => api.current.move(where),
        toggleBold: () => api.current.toggleBold(),
        toggleItalic: () => api.current.toggleItalic(),
        align: (alignment) => api.current.align(alignment),
        applyLayout: (layout) => apiRef.current.applyLayout(layout),
        openTheme: () => apiRef.current.openTheme(),
        openTransition: () => apiRef.current.openTransition(),
        openAnimationPane: () => setPanel((open) => (open === "animation" ? null : "animation")),
        openMaster: () => setPanel((open) => (open === "master" ? null : "master")),
        presenterView: () =>
          beginShow(Math.max(0, deckRef.current.slideOrder.indexOf(activeSlideId)), true),
        handouts: () => setHandoutsOpen(true),
        slideNumbers: () => deckRef.current.slideNumbers === true,
        toggleSlideNumbers: () => {
          const prev = deckRef.current;
          if (prev.slideNumbers) {
            const rest = { ...prev };
            delete rest.slideNumbers;
            commitRef.current(rest);
            return;
          }
          commitRef.current({ ...prev, slideNumbers: true });
        },
        insertComment: () => openSlideComment(),
        toggleComments: () => toggleSlideCommentPanel(),
        openResolved: () => openSlideResolved(),
        fadeOnClick: () => api.current.fadeOnClick(),
        fadeOnClickReason: () => api.current.fadeOnClickReason(),
        animate: (kind) => api.current.animate(kind),
        animationReason: (kind) => api.current.animationReason(kind),
        undoReason: () => slideApi.current.undoReason(),
        redoReason: () => slideApi.current.redoReason(),
        deleteReason: () => slideApi.current.deleteReason(),
        openSpelling: () => spellingRef.current?.open(),
      },
    });
  }, [
    onActions,
    printSlides,
    onChange,
    activeSlideId,
    beginShow,
    openSlideComment,
    toggleSlideCommentPanel,
    openSlideResolved,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (presentingRef.current || handoutsRef.current) return;
      if (e.key === "Escape") {
        setContextMenu(null);
        const editing = editingRef.current;
        const area =
          document.activeElement instanceof HTMLTextAreaElement &&
          document.activeElement.classList.contains("element-textarea");
        if (editing || area) {
          editingRef.current = null;
          setEditingId(null);
          textRange.current = null;
          if (document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
        }
        return;
      }
      const elementId = selectedElementRef.current;
      const elementSelected =
        !!elementId &&
        !!deckRef.current.slides[activeRef.current]?.elements.some(
          (el) => el.id === elementId,
        );
      const command = commandFromKey(e, typingContext(e.target), elementSelected);
      if (!command) return;
      if (command.type === "go" && (e.defaultPrevented || arrowsTaken(e.target)))
        return;
      if (readOnlyRef.current && command.type !== "copy" && command.type !== "go") {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      api.current.run(command);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: PointerEvent) => {
      const menu = document.getElementById("slide-context-menu");
      if (e.target instanceof Node && menu?.contains(e.target)) return;
      setContextMenu(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [contextMenu]);

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    const node = stageRef.current?.querySelector<HTMLTextAreaElement>(
      `[data-element-id="${CSS.escape(id)}"] textarea`,
    );
    if (!node) return;
    node.focus();
    pendingFocus.current = null;
  }, [deck, selectedElementId]);

  // Cmd/Ctrl+Enter presents from the current slide, adding Shift from the start
  useEffect(() => {
    if (presenting) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (handoutsRef.current) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "Enter") {
        if (
          e.target instanceof Element &&
          e.target.closest(".slide-comment-dock")
        )
          return;
        e.preventDefault();
        beginShow(
          e.shiftKey
            ? 0
            : Math.max(0, deckRef.current.slideOrder.indexOf(activeSlideId)),
        );
        return;
      }
      if (e.key.toLowerCase() !== "m" || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (readOnlyRef.current) return;
      apiRef.current.addSlide("title-body");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [presenting, activeSlideId, beginShow]);

  // Keyboard navigation and auto-hiding controls for presentation mode
  useEffect(() => {
    if (!presenting) return;
    const toggleBlank = (color: string) =>
      setBlankScreen((prev) => (prev === color ? null : color));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
        case "n":
          moveShowRef.current("next");
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
        case "Backspace":
        case "p":
          moveShowRef.current("prev");
          break;
        case "Home":
          moveShowRef.current("home");
          break;
        case "End":
          moveShowRef.current("end");
          break;
        case "b":
        case "B":
        case ".":
          toggleBlank("#000000");
          break;
        case "w":
        case "W":
        case ",":
          toggleBlank("#ffffff");
          break;
        case "s":
        case "S":
          setShowSpeakerNotes((prev) => !prev);
          break;
        case "Escape":
          endShow();
          break;
        default:
          return;
      }
      e.preventDefault();
    };

    const scheduleHide = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        if (!controlsHoveredRef.current) setControlsVisible(false);
      }, 2500);
    };
    const onMouseMove = () => {
      setControlsVisible(true);
      scheduleHide();
    };
    scheduleHide();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [presenting, endShow]);

  // Leaving fullscreen (the browser's own Esc or exit button) ends the show
  useEffect(() => {
    if (!presenting) return;
    overlayRef.current?.focus();
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && showFullscreenRef.current) {
        showFullscreenRef.current = false;
        setPresenting(false);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (showFullscreenRef.current && document.fullscreenElement) {
        showFullscreenRef.current = false;
        document.exitFullscreen().catch(() => {});
      }
    };
  }, [presenting]);

  useEffect(() => {
    if (!presenting || !showSpeakerNotes) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [presenting, showSpeakerNotes]);

  const showArmed = useRef(false);
  if (!presenting) {
    showArmed.current = false;
    if (showMotion.type) setShowMotion({ index: -1, type: null });
  } else if (!showArmed.current) {
    showArmed.current = true;
    if (showMotion.index !== presentSlideIndex)
      setShowMotion({ index: presentSlideIndex, type: null });
  } else if (showMotion.index !== presentSlideIndex) {
    const incoming = deck.slides[deck.slideOrder[presentSlideIndex]]?.transition;
    const ms = transitionMs(incoming, reducedMotion);
    setShowMotion({
      index: presentSlideIndex,
      type: ms > 0 && incoming && incoming.type !== "none" ? incoming.type : null,
    });
  }
  const showMotionClass =
    showMotion.index === presentSlideIndex && showMotion.type
      ? ` deck-motion-${showMotion.type}`
      : "";

  const presentSlide =
    deck.slides[deck.slideOrder[presentSlideIndex]] || activeSlide;
  useEffect(() => {
    if (!recording) return;
    const master = readMaster(deck);
    recorderRef.current?.paint(
      presentSlide,
      deck.width || 960,
      deck.height || 540,
      master.elements,
      master.background?.color,
    );
  }, [recording, presentSlide, deck]);
  const nextPresentSlide = deck.slides[deck.slideOrder[presentSlideIndex + 1]];
  const fadeIdsAt = (index: number) =>
    fadeOnClickIds(deck.slides[deck.slideOrder[index]]?.elements ?? []);
  const cannotAdvance = samePlace(
    showCursor,
    moveShowCursor(showCursor, "next", fadeIdsAt, deck.slideOrder.length),
  );
  const cannotRetreat = samePlace(
    showCursor,
    moveShowCursor(showCursor, "prev", fadeIdsAt, deck.slideOrder.length),
  );
  const fadeWaiting = showCursor.revealed < fadeIdsAt(presentSlideIndex).length;
  const elapsedSeconds = Math.max(
    0,
    Math.floor((clock - showStartedAt) / 1000),
  );
  const elapsedLabel = `${Math.floor(elapsedSeconds / 60)}:${String(
    elapsedSeconds % 60,
  ).padStart(2, "0")}`;

  /** The audience sees fade-on-click objects only once they are revealed. */
  const audienceHooks = (slide: Slide | undefined): SlideFaceHooks => {
    const order = fadeOnClickIds(slide?.elements ?? []);
    return {
      box: (el) => {
        const phase = audiencePhase(el, showCursor.revealed, order, showCursor.enteringId);
        return {
          className: ` ${audienceClass(phase, el.animation)}`,
          props: {
            "data-element-id": el.id,
            ...(phase === "plain" ? {} : { "data-fade": phase === "hidden" ? "hidden" : "visible" }),
            ...(phase === "hidden" ? { "aria-hidden": true } : {}),
          },
        };
      },
    };
  };

  const slideHeading = (slide: Slide) =>
    slide.elements
      .find((el) => el.type === "text" && !el.wordArt && el.content?.trim())
      ?.content?.trim()
      .split("\n")[0];

  const renderHandles = (elementId: string) => (
    <div className="selection-handles">
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
  /** The editor's part of the shared drawing: selection, editing, handles, and table cells. */
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
      };
      if (el.type === "text") {
        props.onMouseDown = (e) => {
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
      const shown = el.type === "image" ? marpMediaSrc(el.src, deck.marpAssets) : undefined;
      if (isSvgDataUri(shown)) {
        const asset = !deck.marp
          ? null
          : el.src && el.src !== shown
            ? el.src
            : (Object.entries(deck.marpAssets ?? {}).find(([, uri]) => uri === shown)?.[0] ?? null);
        props.title = `Double-click to edit ${asset ?? "this picture"} in Drawing`;
        props.onDoubleClick = (e) => {
          e.stopPropagation();
          const svg = svgFromDataUri(shown);
          if (svg === null) onError("This picture's SVG could not be read.");
          else setSvgEdit({ id: el.id, svg, asset });
        };
      } else if (el.type === "image" && deck.marp && /\.svg$/i.test(el.src ?? "")) {
        props.onDoubleClick = (e) => {
          e.stopPropagation();
          onError(`${el.src} did not come in with the deck. Import the deck's folder to bring it in, then try again.`);
        };
      }
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
        <div
          id="slide-context-menu"
          className="menu-content slide-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setContextMenu(null);
              duplicateCurrentSlide();
            }}
          >
            <span className="menu-item-label">Duplicate slide</span>
            <span className="menu-item-keys">Cmd+D</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setContextMenu(null);
              deleteCurrentSlide();
            }}
          >
            <span className="menu-item-label">Delete slide</span>
            <span className="menu-item-keys">Delete</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setContextMenu(null);
              moveSlides("start");
            }}
          >
            <span className="menu-item-label">Move to start</span>
            <span className="menu-item-keys">Cmd+Shift+Up</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setContextMenu(null);
              moveSlides("end");
            }}
          >
            <span className="menu-item-label">Move to end</span>
            <span className="menu-item-keys">Cmd+Shift+Down</span>
          </button>
        </div>
      ) : null}
      {/* Slides Toolbar */}
      <div
        className="slides-toolbar"
        role="toolbar"
        aria-label="Slides toolbar"
      >
        <fieldset className="toolbar-edits" disabled={readOnly}>
        <div className="tool-group">
          <MenuSearchPill />
          <button
            type="button"
            className="menu-trigger theme-toggle"
            aria-pressed={panel === "theme"}
            onClick={() =>
              setPanel((open) => (open === "theme" ? null : "theme"))
            }
          >
            <Palette size={16} className="narrow-only-icon" aria-hidden="true" />
            <span className="tool-words">Theme</span>
          </button>
          {deck.marp ? (
            <button
              type="button"
              className="menu-trigger theme-toggle"
              aria-label="Markdown"
              aria-pressed={marpOpen}
              title={marpOpen ? "Hide the markdown" : "Show the markdown beside the slide"}
              onClick={() => setMarpOpen((open) => !open)}
            >
              <FileText size={16} className="narrow-only-icon" aria-hidden="true" />
              <span className="tool-words">Markdown</span>
            </button>
          ) : null}
          <Menu
            label="+ New slide"
            trigger={
              <>
                <Plus size={16} className="narrow-only-icon" aria-hidden="true" />
                <span className="tool-words">+ New slide</span>
              </>
            }
          >
            {deck.marp ? (
              <>
                <MenuItem onSelect={() => addSlide("title-body")}>
                  Single column
                </MenuItem>
                <MenuItem onSelect={() => addSlide("two-column")}>
                  Two columns
                </MenuItem>
              </>
            ) : (
              <>
                <MenuItem onSelect={() => addSlide("title-body")}>
                  Title & body
                </MenuItem>
                <MenuItem onSelect={() => addSlide("title")}>Title slide</MenuItem>
                <MenuItem onSelect={() => addSlide("two-column")}>
                  Two columns
                </MenuItem>
                <MenuItem onSelect={() => addSlide("section")}>
                  Section header
                </MenuItem>
                <MenuItem onSelect={() => addSlide("blank")}>Blank slide</MenuItem>
              </>
            )}
          </Menu>

          <Tool
            label="Undo (Cmd+Z)"
            onClick={undo}
            disabled={!historyMarks.undo || readOnly}
          >
            <Undo2 size={16} />
          </Tool>
          <Tool
            label="Redo (Cmd+Y)"
            onClick={redo}
            disabled={!historyMarks.redo || readOnly}
          >
            <Redo2 size={16} />
          </Tool>
        </div>

        <div className="toolbar-divider" />

        <div className="tool-group">
          <Tool
            label="Select tool"
            active={!selectedElementId}
            onClick={() => selectElement(null)}
          >
            <MousePointer2 size={16} />
          </Tool>
          <Tool label="Insert text box" onClick={addTextBox}>
            <Type size={16} />
          </Tool>
          <Tool
            label="Insert image"
            onClick={() => imageInputRef.current?.click()}
          >
            <ImagePlus size={16} />
          </Tool>
          {deck.marp ? null : (
            <>
          <Tool label="Rectangle" onClick={() => addShape("roundRect")}>
            <Square size={16} />
          </Tool>
          <Tool label="Circle" onClick={() => addShape("ellipse")}>
            <Circle size={16} />
          </Tool>
            </>
          )}
          <input
            hidden
            type="file"
            ref={imageInputRef}
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            onChange={handleImageUpload}
          />
          <input
            hidden
            type="file"
            ref={audioInputRef}
            accept="audio/wav,audio/wave,audio/x-wav,audio/mpeg,audio/ogg,.wav,.mp3,.ogg"
            onChange={handleMediaUpload("audio")}
          />
          <input
            hidden
            type="file"
            ref={videoInputRef}
            accept="video/mp4,video/webm,.mp4,.webm"
            onChange={handleMediaUpload("video")}
          />
        </div>

        <div className="toolbar-divider" />

        {/* Dynamic Contextual Tools: Fill, Border, Typography or Slide background/layout */}
        {selectedElement ? (
          <div className="tool-group">
            {deck.marp ? null : (
            <>
            {/* Fill color */}
            <Menu
              label="Fill"
              trigger={
                <>
                  <PaintBucket size={16} className="narrow-only-icon" aria-hidden="true" />
                  <span className="tool-words">Fill</span>
                </>
              }
            >
              {[
                { label: "Transparent", val: "transparent" },
                { label: "White", val: "#ffffff" },
                { label: "Soft grey", val: "#f1f3f4" },
                { label: "Slate", val: "#e2e8f0" },
                { label: "Light blue", val: "#d2e3fc" },
                { label: "Light green", val: "#ceead6" },
                { label: "Light yellow", val: "#feefc3" },
                { label: "Light red", val: "#fad2cf" },
                { label: "Blue", val: "#4285f4" },
                { label: "Green", val: "#34a853" },
                { label: "Yellow", val: "#fbbc04" },
                { label: "Red", val: "#ea4335" },
                { label: "Dark", val: "#202124" },
              ].map((c) => (
                <MenuItem
                  key={c.val}
                  onSelect={() =>
                    updateElement(
                      selectedElement.id,
                      handStyle({ fill: c.val }),
                    )
                  }
                >
                  <span
                    className="menu-color-swatch"
                    style={{ backgroundColor: c.val }}
                  />
                  {c.label}
                </MenuItem>
              ))}
            </Menu>

            {/* Border color */}
            <Menu
              label="Border"
              trigger={
                <>
                  <Square size={16} className="narrow-only-icon" aria-hidden="true" />
                  <span className="tool-words">Border</span>
                </>
              }
            >
              {[
                { label: "None", val: "transparent" },
                { label: "Grey", val: "#dadce0" },
                { label: "Dark", val: "#202124" },
                { label: "Google Blue", val: "#1a73e8" },
                { label: "Green", val: "#188038" },
                { label: "Red", val: "#d93025" },
              ].map((c) => (
                <MenuItem
                  key={c.val}
                  onSelect={() =>
                    updateElement(
                      selectedElement.id,
                      handStyle({ stroke: c.val, strokeWidth: 2 }),
                    )
                  }
                >
                  <span
                    className="menu-color-swatch"
                    style={{ backgroundColor: c.val }}
                  />
                  {c.label}
                </MenuItem>
              ))}
            </Menu>
            </>
            )}

            {selectedElement.type === "text" ? (
              <>
                {deck.marp ? null : (
                <FontControls>
                <select
                  className="toolbar-select font-family-select"
                  aria-label="Font family"
                  value={selectedElement.fontFamily || "Arial"}
                  onChange={(e) =>
                    updateElement(
                      selectedElement.id,
                      handStyle({ fontFamily: e.target.value }),
                    )
                  }
                >
                  {THEME_FONTS.map((font) => (
                    <option key={font} value={font}>
                      {font}
                    </option>
                  ))}
                  <option value="Roboto">Roboto</option>
                  <option value="Helvetica">Helvetica</option>
                </select>

                {selectedElement.wordArt ? null : (
                  <Tool
                    label="Autofit"
                    active={!!selectedElement.autofit}
                    onClick={() =>
                      updateElement(selectedElement.id, {
                        autofit: !selectedElement.autofit,
                      })
                    }
                  >
                    Autofit
                  </Tool>
                )}

                <div className="font-size-stepper">
                  <button
                    type="button"
                    className="stepper-btn"
                    title="Decrease font size"
                    aria-label="Decrease font size"
                    onClick={() =>
                      updateElement(selectedElement.id, {
                        fontSize: Math.max(
                          6,
                          (selectedElement.fontSize || 20) - 1,
                        ),
                      })
                    }
                  >
                    <Minus size={12} />
                  </button>
                  <input
                    className="font-size-input"
                    aria-label="Font size"
                    value={selectedElement.fontSize || 20}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val > 0)
                        updateElement(
                          selectedElement.id,
                          { fontSize: val },
                          { coalesce: `size:${selectedElement.id}` },
                        );
                    }}
                  />
                  <button
                    type="button"
                    className="stepper-btn"
                    title="Increase font size"
                    aria-label="Increase font size"
                    onClick={() =>
                      updateElement(selectedElement.id, {
                        fontSize: Math.min(
                          96,
                          (selectedElement.fontSize || 20) + 1,
                        ),
                      })
                    }
                  >
                    <Plus size={12} />
                  </button>
                </div>
                </FontControls>
                )}

                <Tool
                  label="Bold"
                  active={
                    editingId === selectedElement.id && caretMarks?.id === selectedElement.id
                      ? caretMarks.bold
                      : hasTextRuns(selectedElement)
                        ? !!selectedElement.runs?.every((run) => run.bold)
                        : !!selectedElement.bold
                  }
                  onClick={toggleBold}
                >
                  <Bold size={16} />
                </Tool>
                <Tool
                  label="Italic"
                  active={
                    editingId === selectedElement.id && caretMarks?.id === selectedElement.id
                      ? caretMarks.italic
                      : hasTextRuns(selectedElement)
                        ? !!selectedElement.runs?.every((run) => run.italic)
                        : !!selectedElement.italic
                  }
                  onClick={toggleItalic}
                >
                  <Italic size={16} />
                </Tool>
                <Tool
                  label="Underline"
                  active={
                    editingId === selectedElement.id && caretMarks?.id === selectedElement.id
                      ? caretMarks.underline
                      : hasTextRuns(selectedElement)
                        ? !!selectedElement.runs?.every((run) => run.underline)
                        : !!selectedElement.underline
                  }
                  onClick={toggleUnderline}
                >
                  <Underline size={16} />
                </Tool>
                <Tool
                  label="Accent colour for the selection"
                  active={
                    editingId === selectedElement.id &&
                    caretMarks?.id === selectedElement.id &&
                    caretMarks.color === (deck.theme?.accent ?? "").toLowerCase()
                  }
                  onClick={applyAccent}
                >
                  <span className="text-color-tool">
                    <span className="text-color-a">A</span>
                    <span
                      className="text-color-bar"
                      style={{ background: deck.theme?.accent ?? "#188038" }}
                    />
                  </span>
                </Tool>
                {deck.marp ? null : (
                <>
                <Tool
                  label="Align left"
                  active={selectedElement.align === "left"}
                  onClick={() =>
                    updateElement(selectedElement.id, { align: "left" })
                  }
                >
                  <AlignLeft size={16} />
                </Tool>
                <Tool
                  label="Align center"
                  active={selectedElement.align === "center"}
                  onClick={() =>
                    updateElement(selectedElement.id, { align: "center" })
                  }
                >
                  <AlignCenter size={16} />
                </Tool>
                <Tool
                  label="Align right"
                  active={selectedElement.align === "right"}
                  onClick={() =>
                    updateElement(selectedElement.id, { align: "right" })
                  }
                >
                  <AlignRight size={16} />
                </Tool>
                <Tool
                  label="Bullet list"
                  active={!!selectedElement.bullet}
                  onClick={() =>
                    updateElement(selectedElement.id, {
                      bullet: !selectedElement.bullet,
                    })
                  }
                >
                  <List size={16} />
                </Tool>
                </>
                )}
              </>
            ) : selectedElement.type === "table" && tableCell?.id === selectedElement.id ? (
              <>
                <Tool
                  label="Bold"
                  active={!!selectedElement.cellMarks?.[tableCell.row]?.[tableCell.col]?.bold}
                  onClick={toggleBold}
                >
                  <Bold size={16} />
                </Tool>
                <Tool
                  label="Italic"
                  active={!!selectedElement.cellMarks?.[tableCell.row]?.[tableCell.col]?.italic}
                  onClick={toggleItalic}
                >
                  <Italic size={16} />
                </Tool>
              </>
            ) : null}

            {deck.marp && (isMarpTitle(selectedElement) || isMarpChrome(selectedElement)) ? null : (
            <Tool label="Delete element" onClick={deleteSelectedElement}>
              <Trash2 size={16} />
            </Tool>
            )}
          </div>
        ) : (
          <div className="tool-group">
            <Menu
              label="Background"
              trigger={
                <>
                  <Paintbrush size={16} className="narrow-only-icon" aria-hidden="true" />
                  <span className="tool-words">Background</span>
                </>
              }
            >
              {[
                { label: "White", val: "#ffffff" },
                { label: "Soft light", val: "#f8fafc" },
                { label: "Warm sand", val: "#fef3c7" },
                { label: "Sage green", val: "#e2ece9" },
                { label: "Dark slate", val: "#0f172a" },
                { label: "Deep navy", val: "#1e293b" },
              ].map((color) => (
                <MenuItem
                  key={color.val}
                  onSelect={() =>
                    commit({
                      ...deck,
                      slides: {
                        ...deck.slides,
                        ...applyBackground(
                          { [activeSlide.id]: activeSlide },
                          color.val,
                        ),
                      },
                    })
                  }
                >
                  <span
                    className="menu-color-swatch"
                    style={{ backgroundColor: color.val }}
                  />
                  {color.label}
                </MenuItem>
              ))}
              <MenuItem
                onSelect={() =>
                  setDeckBackground(
                    activeSlide?.background?.color || "#ffffff",
                    false,
                  )
                }
              >
                Apply to all slides
              </MenuItem>
            </Menu>

            {deck.marp ? null : (
            <Menu
              label="Layout"
              trigger={
                <>
                  <LayoutTemplate size={16} className="narrow-only-icon" aria-hidden="true" />
                  <span className="tool-words">Layout</span>
                </>
              }
            >
              {(
                [
                  ["title", "Title slide"],
                  ["title-body", "Title & body"],
                  ["two-column", "Two columns"],
                  ["section", "Section header"],
                  ["blank", "Blank slide"],
                ] as const
              ).map(([layout, label]) => (
                <MenuItem
                  key={layout}
                  onSelect={() => applyLayoutToSlide(layout)}
                >
                  {label}
                </MenuItem>
              ))}
            </Menu>
            )}

          </div>
        )}
        </fieldset>

        <Tool label="Print (Cmd+P)" onClick={() => printSlides()}>
          <Printer size={16} />
        </Tool>

        {/* Google Slides styled Slideshow button */}
        <div className="tool-group right-tools">
          <div className="slideshow-split">
            <button
              type="button"
              className="slideshow-btn"
              onClick={() => beginShow(currentSlideIndex)}
              title="Present from current slide (Cmd+Enter)"
            >
              <Play size={14} fill="currentColor" />
              <span className="tool-words">Slideshow</span>
            </button>
            <Dropdown.Root>
              <Dropdown.Trigger
                className="slideshow-btn slideshow-menu-btn"
                aria-label="Slideshow options"
                title="Slideshow options"
              >
                <ChevronDown size={12} />
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Content
                  className="menu-content"
                  sideOffset={4}
                  align="end"
                >
                  <MenuItem
                    shortcut="Cmd+Shift+Enter"
                    onSelect={() => beginShow(0)}
                  >
                    Present from beginning
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+Enter"
                    onSelect={() => beginShow(currentSlideIndex)}
                  >
                    Present from current slide
                  </MenuItem>
                  <MenuItem
                    synonyms={["presenter view", "speaker view"]}
                    onSelect={() => beginShow(currentSlideIndex, true)}
                  >
                    Presenter view
                  </MenuItem>
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          </div>
        </div>
      </div>

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
      <div className="slides-main">
        {/* Left Thumbnails Panel */}
        <aside className="slides-sidebar" aria-label="Slide thumbnails">
          <div className="slides-sidebar-header">
            <span>Slides ({deck.slideOrder.length})</span>
            <div className="sidebar-slide-actions">
              <button
                type="button"
                title="Move slide up"
                onClick={() => moveSlides("up")}
                disabled={readOnly || !canMove(deck.slideOrder, selectedSlideIds, "up")}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                title="Move slide down"
                onClick={() => moveSlides("down")}
                disabled={
                  readOnly || !canMove(deck.slideOrder, selectedSlideIds, "down")
                }
              >
                <ChevronDown size={14} />
              </button>
              <button
                type="button"
                title="Duplicate slide"
                disabled={readOnly}
                onClick={duplicateCurrentSlide}
              >
                <Copy size={14} />
              </button>
              <button
                type="button"
                title="Delete slide"
                onClick={deleteCurrentSlide}
                disabled={
                  readOnly || !canDeleteSlides(deck.slideOrder, selectedSlideIds)
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          <div
            className={`thumbnails-list ${slideDrag?.over != null ? "dragging" : ""}`}
            ref={thumbnailsRef}
            role="listbox"
            aria-label="Slides"
            aria-multiselectable="true"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              if (e.metaKey || e.ctrlKey || e.altKey) return;
              e.preventDefault();
              const order = deck.slideOrder;
              if (e.shiftKey) {
                const next = extendSelection(
                  order,
                  anchorRef.current,
                  activeRef.current,
                  e.key === "ArrowUp" ? "up" : "down",
                );
                applySelection(next.activeId, next.selected, null);
                return;
              }
              stepSlide(e.key === "ArrowUp" ? "prev" : "next");
            }}
          >
            {deck.slideOrder.map((id, index) => {
              const slide = deck.slides[id];
              const isActive = id === activeSlideId;
              const isChosen = selectedSlideIds.includes(id);
              const heading = slide?.elements
                .find((el) => el.type === "text" && !el.wordArt && el.content?.trim())
                ?.content?.trim()
                .split("\n")[0];
              const bg = slide?.background?.color || "#ffffff";
              const dropClass =
                slideDrag?.over === index
                  ? "drop-before"
                  : slideDrag?.over === index + 1 &&
                      index === deck.slideOrder.length - 1
                    ? "drop-after"
                    : "";

              return (
                <div
                  key={id}
                  role="option"
                  data-slide-id={id}
                  aria-selected={isChosen}
                  aria-label={`Slide ${index + 1}${slide?.transition && slide.transition.type !== "none" ? `, ${slide.transition.type} transition` : ""}${heading ? `: ${heading}` : ""}`}
                  className={`thumbnail-row ${isChosen ? "selected" : ""} ${isActive ? "active" : ""} ${slideDrag?.over != null && slideDrag.ids.includes(id) ? "drag-source" : ""} ${dropClass}`}
                  onMouseDown={(e) => {
                    if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey)
                      return;
                    // Firefox starts a native drag unless the press is cancelled,
                    // and then the thumbnail never lands in the new gap.
                    e.preventDefault();
                    const ids = selectedRef.current.includes(id)
                      ? [...selectedRef.current]
                      : [id];
                    if (!selectedRef.current.includes(id)) {
                      anchorRef.current = id;
                      applySelection(id, [id], null);
                    }
                    const next = { ids, startY: e.clientY, over: null };
                    dragRef.current = next;
                    setSlideDrag(next);
                  }}
                  onClick={(e) => {
                    if (suppressThumbnailClick.current) return;
                    thumbnailsRef.current?.focus();
                    if (e.shiftKey) {
                      const ids = rangeIds(deck.slideOrder, anchorRef.current, id);
                      applySelection(id, ids, null);
                      if (ids.length > 1) setTransitionScope("selected");
                      return;
                    }
                    if (e.metaKey || e.ctrlKey) {
                      const ids = toggleId(selectedRef.current, id);
                      anchorRef.current = id;
                      applySelection(
                        ids.includes(id) ? id : ids[ids.length - 1],
                        ids,
                        null,
                      );
                      return;
                    }
                    anchorRef.current = id;
                    applySelection(id, [id], null);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (readOnlyRef.current) return;
                    if (!selectedRef.current.includes(id)) {
                      anchorRef.current = id;
                      applySelection(id, [id], null);
                    }
                    setContextMenu({
                      x: Math.max(8, Math.min(e.clientX, window.innerWidth - 230)),
                      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 210)),
                    });
                  }}
                >
                  <span className="thumbnail-num">{index + 1}</span>
                  <div
                    className="thumbnail-card"
                    style={{ backgroundColor: bg }}
                  >
                    <div className="thumbnail-preview">
                      <SlideStill
                        deck={deck}
                        slide={slide}
                        index={index}
                        pages={marpPages}
                        lazy
                      />
                    </div>
                    {slide?.transition && slide.transition.type !== "none" ? (
                      <span
                        className="thumbnail-transition"
                        title={slide.transition.type}
                      >
                        <Blend size={10} />
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="slides-sidebar-footer">
            <button
              type="button"
              className="add-slide-sidebar-btn"
              disabled={readOnly}
              onClick={() => addSlide("title-body")}
              title="New slide (Cmd+M)"
            >
              <Plus size={16} /> New slide
            </button>
          </div>
        </aside>

        {/* Center Slide Canvas */}
        <div className="slides-canvas-stage">
          {slideComments.notice}
          <div
            className="slide-stage-row"
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
              }}
            >
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

          {/* Speaker Notes Pane */}
          <div className="speaker-notes-pane">
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
        {panel === "animation" ? (
          <AnimationPane
            deck={deck}
            slideId={activeSlideId}
            slide={deck.slides[activeSlideId]}
            onChange={(next) => commit(next)}
            onClose={() => setPanel(null)}
            onSelect={(elementId) => selectElement(elementId)}
          />
        ) : null}
        {panel === "master" ? (
          <SlideMasterPanel
            deck={deck}
            onChange={(next) => commit(next)}
            onClose={() => setPanel(null)}
          />
        ) : null}
        {panel === "theme" || panel === "transition" ? (
          <SlideDesignPanel
            mode={panel}
            onClose={() => {
              setPreviewTheme(null);
              setPanel(null);
            }}
            themes={DECK_THEMES}
            current={deck.theme}
            resolve={resolveTheme}
            onHoverTheme={setPreviewTheme}
            onApplyTheme={useTheme}
            onCustomize={(patch) => {
              if (!deck.theme) return;
              const next = { ...deck.theme, ...patch };
              themeEdits.current.set(next.id, next);
              setPreviewTheme(null);
              commit(customizeTheme(deck, patch));
            }}
            library={libraryThemes}
            onSaveToLibrary={(name) => {
              if (!deck.theme)
                return { ok: false, error: "Pick a theme, then save it." };
              return saveLibraryTheme(deck.theme, name);
            }}
            duration={transitionDuration}
            onDuration={(seconds) => {
              setDuration(seconds);
              const ids = transitionTargets();
              if (ids.some((id) => deck.slides[id]?.transition))
                commit(setTransitionDuration(deck, ids, seconds));
            }}
            scope={transitionScope}
            onScope={setTransitionScope}
            selectedCount={selectedSlideIds.length}
            slideCount={deck.slideOrder.length}
            chosen={chosenTransition}
            onPickTransition={pickTransition}
            onApplyAll={() => {
              setTransitionScope("all");
              applyTransitionTo(chosenTransition ?? "fade", deck.slideOrder);
            }}
            onPlay={playTransition}
            status={transitionStatus}
          />
        ) : null}
        <SlideSpelling
          ref={spellingRef}
          deck={deck}
          fileId={file.id}
          onFocus={(issue) => applySelection(issue.slideId, [issue.slideId], issue.elementId)}
          onReplace={(issue, replacement) => {
            const next = replaceSlideWord(
              deckRef.current,
              issue.slideId,
              issue.elementId,
              issue.from,
              issue.to,
              replacement,
            );
            const slide = next.slides[issue.slideId];
            const element = slide?.elements.find((item) => item.id === issue.elementId);
            if (element?.runs?.length) {
              element.runs = replaceRunRange(
                element.runs,
                issue.from,
                issue.to,
                replacement,
              );
            }
            commitRef.current(next);
            applySelection(issue.slideId, [issue.slideId], issue.elementId);
          }}
        />
      </div>

      {/* Presentation Fullscreen Mode Modal */}
      {presenting ? (
        <div
          ref={overlayRef}
          className={`presenter-overlay ${showSpeakerNotes ? "with-notes" : ""} ${controlsVisible ? "" : "idle"}`}
          role="dialog"
          aria-modal="true"
          aria-label="Slideshow"
          tabIndex={-1}
        >
          <div
            key={marpShow && !showMotionClass ? "marp" : presentSlideIndex}
            className={`presenter-slide-box show-slide${showMotionClass}`}
            style={{
              backgroundColor:
                presentSlide?.background?.color ||
                deck.master?.background?.color ||
                "#ffffff",
              ["--deck-motion" as string]: `${transitionMs(presentSlide?.transition, reducedMotion)}ms`,
              aspectRatio: `${deck.width || 960} / ${deck.height || 540}`,
              width: showSpeakerNotes
                ? `min(62vw, calc((100vh - 112px) * ${deck.width || 960} / ${deck.height || 540}))`
                : `min(100vw, calc(100vh * ${deck.width || 960} / ${deck.height || 540}))`,
            }}
            onClick={() => moveShowRef.current("next")}
          >
            {(marpShow
              ? [presentSlideIndex - 1, presentSlideIndex, presentSlideIndex + 1]
              : [presentSlideIndex]
            )
              .filter((n) => n >= 0 && n < deck.slideOrder.length)
              .map((n) =>
                n === presentSlideIndex ? (
                  <SlideStill
                    key={deck.slideOrder[n] ?? n}
                    deck={deck}
                    slide={presentSlide}
                    index={n}
                    pages={marpPages}
                    hooks={audienceHooks(presentSlide)}
                    interactive
                  />
                ) : (
                  <SlideStill
                    key={deck.slideOrder[n]}
                    deck={deck}
                    slide={deck.slides[deck.slideOrder[n]]}
                    index={n}
                    pages={marpPages}
                    className="slide-still-waiting"
                  />
                ),
              )}
            {blankScreen ? (
              <div
                className="presenter-blank"
                style={{ backgroundColor: blankScreen }}
              />
            ) : null}
          </div>

          {showSpeakerNotes ? (
            <aside className="presenter-notes-panel" aria-label="Speaker notes">
              <div className="presenter-notes-header">
                <span>Speaker notes</span>
                <span
                  className="presenter-timer"
                  title="Time since the show started"
                >
                  {elapsedLabel}
                </span>
              </div>
              <div className="presenter-notes-text">
                {presentSlide?.notes?.trim() || (
                  <span className="presenter-notes-empty">
                    No speaker notes for this slide.
                  </span>
                )}
              </div>
              <div className="presenter-next">
                {nextPresentSlide ? (
                  <>
                    <span>
                      Next:{" "}
                      {slideHeading(nextPresentSlide) ||
                        `Slide ${presentSlideIndex + 2}`}
                    </span>
                    <PresenterNextSlide deck={deck}>
                      <SlideStill
                        deck={deck}
                        slide={nextPresentSlide}
                        index={presentSlideIndex + 1}
                        pages={marpPages}
                      />
                    </PresenterNextSlide>
                  </>
                ) : (
                  <span>End of presentation</span>
                )}
              </div>
            </aside>
          ) : null}

          {/* Presenter bottom floating controls */}
          <div
            className={`presenter-controls ${controlsVisible ? "visible" : "hidden"}`}
            onMouseEnter={() => {
              controlsHoveredRef.current = true;
            }}
            onMouseLeave={() => {
              controlsHoveredRef.current = false;
            }}
          >
            <button
              type="button"
              onClick={() => moveShowRef.current("prev")}
              disabled={cannotRetreat}
              title={
                showCursor.revealed > 0
                  ? "Hide fade-in (Left arrow)"
                  : "Previous slide (Left arrow)"
              }
            >
              <ChevronLeft size={16} />
              Previous
            </button>
            <span className="presenter-counter">
              Slide {presentSlideIndex + 1} of {deck.slideOrder.length}
            </span>
            <button
              type="button"
              onClick={() => moveShowRef.current("next")}
              disabled={cannotAdvance}
              title={
                fadeWaiting ? "Fade in (Right arrow)" : "Next slide (Right arrow)"
              }
            >
              Next
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              className="presenter-notes-btn"
              aria-pressed={recording}
              onClick={() => {
                if (recording) {
                  const recorder = recorderRef.current;
                  recorderRef.current = null;
                  setRecording(false);
                  void recorder?.stop().then(async (blob) => {
                    const bytes = new Uint8Array(await blob.arrayBuffer());
                    if (!bytes.length) return;
                    await exportBinary(
                      filename(file.title, "webm"),
                      bytes,
                      blob.type || "video/webm",
                    );
                  });
                  return;
                }
                const recorder = new SlideshowRecorder(deck.width || 960, deck.height || 540);
                const master = readMaster(deck);
                recorder.paint(
                  presentSlide,
                  deck.width || 960,
                  deck.height || 540,
                  master.elements,
                  master.background?.color,
                );
                try {
                  recorder.start();
                } catch {
                  return;
                }
                recorderRef.current = recorder;
                setRecording(true);
              }}
            >
              {recording ? "Stop recording" : "Record"}
            </button>
            <button
              type="button"
              className="presenter-notes-btn"
              aria-pressed={showSpeakerNotes}
              onClick={() => setShowSpeakerNotes((prev) => !prev)}
              title="Show or hide speaker notes (S)"
            >
              <StickyNote size={15} /> Notes
            </button>
            <button
              type="button"
              className="exit-present-btn"
              onClick={endShow}
              title="Exit presentation (Esc)"
            >
              <X size={15} /> Exit
            </button>
          </div>
        </div>
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
              if (svg === null) return;
              const { asset } = svgEdit;
              if (asset) {
                // The markdown keeps naming the same file; every picture of it changes.
                const current = deckRef.current;
                if (!current.marpAssets?.[asset])
                  return onError(`${asset} was removed while it was open in Drawing.`);
                commitRef.current({
                  ...current,
                  marpAssets: { ...current.marpAssets, [asset]: svgDataUri(svg) },
                });
                return;
              }
              const picture = deckRef.current.slides[activeRef.current]?.elements.find(
                (el) => el.id === svgEdit.id,
              );
              if (!picture) return onError("The picture was removed while it was open in Drawing.");
              // A MARP deck lays its pictures out from the markdown.
              const height = deckRef.current.marp ? null : heightForNewShape(picture.width, svgEdit.svg, svg);
              updateElement(svgEdit.id, { src: svgDataUri(svg), ...(height ? { height } : {}) });
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
