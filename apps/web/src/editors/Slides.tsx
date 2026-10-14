import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
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
  AlignStartHorizontal,
  AlignEndHorizontal,
  AlignHorizontalSpaceBetween,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyEnd,
  AlignVerticalSpaceBetween,
  List,
  Undo2,
  Redo2,
  X,
  Printer,
  Search,
  MousePointer2,
  Minus,
  StickyNote,
  Blend,
  Group,
  Ungroup,
} from "lucide-react";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  filename,
  type SlideFile,
  type Slide,
  type SlideElement,
  type SlideTheme,
} from "@suiteleaf/core";
import { exportText, printDocument } from "../storage";
import { Menu, MenuItem, Tool, type EditorActions } from "../ui";
import { MenuSearchPill } from "../command-palette";
import {
  applyBackground,
  applyLayout,
  type Layout,
} from "./slide-layouts";
import {
  DeckHistory,
  alignBoxes,
  groupBoxes,
  groupMemberIds,
  moveGroupedBoxes,
  selectionIsOneGroup,
  spaceBoxesEvenly,
  ungroupBoxes,
  canDeleteSlides,
  canMove,
  centeredTextBox,
  commandFromKey,
  deletedSlidesMessage,
  deleteSlides,
  duplicateSlides,
  extendSelection,
  logoImage,
  moveSelection,
  pastedElements,
  pasteSlides,
  rangeIds,
  reorderGroup,
  shapeElement,
  toggleId,
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
  textInnerHtml,
} from "./slide-runs";
import { boxFont, RunSpans, SlideTextBody } from "./slide-text";
import { useSlideThemeLibrary } from "./slide-theme-library";
import { replaceSlideWord } from "./grid-spelling";
import { SlideSpellMirror, SlideSpelling } from "./grid-spelling-ui";
import { useSlideComments } from "./slide-comments-ui";
import {
  applyFadeOnClick,
  audienceClass,
  audiencePhase,
  editorFadeAttrs,
  editorFadeClass,
  fadeOnClickIds,
  fadeOnClickReason,
  moveShowCursor,
  samePlace,
  showPosition,
  showSizeLabel,
  slideNumberLabel,
  startOfShow,
  type ShowCursor,
  type ShowMove,
} from "./slide-fade-in";
import { FadeOnClickMark } from "./slide-fade-mark";
import {
  attachSlideZoom,
  isSlideZoom,
  rememberSlideZoom,
  slideZoom,
} from "./slide-zoom";
import {
  findDeckMatches,
  findStatus,
  nextMatchIndex,
} from "./slide-find";

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** Deck place drawn on the slide. It is not one of the slide's text boxes. */
function SlideNumberCorner({ label }: { label: string | null }) {
  if (!label) return null;
  return <div className="slide-number-chrome">{label}</div>;
}

export default function Slides({
  file,
  onChange,
  onActions,
  onError,
  readOnly = false,
}: {
  file: SlideFile;
  onChange: (content: SlideFile["content"]) => void;
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
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
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
  const [zoom, setZoom] = useState(() => slideZoom(file.id));
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(
    () => findDeckMatches(deck, findQuery),
    [deck, findQuery],
  );
  const zoomStartedWithoutId = useRef(!file.id);
  useEffect(() => {
    if (!zoomStartedWithoutId.current || !file.id) return;
    zoomStartedWithoutId.current = false;
    attachSlideZoom(file.id);
    setZoom(slideZoom(file.id));
  }, [file.id]);
  const [showCursor, setShowCursor] = useState<ShowCursor>(() => startOfShow());
  const presentSlideIndex = showCursor.slideIndex;
  const [showSpeakerNotes, setShowSpeakerNotes] = useState(false);
  const [blankScreen, setBlankScreen] = useState<string | null>(null);
  const [showStartedAt, setShowStartedAt] = useState(0);
  const [clock, setClock] = useState(0);
  const [panel, setPanel] = useState<"theme" | "transition" | null>(null);
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
  const selectedElementIdsRef = useRef(selectedElementIds);
  selectedElementIdsRef.current = selectedElementIds;
  const shiftSelecting = useRef(false);
  const editingRef = useRef(editingId);
  editingRef.current = editingId;
  const textRange = useRef<{ id: string; start: number; end: number } | null>(
    null,
  );
  const anchorRef = useRef(activeSlideId);
  const presentingRef = useRef(false);
  presentingRef.current = presenting;
  const showCursorRef = useRef(showCursor);
  showCursorRef.current = showCursor;
  const moveShowRef = useRef<(where: ShowMove) => void>(() => {});
  const pendingFocus = useRef<string | null>(null);
  const liveDirty = useRef(false);
  const clipboard = useRef<
    | { kind: "elements"; elements: SlideElement[] }
    | { kind: "slides"; slides: Slide[] }
    | null
  >(null);
  const commitRef = useRef<
    (next: SlideFile["content"], key?: string) => void
  >(() => {});
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const imageInputRef = useRef<HTMLInputElement>(null);
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
    snapshot: SlideElement[];
  } | null>(null);

  const refreshMarks = () =>
    setHistoryMarks({
      undo: historyRef.current!.canUndo,
      redo: historyRef.current!.canRedo,
    });

  const applyDeck = (next: SlideFile["content"]) => {
    if (readOnlyRef.current) return;
    deckRef.current = next;
    setDeck(next);
    onChange(next);
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
      const ids = elementId ? [elementId] : [];
      selectedElementIdsRef.current = ids;
      setSelectedElementIds(ids);
      if (elementId !== editingRef.current) {
        editingRef.current = null;
        setEditingId(null);
        textRange.current = null;
      }
    }
  };

  const showMatch = (index: number) => {
    const found = findDeckMatches(deckRef.current, findQuery);
    const match = found[index];
    if (!match) return;
    setFindIndex(index);
    anchorRef.current = match.slideId;
    applySelection(match.slideId, [match.slideId], null);
  };

  const updateFind = (value: string) => {
    setFindQuery(value);
    const found = findDeckMatches(deckRef.current, value);
    setFindIndex(0);
    if (!value.trim() || !found.length) return;
    const match = found[0];
    anchorRef.current = match.slideId;
    applySelection(match.slideId, [match.slideId], null);
  };

  const findNext = () => {
    const found = findDeckMatches(deckRef.current, findQuery);
    if (!found.length) return;
    showMatch(nextMatchIndex(findIndex, found.length));
  };

  const closeFind = () => setFindOpen(false);

  useEffect(() => {
    if (findOpen) findInputRef.current?.focus();
  }, [findOpen]);

  // Commit changes and push to undo history
  const commit = (next: SlideFile["content"], key?: string) => {
    if (readOnlyRef.current) return;
    historyRef.current!.commit(next, key);
    applyDeck(next);
    setNotice(null);
    refreshMarks();
    liveDirty.current = false;
  };
  commitRef.current = commit;

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

  const undo = () => restore(historyRef.current!.undo());
  const redo = () => restore(historyRef.current!.redo());

  // Active slide
  const activeSlide =
    deck.slides[activeSlideId] || deck.slides[deck.slideOrder[0]];
  const selectedElement =
    activeSlide?.elements.find((el) => el.id === selectedElementId) || null;
  const oneGroup = selectionIsOneGroup(
    activeSlide?.elements ?? [],
    selectedElementIds,
  );
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
    openPanel: openSlideCommentPanel,
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
    const current =
      prev.slides[activeRef.current] || prev.slides[prev.slideOrder[0]];
    const slide = slideFromTheme(layout, prev.theme, current?.transition);
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
    const next = deck.theme
      ? layoutWithTheme(activeSlide, layout, deck.theme)
      : applyLayout(activeSlide, layout);
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


  const toggleSkipSlide = () => {
    const prev = deckRef.current;
    const slide = prev.slides[activeRef.current];
    if (!slide || readOnlyRef.current) return;
    const nextSlide: Slide = { ...slide };
    if (slide.skipped) delete nextSlide.skipped;
    else nextSlide.skipped = true;
    commit({
      ...prev,
      slides: { ...prev.slides, [slide.id]: nextSlide },
    });
  };

  const toggleSlideNumbers = () => {
    if (readOnlyRef.current) return;
    const prev = deckRef.current;
    commit({ ...prev, showSlideNumbers: prev.showSlideNumbers !== true });
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
        onChange(next);
        return;
      }
      commitRef.current(next, mode?.coalesce);
    },
    [onChange],
  );

  const selectElement = (id: string | null) => {
    selectedElementRef.current = id;
    setSelectedElementId(id);
    const ids = id ? [id] : [];
    selectedElementIdsRef.current = ids;
    setSelectedElementIds(ids);
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
    const box = {
      ...centeredTextBox(
        deckRef.current.width,
        deckRef.current.height,
        () => crypto.randomUUID(),
      ),
      ...textDefaults(deckRef.current.theme),
    };
    insertOnActive([box], box.id);
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
      const image = logoImage(
        String(reader.result),
        picked.name,
        () => crypto.randomUUID(),
        deckRef.current.width,
      );
      const slide = activeDeckSlide(deckRef.current);
      if (!slide) return;
      commitRef.current(withElements(deckRef.current, slide.id, [image]));
      selectElement(image.id);
    };
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
    updateElement(el.id, handStyle({ color }));
  };
  const alignText = (alignment: "left" | "center" | "right") => {
    const el = selectedText();
    if (el) updateElement(el.id, { align: alignment });
  };

  const alignSelectedBoxes = (edge: "left" | "top" | "right" | "bottom") => {
    const prev = deckRef.current;
    const slide =
      prev.slides[activeRef.current] || prev.slides[prev.slideOrder[0]];
    if (!slide) return;
    const aligned = alignBoxes(
      slide.elements,
      selectedElementIdsRef.current,
      edge,
    );
    if (aligned.length < 2) return;
    const byId = new Map(aligned.map((el) => [el.id, el]));
    const elements = slide.elements.map((el) => byId.get(el.id) ?? el);
    const moved = elements.some((el, index) => el !== slide.elements[index]);
    if (!moved) return;
    commit({
      ...prev,
      slides: { ...prev.slides, [slide.id]: { ...slide, elements } },
    });
  };

  const spaceSelectedBoxes = (axis: "across" | "down") => {
    const prev = deckRef.current;
    const slide =
      prev.slides[activeRef.current] || prev.slides[prev.slideOrder[0]];
    if (!slide) return;
    const spaced = spaceBoxesEvenly(
      slide.elements,
      selectedElementIdsRef.current,
      axis,
    );
    if (spaced.length < 3) return;
    const byId = new Map(spaced.map((el) => [el.id, el]));
    const elements = slide.elements.map((el) => byId.get(el.id) ?? el);
    const moved = elements.some((el, index) => el !== slide.elements[index]);
    if (!moved) return;
    commit({
      ...prev,
      slides: { ...prev.slides, [slide.id]: { ...slide, elements } },
    });
  };

  const rewriteSelectedGroups = (nextElements: SlideElement[]) => {
    const prev = deckRef.current;
    const slide =
      prev.slides[activeRef.current] || prev.slides[prev.slideOrder[0]];
    if (!slide) return;
    const changed = nextElements.some((el, index) => el !== slide.elements[index]);
    if (!changed) return;
    commit({
      ...prev,
      slides: {
        ...prev.slides,
        [slide.id]: { ...slide, elements: nextElements },
      },
    });
  };

  const groupSelected = () => {
    const slide =
      deckRef.current.slides[activeRef.current] ||
      deckRef.current.slides[deckRef.current.slideOrder[0]];
    if (!slide) return;
    rewriteSelectedGroups(
      groupBoxes(
        slide.elements,
        selectedElementIdsRef.current,
        crypto.randomUUID(),
      ),
    );
  };

  const ungroupSelected = () => {
    const slide =
      deckRef.current.slides[activeRef.current] ||
      deckRef.current.slides[deckRef.current.slideOrder[0]];
    if (!slide) return;
    rewriteSelectedGroups(
      ungroupBoxes(slide.elements, selectedElementIdsRef.current),
    );
  };

  const moveElementsLive = useCallback(
    (positions: { id: string; x: number; y: number }[]) => {
      if (readOnlyRef.current || !positions.length) return;
      const prev = deckRef.current;
      const active =
        prev.slides[activeRef.current] || prev.slides[prev.slideOrder[0]];
      if (!active) return;
      const byId = new Map(positions.map((item) => [item.id, item]));
      let changed = false;
      const elements = active.elements.map((el) => {
        const next = byId.get(el.id);
        if (!next || (next.x === el.x && next.y === el.y)) return el;
        changed = true;
        return { ...el, x: next.x, y: next.y };
      });
      if (!changed) return;
      const deck = {
        ...prev,
        slides: {
          ...prev.slides,
          [active.id]: { ...active, elements },
        },
      };
      deckRef.current = deck;
      liveDirty.current = true;
      setDeck(deck);
      onChange(deck);
    },
    [onChange],
  );

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
    }
  };

  const applyFadeToSelection = () => {
    const elementId = selectedElementRef.current;
    const slideId = activeRef.current;
    if (!elementId || !slideId) return;
    const next = applyFadeOnClick(deckRef.current, slideId, elementId);
    if (next) commit(next);
  };
  const fadeReason = () => {
    const slide = deckRef.current.slides[activeRef.current];
    const el = slide?.elements.find(
      (item) => item.id === selectedElementRef.current,
    );
    return fadeOnClickReason(el);
  };

  const api = useRef({
    undo,
    redo,
    cut: cutSelection,
    copy: copySelection,
    paste: pasteClipboard,
    insertTextBox: addTextBox,
    insertImage: () => imageInputRef.current?.click(),
    insertShape: addShape,
    newSlide: () => addSlide(),
    duplicate: duplicateCurrentSlide,
    deleteSlides: deleteCurrentSlide,
    move: moveSlides,
    toggleBold,
    toggleItalic,
    toggleUnderline,
    align: alignText,
    fadeOnClick: applyFadeToSelection,
    fadeOnClickReason: fadeReason,
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
    insertShape: addShape,
    newSlide: () => addSlide(),
    duplicate: duplicateCurrentSlide,
    deleteSlides: deleteCurrentSlide,
    move: moveSlides,
    toggleBold,
    toggleItalic,
    toggleUnderline,
    align: alignText,
    fadeOnClick: applyFadeToSelection,
    fadeOnClickReason: fadeReason,
    run: runCommand,
  };

  // Mouse drag & resize handlers for elements
  const onElementMouseDown = (
    e: React.MouseEvent,
    elementId: string,
    handle?: ResizeHandle,
  ) => {
    e.stopPropagation();
    if (e.shiftKey && !handle) {
      e.preventDefault();
      shiftSelecting.current = true;
      const current = selectedElementIdsRef.current;
      const next = current.includes(elementId)
        ? current.filter((id) => id !== elementId)
        : [...current, elementId];
      selectedElementIdsRef.current = next;
      setSelectedElementIds(next);
      const primary = next.includes(elementId)
        ? elementId
        : (next.at(-1) ?? null);
      selectedElementRef.current = primary;
      setSelectedElementId(primary);
      if (editingRef.current && !next.includes(editingRef.current)) {
        editingRef.current = null;
        setEditingId(null);
        textRange.current = null;
      }
      return;
    }
    const elements = activeSlide?.elements ?? [];
    const members = groupMemberIds(elements, elementId);
    const ids = members.length ? members : [elementId];
    selectedElementIdsRef.current = ids;
    setSelectedElementIds(ids);
    selectedElementRef.current = elementId;
    setSelectedElementId(elementId);
    if (!handle && editingRef.current && !ids.includes(editingRef.current)) {
      editingRef.current = null;
      setEditingId(null);
      textRange.current = null;
    }
    const el = elements.find((item) => item.id === elementId);
    if (!el || readOnlyRef.current) return;

    draggingRef.current = {
      elementId,
      startX: e.clientX,
      startY: e.clientY,
      initX: el.x,
      initY: el.y,
      handle,
      initW: el.width,
      initH: el.height,
      snapshot: elements,
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
      } = draggingRef.current;
      const canvas = stageRef.current.querySelector(".slide-canvas");
      const rect = (canvas ?? stageRef.current).getBoundingClientRect();
      const scale = rect.width / (deck.width || 960);
      if (!scale) return;

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
        const snapshot = draggingRef.current.snapshot;
        const moved = moveGroupedBoxes(snapshot, elementId, dx, dy);
        const positions = moved.flatMap((next) => {
          const prior = snapshot.find((item) => item.id === next.id);
          if (!prior || (prior.x === next.x && prior.y === next.y)) return [];
          return [{ id: next.id, x: next.x, y: next.y }];
        });
        if (positions.length) moveElementsLive(positions);
      }
    };

    const onMouseUp = () => {
      shiftSelecting.current = false;
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
  }, [deck.width, updateElement, moveElementsLive]);

  // Export handlers
  const exportTxt = async () => {
    const lines: string[] = [];
    lines.push(`Title: ${file.title}`);
    lines.push(`Slides: ${deck.slideOrder.length}\n`);

    deck.slideOrder.forEach((id, i) => {
      const s = deck.slides[id];
      if (!s) return;
      const heading = s.elements
        .find((el) => el.type === "text" && el.content?.trim())
        ?.content?.trim()
        .split("\n")[0];
      lines.push(`--- Slide ${i + 1}: ${s.title || heading || "Untitled"} ---`);
      for (const el of s.elements) {
        if (el.type === "text" && el.content) lines.push(el.content);
        if (el.type === "table" && el.rows) {
          lines.push(el.rows.map((r) => r.join("\t")).join("\n"));
        }
      }
      if (s.notes) lines.push(`[Speaker notes: ${s.notes}]`);
      lines.push("");
    });

    await exportText(filename(file.title, "txt"), lines.join("\n"));
  };

  const exportHtml = async () => {
    const slidesHtml = deck.slideOrder
      .map((id, i) => {
        const s = deck.slides[id];
        if (!s) return "";
        const bg = s.background?.color
          ? `background-color: ${s.background.color};`
          : "background-color: #fff;";
        const elsHtml = s.elements
          .map((el) => {
            const pos = `position: absolute; left: ${(el.x / (deck.width || 960)) * 100}%; top: ${(el.y / (deck.height || 540)) * 100}%; width: ${(el.width / (deck.width || 960)) * 100}%; height: ${(el.height / (deck.height || 540)) * 100}%;`;
            if (el.type === "text") {
              const weight = hasTextRuns(el) ? "normal" : el.bold ? "bold" : "normal";
              const family = JSON.stringify(el.fontFamily || "Arial");
              const style = `${pos} font-size: ${(el.fontSize || 20) * 1.5}px; font-weight: ${weight}; font-style: ${hasTextRuns(el) ? "normal" : el.italic ? "italic" : "normal"}; color: ${el.color || "#1e293b"}; text-align: ${el.align || "left"}; white-space: pre-wrap; word-break: break-word; font-family: ${family};`;
              return `<div style="${style}">${textInnerHtml(el)}</div>`;
            }
            if (el.type === "image" && el.src) {
              return `<img src="${el.src}" alt="${el.alt || "image"}" style="${pos} object-fit: contain;" />`;
            }
            if (el.type === "shape") {
              const border = el.stroke
                ? `border: ${el.strokeWidth || 1}px solid ${el.stroke};`
                : "";
              const rad =
                el.shapeType === "ellipse"
                  ? "border-radius: 50%;"
                  : el.shapeType === "roundRect"
                    ? "border-radius: 12px;"
                    : "";
              return `<div style="${pos} background-color: ${el.fill || "#e2e8f0"}; ${border} ${rad}"></div>`;
            }
            return "";
          })
          .join("\n");
        return `<section class="slide" id="slide-${i + 1}" style="${bg}">
          ${elsHtml}
          ${s.notes ? `<div class="notes">Notes: ${s.notes}</div>` : ""}
        </section>`;
      })
      .join("\n");

    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${file.title}</title>
  <style>
    body { margin: 0; background: #0f172a; font-family: system-ui, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; }
    .slide { width: 960px; height: 540px; position: relative; box-shadow: 0 10px 25px rgba(0,0,0,0.5); overflow: hidden; margin-bottom: 2rem; border-radius: 4px; }
    .notes { position: absolute; bottom: 8px; left: 8px; right: 8px; background: rgba(0,0,0,0.7); color: #fff; padding: 6px; font-size: 12px; border-radius: 4px; }
    @media print { body { background: #fff; } .slide { page-break-after: always; box-shadow: none; margin: 0; width: 100%; height: 100vh; } }
  </style>
</head>
<body>
${slidesHtml}
</body>
</html>`;

    await exportText(filename(file.title, "html"), fullHtml);
  };

  const exportTxtRef = useRef(exportTxt);
  exportTxtRef.current = exportTxt;
  const exportHtmlRef = useRef(exportHtml);
  exportHtmlRef.current = exportHtml;

  const [controlsVisible, setControlsVisible] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsHoveredRef = useRef(false);
  const showFullscreenRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const beginShow = useCallback((fromIndex: number, withNotes?: boolean) => {
    const order = deckRef.current.slideOrder;
    const next = startOfShow(
      fromIndex,
      (index) => Boolean(deckRef.current.slides[order[index]]?.skipped),
      order.length,
    );
    if (next.slideIndex < 0) return;
    showCursorRef.current = next;
    setShowCursor(next);
    if (withNotes !== undefined) setShowSpeakerNotes(withNotes);
    setBlankScreen(null);
    setControlsVisible(true);
    const now = Date.now();
    setShowStartedAt(now);
    setClock(now);
    presentingRef.current = true;
    setPresenting(true);
    // Fullscreen is optional. If the browser denies it, the show stays on the page
    // at the show size, not at the editing zoom.
    showFullscreenRef.current = false;
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) {
      root.requestFullscreen().then(
        () => {
          if (!presentingRef.current) {
            document.exitFullscreen().catch(() => {});
            return;
          }
          showFullscreenRef.current = true;
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
      (index) => Boolean(deckRef.current.slides[order[index]]?.skipped),
    );
    if (samePlace(current, next) && current.enteringId === next.enteringId)
      return;
    showCursorRef.current = next;
    setShowCursor(next);
  };

  const endShow = useCallback(() => {
    presentingRef.current = false;
    setPresenting(false);
    if (showFullscreenRef.current) {
      showFullscreenRef.current = false;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }, []);

  const currentSlideIndex = Math.max(0, deck.slideOrder.indexOf(activeSlideId));
  const editorCorner = slideNumberLabel(
    currentSlideIndex,
    deck.slideOrder.length,
    deck.showSlideNumbers,
  );
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
      flush: async () => onChange(deckRef.current),
      export: async (format: string) => {
        if (format === "html") await exportHtmlRef.current();
        else await exportTxtRef.current();
      },
      print: async () => printDocument(),
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
        insertShape: (shape) => api.current.insertShape(shape),
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
        insertComment: () => openSlideComment(),
        openComments: () => openSlideCommentPanel(),
        openResolved: () => openSlideResolved(),
        fadeOnClick: () => api.current.fadeOnClick(),
        fadeOnClickReason: () => api.current.fadeOnClickReason(),
        undoReason: () => slideApi.current.undoReason(),
        redoReason: () => slideApi.current.redoReason(),
        deleteReason: () => slideApi.current.deleteReason(),
        openSpelling: () => spellingRef.current?.open(),
      },
    });
  }, [
    onActions,
    onChange,
    activeSlideId,
    beginShow,
    openSlideComment,
    openSlideCommentPanel,
    openSlideResolved,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (presentingRef.current) return;
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault();
        setFindOpen(true);
        findInputRef.current?.focus();
        return;
      }
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
      const command = commandFromKey(e, typingContext(e.target));
      if (!command) return;
      if (readOnlyRef.current && command.type !== "copy") {
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
  const skippedAt = (index: number) =>
    Boolean(deck.slides[deck.slideOrder[index]]?.skipped);
  let nextShownIndex = presentSlideIndex + 1;
  while (
    nextShownIndex < deck.slideOrder.length &&
    skippedAt(nextShownIndex)
  ) {
    nextShownIndex += 1;
  }
  const nextPresentSlide = deck.slides[deck.slideOrder[nextShownIndex]];
  const audienceLabel = showSizeLabel(deck.slideOrder.length, skippedAt);
  const showCorner = slideNumberLabel(
    presentSlideIndex,
    deck.slideOrder.length,
    deck.showSlideNumbers,
  );
  const audiencePlace = showPosition(
    presentSlideIndex,
    deck.slideOrder.length,
    skippedAt,
  );
  const fadeIdsAt = (index: number) =>
    fadeOnClickIds(deck.slides[deck.slideOrder[index]]?.elements ?? []);
  const cannotAdvance = samePlace(
    showCursor,
    moveShowCursor(
      showCursor,
      "next",
      fadeIdsAt,
      deck.slideOrder.length,
      skippedAt,
    ),
  );
  const cannotRetreat = samePlace(
    showCursor,
    moveShowCursor(
      showCursor,
      "prev",
      fadeIdsAt,
      deck.slideOrder.length,
      skippedAt,
    ),
  );
  const fadeWaiting = showCursor.revealed < fadeIdsAt(presentSlideIndex).length;
  const elapsedSeconds = Math.max(
    0,
    Math.floor((clock - showStartedAt) / 1000),
  );
  const elapsedLabel = `${Math.floor(elapsedSeconds / 60)}:${String(
    elapsedSeconds % 60,
  ).padStart(2, "0")}`;

  /** Slide content for the show, sized in container units so it scales with
   * whatever box it is drawn in (the full screen or the next-slide preview).
   * The audience view hides fade-on-click objects until they are revealed.
   * The speaker's next-slide preview shows them. */
  const renderShowElements = (slide: Slide | undefined, audience: boolean) => {
    const w = deck.width || 960;
    const h = deck.height || 540;
    const units = (n: number) => `calc(${n} / ${w} * 100cqw)`;
    const order = fadeOnClickIds(slide?.elements ?? []);
    const revealed = audience ? showCursor.revealed : order.length;
    const enteringId = audience ? showCursor.enteringId : null;
    return slide?.elements.map((el) => {
      const phase = audiencePhase(el, revealed, order, enteringId);
      const fadeProps = {
        "data-element-id": el.id,
        className: audienceClass(phase),
        ...(phase === "plain"
          ? {}
          : { "data-fade": phase === "hidden" ? ("hidden" as const) : ("visible" as const) }),
        ...(phase === "hidden" ? { "aria-hidden": true as const } : {}),
      };
      const posStyle: React.CSSProperties = {
        position: "absolute",
        left: `${(el.x / w) * 100}%`,
        top: `${(el.y / h) * 100}%`,
        width: `${(el.width / w) * 100}%`,
        height: `${(el.height / h) * 100}%`,
      };

      if (el.type === "text") {
        return (
          <div
            key={el.id}
            {...fadeProps}
            className={`${fadeProps.className} show-text`}
            style={{
              ...posStyle,
              fontSize: units((el.fontSize || 20) * 0.95),
              padding: units(4),
              ...boxFont(el),
              fontFamily: el.fontFamily || "Arial",
              color: el.color || "#1e293b",
              textAlign: el.align || "left",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              backgroundColor: el.fill || "transparent",
            }}
          >
            <RunSpans
              content={el.content}
              runs={el.runs}
              bold={el.bold}
              italic={el.italic}
              underline={el.underline}
            />
          </div>
        );
      }
      if (el.type === "image" && el.src) {
        return (
          <img
            key={el.id}
            {...fadeProps}
            src={el.src}
            alt={el.alt || "Slide asset"}
            style={{ ...posStyle, objectFit: "contain" }}
          />
        );
      }
      if (el.type === "shape") {
        const border = el.stroke
          ? `${units(el.strokeWidth || 1)} solid ${el.stroke}`
          : "none";
        const rad =
          el.shapeType === "ellipse"
            ? "50%"
            : el.shapeType === "roundRect"
              ? units(16)
              : "0px";
        return (
          <div
            key={el.id}
            {...fadeProps}
            style={{
              ...posStyle,
              backgroundColor: el.fill || "#e2e8f0",
              border,
              borderRadius: rad,
            }}
          />
        );
      }
      if (el.type === "table" && el.rows) {
        return (
          <table
            key={el.id}
            {...fadeProps}
            className={`${fadeProps.className} show-table`}
            style={posStyle}
          >
            <tbody>
              {el.rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      style={{
                        fontSize: units(14),
                        padding: `${units(4)} ${units(8)}`,
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
      }
      return null;
    });
  };

  const slideHeading = (slide: Slide) =>
    slide.elements
      .find((el) => el.type === "text" && el.content?.trim())
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

  const zoomRatio = Number.parseInt(zoom, 10) / 100;

  return (
    <div
      className="slides-editor"
      data-deck-snapshot={JSON.stringify(deck)}
    >
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
            <span className="menu-item-shortcut">Cmd+D</span>
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
            <span className="menu-item-shortcut">Delete</span>
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
            <span className="menu-item-shortcut">Cmd+Shift+Up</span>
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
            <span className="menu-item-shortcut">Cmd+Shift+Down</span>
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
            Theme
          </button>
          <Menu label="+ New slide">
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
          <Tool label="Rectangle" onClick={() => addShape("roundRect")}>
            <Square size={16} />
          </Tool>
          <Tool label="Circle" onClick={() => addShape("ellipse")}>
            <Circle size={16} />
          </Tool>
          <input
            hidden
            type="file"
            ref={imageInputRef}
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            onChange={handleImageUpload}
          />
        </div>

        <div className="toolbar-divider" />

        {/* Dynamic Contextual Tools: Fill, Border, Typography or Slide background/layout */}
        {selectedElementIds.length >= 2 ? (
          <>
            <div className="tool-group">
              <Tool
                label={oneGroup ? "Ungroup" : "Group"}
                onClick={oneGroup ? ungroupSelected : groupSelected}
              >
                {oneGroup ? <Ungroup size={16} /> : <Group size={16} />}
                <span className="align-box-label">
                  {oneGroup ? "Ungroup" : "Group"}
                </span>
              </Tool>
            </div>
            <div className="tool-group">
              <Tool label="Align left" onClick={() => alignSelectedBoxes("left")}>
                <AlignStartHorizontal size={16} />
                <span className="align-box-label">Align left</span>
              </Tool>
              <Tool label="Align top" onClick={() => alignSelectedBoxes("top")}>
                <AlignVerticalJustifyStart size={16} />
                <span className="align-box-label">Align top</span>
              </Tool>
              <Tool label="Align right" onClick={() => alignSelectedBoxes("right")}>
                <AlignEndHorizontal size={16} />
                <span className="align-box-label">Align right</span>
              </Tool>
              <Tool label="Align bottom" onClick={() => alignSelectedBoxes("bottom")}>
                <AlignVerticalJustifyEnd size={16} />
                <span className="align-box-label">Align bottom</span>
              </Tool>
            </div>
            {selectedElementIds.length >= 3 ? (
              <div className="tool-group space-evenly-tools">
                <Tool
                  label="Space evenly across"
                  onClick={() => spaceSelectedBoxes("across")}
                >
                  <AlignHorizontalSpaceBetween size={16} />
                  <span className="align-box-label">Space evenly across</span>
                </Tool>
                <Tool
                  label="Space evenly down"
                  onClick={() => spaceSelectedBoxes("down")}
                >
                  <AlignVerticalSpaceBetween size={16} />
                  <span className="align-box-label">Space evenly down</span>
                </Tool>
              </div>
            ) : null}
          </>
        ) : selectedElement ? (
          <div className="tool-group">
            {/* Fill color */}
            <Menu label="Fill">
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
            <Menu label="Border">
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

            {selectedElement.type === "text" ? (
              <>
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
            ) : null}

            <Tool label="Delete element" onClick={deleteSelectedElement}>
              <Trash2 size={16} />
            </Tool>
          </div>
        ) : (
          <div className="tool-group">
            <Menu label="Background">
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

            <Menu label="Layout">
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

          </div>
        )}
        </fieldset>

        <Tool label="Print (Cmd+P)" onClick={() => printDocument()}>
          <Printer size={16} />
        </Tool>

        {/* Google Slides styled Slideshow button */}
        <div className="tool-group right-tools" style={{ marginLeft: "auto" }}>
          <Tool
            label="Find"
            active={findOpen}
            onClick={() => setFindOpen((open) => !open)}
          >
            <Search size={16} />
            <span className="find-label">Find</span>
          </Tool>
          <select
            className="toolbar-select zoom-select"
            aria-label="Zoom"
            value={zoom}
            onChange={(e) => {
              const next = e.target.value;
              if (!isSlideZoom(next)) return;
              setZoom(next);
              rememberSlideZoom(file.id, next);
            }}
          >
            <option value="50%">50%</option>
            <option value="75%">75%</option>
            <option value="90%">90%</option>
            <option value="100%">100%</option>
            <option value="125%">125%</option>
            <option value="150%">150%</option>
            <option value="200%">200%</option>
          </select>
          <div className="slideshow-split">
            <button
              type="button"
              className="slideshow-btn"
              aria-label="Slideshow"
              onClick={() => beginShow(currentSlideIndex)}
              title={`Present from current slide (Cmd+Enter). Audience will see ${audienceLabel}.`}
            >
              <Play size={14} fill="currentColor" />
              <span>Slideshow</span>
              <span className="slideshow-audience">{audienceLabel}</span>
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
                  <MenuItem onSelect={() => beginShow(currentSlideIndex, true)}>
                    Present with speaker notes
                  </MenuItem>
                </Dropdown.Content>
              </Dropdown.Portal>
            </Dropdown.Root>
          </div>
        </div>
      </div>

      {findOpen && !presenting ? (
        <div className="slide-find-bar" role="search">
          <label htmlFor="slide-find-input">Find</label>
          <input
            id="slide-find-input"
            ref={findInputRef}
            className="slide-find-input"
            aria-label="Find text"
            value={findQuery}
            onChange={(e) => updateFind(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                findNext();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeFind();
              }
            }}
          />
          <span className="slide-find-status" role="status">
            {findStatus(findQuery, matches, findIndex)}
          </span>
          <button
            type="button"
            className="slide-find-next"
            aria-label="Next match"
            onClick={findNext}
            disabled={!matches.length}
          >
            Next
          </button>
          <button
            type="button"
            className="slide-find-close"
            aria-label="Close find"
            onClick={closeFind}
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      {selectedElement?.themeOverride && deck.theme ? (
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
              const idx = order.indexOf(activeRef.current);
              const to = e.key === "ArrowUp" ? idx - 1 : idx + 1;
              if (to < 0 || to >= order.length) return;
              const nextId = order[to];
              anchorRef.current = nextId;
              applySelection(nextId, [nextId], null);
            }}
          >
            {deck.slideOrder.map((id, index) => {
              const slide = deck.slides[id];
              const isActive = id === activeSlideId;
              const isChosen = selectedSlideIds.includes(id);
              const heading = slide?.elements
                .find((el) => el.type === "text" && el.content?.trim())
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
                  aria-label={`Slide ${index + 1}${slide?.skipped ? ", Skipped" : ""}${slide?.transition && slide.transition.type !== "none" ? `, ${slide.transition.type} transition` : ""}${heading ? `: ${heading}` : ""}`}
                  className={`thumbnail-row ${isChosen ? "selected" : ""} ${isActive ? "active" : ""} ${slide?.skipped ? "is-skipped" : ""} ${slideDrag?.over != null && slideDrag.ids.includes(id) ? "drag-source" : ""} ${dropClass}`}
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
                  <div className="thumbnail-body">
                  <div
                    className="thumbnail-card"
                    style={{ backgroundColor: bg }}
                  >
                    <div className="thumbnail-preview">
                      {slide?.elements.map((el) => {
                        const miniStyle: React.CSSProperties = {
                          position: "absolute",
                          left: `${(el.x / (deck.width || 960)) * 100}%`,
                          top: `${(el.y / (deck.height || 540)) * 100}%`,
                          width: `${(el.width / (deck.width || 960)) * 100}%`,
                          height: `${(el.height / (deck.height || 540)) * 100}%`,
                        };
                        if (el.type === "text") {
                          return (
                            <div
                              key={el.id}
                              className="mini-text"
                              style={{
                                ...miniStyle,
                                color: el.color || "#1e293b",
                                textAlign: el.align || "left",
                                ...boxFont(el),
                              }}
                            >
                              <RunSpans
                                content={el.content}
                                runs={el.runs}
                                bold={el.bold}
                                italic={el.italic}
                                underline={el.underline}
                              />
                            </div>
                          );
                        }
                        if (el.type === "shape") {
                          return (
                            <div
                              key={el.id}
                              className="mini-shape"
                              style={{
                                ...miniStyle,
                                backgroundColor: el.fill || "#cbd5e1",
                                borderRadius:
                                  el.shapeType === "ellipse"
                                    ? "50%"
                                    : el.shapeType === "roundRect"
                                      ? "2px"
                                      : "0",
                              }}
                            />
                          );
                        }
                        if (el.type === "image" && el.src) {
                          return (
                            <img
                              key={el.id}
                              src={el.src}
                              alt=""
                              className="mini-img"
                              style={miniStyle}
                            />
                          );
                        }
                        return null;
                      })}
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
                  {slide?.skipped ? (
                    <span className="thumbnail-skipped">Skipped</span>
                  ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="slides-sidebar-footer">
            <button
              type="button"
              className="slide-numbers-btn"
              aria-pressed={deck.showSlideNumbers === true}
              disabled={readOnly}
              onClick={toggleSlideNumbers}
            >
              Slide numbers
            </button>
            <button
              type="button"
              className="skip-slide-btn"
              disabled={readOnly || !activeSlide}
              onClick={toggleSkipSlide}
            >
              {activeSlide?.skipped ? "Unskip" : "Skip slide"}
            </button>
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
          <div className="slide-stage-row">
          <div
            className="slide-stage-viewport"
            ref={stageRef}
            onClick={() => selectElement(null)}
          >
            <div
              className={`slide-canvas print-slide${canvasMotion ? ` deck-motion-${canvasMotion.type}` : ""}`}
              data-zoom={zoom}
              style={{
                backgroundColor: shownSlide?.background?.color || "#ffffff",
                aspectRatio: `${deck.width || 960} / ${deck.height || 540}`,
                ["--deck-motion" as string]: `${canvasMotion?.ms ?? 0}ms`,
                // Zoom enlarges the editing canvas only. Stored coordinates stay put.
                ...(zoom === "100%"
                  ? {}
                  : {
                      width: 960 * zoomRatio,
                      maxWidth: 960 * zoomRatio,
                      minWidth: 960 * zoomRatio,
                      marginTop: 0,
                      marginBottom: 0,
                    }),
              }}
            >
              {shownSlide?.elements.map((el) => {
                const isSelected = selectedElementIds.includes(el.id);
                const posStyle: React.CSSProperties = {
                  position: "absolute",
                  left: `${(el.x / (deck.width || 960)) * 100}%`,
                  top: `${(el.y / (deck.height || 540)) * 100}%`,
                  width: `${(el.width / (deck.width || 960)) * 100}%`,
                  height: `${(el.height / (deck.height || 540)) * 100}%`,
                };

                if (el.type === "text") {
                  return (
                    <div
                      key={el.id}
                      data-element-id={el.id}
                      data-x={el.x}
                      data-y={el.y}
                      data-selected={isSelected ? "true" : "false"}
                      className={`slide-element slide-text ${isSelected ? "selected" : ""}${editorFadeClass(el)}${findOpen && matches[findIndex]?.elementId === el.id && matches[findIndex]?.slideId === activeSlideId ? " find-match" : ""}`}
                      {...editorFadeAttrs(el)}
                      style={{
                        ...posStyle,
                        fontSize: `${(el.fontSize || 20) * 0.95 * zoomRatio}px`,
                        ...boxFont(el),
                        fontFamily: el.fontFamily || "Arial",
                        color: el.color || "#1e293b",
                        textAlign: el.align || "left",
                        backgroundColor: el.fill || "transparent",
                        ["--spell-caret" as string]: el.color || "#1e293b",
                      }}
                      onMouseDown={(e) => {
                        const inEditor = (e.target as HTMLElement).closest?.(
                          ".element-editor",
                        );
                        if (editingRef.current === el.id && inEditor) return;
                        onElementMouseDown(e, el.id);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (readOnlyRef.current) return;
                        editingRef.current = el.id;
                        textRange.current = null;
                        setEditingId(el.id);
                        selectedElementRef.current = el.id;
                        setSelectedElementId(el.id);
                        selectedElementIdsRef.current = [el.id];
                        setSelectedElementIds([el.id]);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <FadeOnClickMark element={el} />
                      {editingId === el.id || hasTextRuns(el) ? (
                        <SlideTextBody
                          content={el.content}
                          runs={el.runs}
                          bold={el.bold}
                          italic={el.italic}
                          underline={el.underline}
                          placeholder={el.placeholder}
                          editing={editingId === el.id && !readOnly}
                          onText={(runs) =>
                            updateElement(
                              el.id,
                              {
                                content: runs.map((run) => run.text).join(""),
                                runs: hasTextRuns({ runs }) ? runs : undefined,
                                bold: false,
                                italic: false,
                                underline: false,
                              },
                              { coalesce: `type:${el.id}` },
                            )
                          }
                          onCaret={(sel) => rememberCaret(el.id, sel)}
                        />
                      ) : (
                        <>
                          <SlideSpellMirror text={el.content || ""} fileId={file.id} />
                          <textarea
                            className="element-textarea"
                            readOnly={readOnly}
                            value={el.content || ""}
                            placeholder={el.placeholder ?? "Click to add text"}
                            onMouseDown={(e) => {
                              if (e.shiftKey) e.preventDefault();
                            }}
                            onChange={(e) =>
                              updateElement(
                                el.id,
                                { content: e.target.value },
                                { coalesce: `type:${el.id}` },
                              )
                            }
                            onFocus={() => {
                              if (shiftSelecting.current) return;
                              const ids = selectedElementIdsRef.current;
                              if (ids.length > 1 && ids.includes(el.id)) return;
                              selectElement(el.id);
                            }}
                          />
                        </>
                      )}
                      {isSelected && !readOnly ? renderHandles(el.id) : null}
                    </div>
                  );
                }

                if (el.type === "image" && el.src) {
                  return (
                    <div
                      key={el.id}
                      data-element-id={el.id}
                      data-x={el.x}
                      data-y={el.y}
                      className={`slide-element slide-image ${isSelected ? "selected" : ""}${editorFadeClass(el)}`}
                      {...editorFadeAttrs(el)}
                      style={posStyle}
                      onMouseDown={(e) => onElementMouseDown(e, el.id)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <FadeOnClickMark element={el} />
                      <img src={el.src} alt={el.alt || "Slide asset"} />
                      {isSelected && !readOnly ? renderHandles(el.id) : null}
                    </div>
                  );
                }

                if (el.type === "shape") {
                  const border = el.stroke
                    ? `${el.strokeWidth || 1}px solid ${el.stroke}`
                    : "none";
                  const rad =
                    el.shapeType === "ellipse"
                      ? "50%"
                      : el.shapeType === "roundRect"
                        ? "12px"
                        : "0px";

                  return (
                    <div
                      key={el.id}
                      data-element-id={el.id}
                      data-x={el.x}
                      data-y={el.y}
                      className={`slide-element slide-shape ${isSelected ? "selected" : ""}${editorFadeClass(el)}`}
                      {...editorFadeAttrs(el)}
                      style={{
                        ...posStyle,
                        backgroundColor: el.fill || "#e2e8f0",
                        border,
                        borderRadius: rad,
                      }}
                      onMouseDown={(e) => onElementMouseDown(e, el.id)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <FadeOnClickMark element={el} />
                      {isSelected && !readOnly ? renderHandles(el.id) : null}
                    </div>
                  );
                }

                if (el.type === "table" && el.rows) {
                  return (
                    <div
                      key={el.id}
                      data-element-id={el.id}
                      data-x={el.x}
                      data-y={el.y}
                      className={`slide-element slide-table ${isSelected ? "selected" : ""}${editorFadeClass(el)}`}
                      {...editorFadeAttrs(el)}
                      style={posStyle}
                      onMouseDown={(e) => onElementMouseDown(e, el.id)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <FadeOnClickMark element={el} />
                      <table>
                        <tbody>
                          {el.rows.map((row, rIdx) => (
                            <tr key={rIdx}>
                              {row.map((cell, cIdx) => (
                                <td key={cIdx}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {isSelected && !readOnly ? renderHandles(el.id) : null}
                    </div>
                  );
                }

                return null;
              })}
              <SlideNumberCorner label={editorCorner} />
              {slideComments.marks}
            </div>
          </div>
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
                readOnly={readOnly}
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
        {panel ? (
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
            key={presentSlideIndex}
            className={`presenter-slide-box show-slide${showMotionClass}`}
            style={{
              backgroundColor: presentSlide?.background?.color || "#ffffff",
              ["--deck-motion" as string]: `${transitionMs(presentSlide?.transition, reducedMotion)}ms`,
              aspectRatio: `${deck.width || 960} / ${deck.height || 540}`,
              width: showSpeakerNotes
                ? `min(62vw, calc((100vh - 112px) * ${deck.width || 960} / ${deck.height || 540}))`
                : `min(100vw, calc(100vh * ${deck.width || 960} / ${deck.height || 540}))`,
            }}
            onClick={() => moveShowRef.current("next")}
          >
            {renderShowElements(presentSlide, true)}
            <SlideNumberCorner label={showCorner} />
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
                        `Slide ${showPosition(nextShownIndex, deck.slideOrder.length, skippedAt).position}`}
                    </span>
                    <div
                      className="presenter-next-slide show-slide"
                      style={{
                        backgroundColor:
                          nextPresentSlide.background?.color || "#ffffff",
                        aspectRatio: `${deck.width || 960} / ${deck.height || 540}`,
                      }}
                    >
                      {renderShowElements(nextPresentSlide, false)}
                    </div>
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
              Slide {audiencePlace.position || 1} of{" "}
              {audiencePlace.shown || deck.slideOrder.length}
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
    </div>
  );
}
