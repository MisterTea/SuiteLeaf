import { useRef, useState } from "react";
import type { Slide, SlideElement, SlideFile, SlideTheme } from "@suiteleaf/core";
import type { SlidePictureEdit } from "./svg-picture-edit";
import type { SlideshowRecorder } from "./slide-record";
import type { Layout } from "./slide-layouts";
import { DeckHistory } from "./slide-editing";
import type { TransitionType } from "./slide-theme";
import { useReducedMotion } from "./slide-design-panel";
import { useSlideThemeLibrary } from "./slide-theme-library";
import { startOfShow, type ShowCursor, type ShowMove } from "./slide-fade-in";
import { slideAtAddress } from "../slide-location";

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** The state and refs that the slides editor's hooks, actions, and views share. */
export function useSlidesEditorState({
  file,
  slideId,
  onSlideUrl,
  onChange,
  readOnly,
}: {
  file: SlideFile;
  slideId?: string;
  onSlideUrl?: (slideId: string) => void;
  onChange: (content: SlideFile["content"], op?: unknown) => void;
  readOnly: boolean;
}) {
  const [deck, setDeck] = useState<SlideFile["content"]>(() =>
    structuredClone(file.content),
  );
  const openedAt = slideAtAddress(file.content.slideOrder, slideId);
  const [activeSlideId, setActiveSlideId] = useState<string>(openedAt);
  const [snapGuide, setSnapGuide] = useState<{ x: number | null; y: number | null } | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null,
  );
  const [svgEdit, setSvgEdit] = useState<SlidePictureEdit | null>(null);
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
  const [selectedSlideIds, setSelectedSlideIds] = useState<string[]>([openedAt]);
  const onSlideUrlRef = useRef(onSlideUrl);
  onSlideUrlRef.current = onSlideUrl;
  const [notice, setNotice] = useState<{ count: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [historyMarks, setHistoryMarks] = useState({
    undo: false,
    redo: false,
  });
  const [showNotes, setShowNotes] = useState(() => window.innerWidth > 700);
  const [presenting, setPresenting] = useState(false);
  const [handoutsOpen, setHandoutsOpen] = useState(false);
  const [wordArtOpen, setWordArtOpen] = useState(false);
  const [showCursor, setShowCursor] = useState<ShowCursor>(() => startOfShow());
  const presentSlideIndex = showCursor.slideIndex;
  const [showSpeakerNotes, setShowSpeakerNotes] = useState(false);
  const [blankScreen, setBlankScreen] = useState<string | null>(null);
  const audiencePopup = useRef<Window | null>(null);
  const [showStartedAt, setShowStartedAt] = useState(0);
  const [timerPaused, setTimerPaused] = useState(false);
  const [frozenElapsedMs, setFrozenElapsedMs] = useState(0);
  const [clock, setClock] = useState(0);
  const [panel, setPanel] = useState<
    "theme" | "transition" | "animation" | "master" | "language" | "geometry" | null
  >(null);
  const [accessOpen, setAccessOpen] = useState(false);
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
  const selectedIdsRef = useRef<string[]>([]);
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
    group?: { id: string; x: number; y: number }[];
    initW?: number;
    initH?: number;
    reorder?: boolean;
    fitted?: boolean;
  } | null>(null);

  const activeDeckSlide = (prev: SlideFile["content"]) =>
    prev.slides[activeRef.current] || prev.slides[prev.slideOrder[0]];

  return {
    deck, setDeck, activeSlideId, setActiveSlideId, snapGuide, setSnapGuide,
    selectedElementId, setSelectedElementId, svgEdit, setSvgEdit, tableCell, setTableCell,
    tableCellRef, editingId, setEditingId, caretMarks, setCaretMarks, selectedSlideIds,
    setSelectedSlideIds, onSlideUrlRef, notice, setNotice, contextMenu, setContextMenu,
    historyMarks, setHistoryMarks, showNotes, setShowNotes, presenting, setPresenting,
    handoutsOpen, setHandoutsOpen, wordArtOpen, setWordArtOpen, showCursor, setShowCursor,
    presentSlideIndex, showSpeakerNotes, setShowSpeakerNotes, blankScreen, setBlankScreen,
    audiencePopup, showStartedAt, setShowStartedAt, timerPaused, setTimerPaused,
    frozenElapsedMs, setFrozenElapsedMs, clock, setClock, panel, setPanel, accessOpen,
    setAccessOpen, recording, setRecording, recorderRef, marpOpen, setMarpOpen, marpWarnings,
    setMarpWarnings, previewTheme, setPreviewTheme, transitionScope, setTransitionScope,
    transitionDuration, setDuration, chosenTransition, setChosenTransition, transitionStatus,
    setTransitionStatus, canvasMotion, setCanvasMotion, showMotion, setShowMotion, themeEdits,
    apiRef, reducedMotion, libraryThemes, saveLibraryTheme, historyRef, deckRef, activeRef,
    selectedRef, selectedIdsRef, selectedElementRef, editingRef, textRange, anchorRef,
    presentingRef, handoutsRef, showCursorRef, moveShowRef, pendingFocus, textPress, dragMoved,
    spellCaret, setSpellCaret, liveDirty, clipboard, commitRef, marpOpenRef, marpStale, painted,
    setPainted, focusedBox, setFocusedBox, marpAreaRef, onChangeRef, readOnlyRef, imageInputRef,
    audioInputRef, videoInputRef, spellingRef, stageRef, draggingRef, activeDeckSlide,
  };
}

export type SlidesEditorState = ReturnType<typeof useSlidesEditorState>;
