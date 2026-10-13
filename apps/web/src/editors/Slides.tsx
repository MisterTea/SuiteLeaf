import {
  useCallback,
  useEffect,
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
  List,
  Undo2,
  Redo2,
  X,
  Printer,
  MousePointer2,
  Minus,
  StickyNote,
  Blend,
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
import {
  applyBackground,
  applyLayout,
  reorder,
  type Layout,
} from "./slide-layouts";
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

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export default function Slides({
  file,
  onChange,
  onActions,
  onError,
}: {
  file: SlideFile;
  onChange: (content: SlideFile["content"]) => void;
  onActions: (actions: EditorActions) => void;
  onError: (s: string) => void;
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
  const [showNotes, setShowNotes] = useState(true);
  const [presenting, setPresenting] = useState(false);
  const [presentSlideIndex, setPresentSlideIndex] = useState(0);
  const [showSpeakerNotes, setShowSpeakerNotes] = useState(false);
  const [blankScreen, setBlankScreen] = useState<string | null>(null);
  const [showStartedAt, setShowStartedAt] = useState(0);
  const [clock, setClock] = useState(0);
  const [panel, setPanel] = useState<"theme" | "transition" | null>(null);
  const [previewTheme, setPreviewTheme] = useState<SlideTheme | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    file.content.slideOrder[0] ? [file.content.slideOrder[0]] : [],
  );
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
  const anchorIndex = useRef(0);

  // Undo/Redo history
  const history = useRef<SlideFile["content"][]>([
    structuredClone(file.content),
  ]);
  const historyIndex = useRef(0);
  const deckRef = useRef(deck);
  deckRef.current = deck;

  const imageInputRef = useRef<HTMLInputElement>(null);
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
  } | null>(null);

  // Commit changes and push to undo history
  const commit = useCallback(
    (newDeck: SlideFile["content"], pushHistory = true) => {
      setDeck(newDeck);
      onChange(newDeck);
      if (pushHistory) {
        history.current = history.current.slice(0, historyIndex.current + 1);
        history.current.push(structuredClone(newDeck));
        if (history.current.length > 50) history.current.shift();
        historyIndex.current = history.current.length - 1;
      }
    },
    [onChange],
  );

  const undo = () => {
    if (historyIndex.current > 0) {
      historyIndex.current--;
      const prev = structuredClone(history.current[historyIndex.current]);
      setDeck(prev);
      onChange(prev);
    }
  };

  const redo = () => {
    if (historyIndex.current < history.current.length - 1) {
      historyIndex.current++;
      const next = structuredClone(history.current[historyIndex.current]);
      setDeck(next);
      onChange(next);
    }
  };

  // Active slide
  const activeSlide =
    deck.slides[activeSlideId] || deck.slides[deck.slideOrder[0]];
  const selectedElement =
    activeSlide?.elements.find((el) => el.id === selectedElementId) || null;

  // Add new slide
  const addSlide = (layout: Layout = "title-body") => {
    const slide = slideFromTheme(layout, deck.theme, activeSlide?.transition);
    const newId = slide.id;
    const currentIdx = deck.slideOrder.indexOf(activeSlideId);
    const newOrder = [...deck.slideOrder];
    newOrder.splice(currentIdx + 1, 0, newId);

    const updated = {
      ...deck,
      slideOrder: newOrder,
      slides: { ...deck.slides, [newId]: slide },
    };
    commit(updated);
    setActiveSlideId(newId);
    setSelectedIds([newId]);
    setSelectedElementId(null);
  };

  // Duplicate slide
  const duplicateCurrentSlide = () => {
    if (!activeSlide) return;
    const newId = crypto.randomUUID();
    const clonedSlide: Slide = structuredClone(activeSlide);
    clonedSlide.id = newId;
    if (activeSlide.title) clonedSlide.title = `${activeSlide.title} (copy)`;
    clonedSlide.elements = clonedSlide.elements.map((el) => ({
      ...el,
      id: crypto.randomUUID(),
    }));

    const currentIdx = deck.slideOrder.indexOf(activeSlideId);
    const newOrder = [...deck.slideOrder];
    newOrder.splice(currentIdx + 1, 0, newId);

    const updated = {
      ...deck,
      slideOrder: newOrder,
      slides: { ...deck.slides, [newId]: clonedSlide },
    };
    commit(updated);
    setActiveSlideId(newId);
  };

  // Delete slide
  const deleteCurrentSlide = () => {
    if (deck.slideOrder.length <= 1) {
      onError("Presentations must have at least one slide.");
      return;
    }
    const currentIdx = deck.slideOrder.indexOf(activeSlideId);
    const newOrder = deck.slideOrder.filter((id) => id !== activeSlideId);
    const newSlides = { ...deck.slides };
    delete newSlides[activeSlideId];

    const nextId = newOrder[Math.min(currentIdx, newOrder.length - 1)];
    const updated = { ...deck, slideOrder: newOrder, slides: newSlides };
    commit(updated);
    setActiveSlideId(nextId);
    setSelectedElementId(null);
  };

  // Reorder slide up/down
  const moveSlide = (direction: "up" | "down") => {
    const idx = deck.slideOrder.indexOf(activeSlideId);
    if (direction === "up" && idx <= 0) return;
    if (direction === "down" && idx >= deck.slideOrder.length - 1) return;
    moveSlideTo(idx, direction === "up" ? idx - 1 : idx + 1);
  };

  const moveSlideTo = (from: number, to: number) => {
    if (from === to) return;
    commit({ ...deck, slideOrder: reorder(deck.slideOrder, from, to) });
  };

  // Drag a thumbnail to reorder: `over` is the gap index (0..n) it would land in
  const [slideDrag, setSlideDrag] = useState<{
    from: number;
    startY: number;
    over: number | null;
  } | null>(null);
  const thumbnailsRef = useRef<HTMLDivElement>(null);
  const suppressThumbnailClick = useRef(false);

  useEffect(() => {
    if (!slideDrag) return;
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
      if (slideDrag.over === null && Math.abs(e.clientY - slideDrag.startY) < 6)
        return;
      const over = gapAt(e.clientY);
      if (over !== slideDrag.over) setSlideDrag({ ...slideDrag, over });
    };
    const onUp = () => {
      const { from, over } = slideDrag;
      setSlideDrag(null);
      if (over === null) return;
      suppressThumbnailClick.current = true;
      setTimeout(() => (suppressThumbnailClick.current = false));
      setActiveSlideId(deck.slideOrder[from]);
      setSelectedElementId(null);
      moveSlideTo(from, over > from ? over - 1 : over);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  });

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

  if (deck.theme) themeEdits.current.set(deck.theme.id, deck.theme);
  const resolveTheme = (theme: SlideTheme) =>
    themeEdits.current.get(theme.id) ?? theme;
  const shownSlide =
    previewTheme && activeSlide ? paintSlide(activeSlide, previewTheme) : activeSlide;

  const useTheme = (theme: SlideTheme) => {
    themeEdits.current.set(theme.id, theme);
    setPreviewTheme(null);
    commit(applyDeckTheme(deck, theme));
  };
  const transitionTargets = () =>
    transitionScope === "all" ? deck.slideOrder : selectedIds;
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

  // Update active slide properties
  const updateSlide = useCallback(
    (partial: Partial<Slide>) => {
      setDeck((prev) => {
        const active =
          prev.slides[activeSlideId] || prev.slides[prev.slideOrder[0]];
        if (!active) return prev;
        const updatedSlide = { ...active, ...partial };
        const next = {
          ...prev,
          slides: { ...prev.slides, [active.id]: updatedSlide },
        };
        onChange(next);
        return next;
      });
    },
    [activeSlideId, onChange],
  );

  // Update a specific element on the active slide
  const updateElement = useCallback(
    (elementId: string, partial: Partial<SlideElement>) => {
      setDeck((prev) => {
        const active =
          prev.slides[activeSlideId] || prev.slides[prev.slideOrder[0]];
        if (!active) return prev;
        const updatedElements = active.elements.map((el) =>
          el.id === elementId ? { ...el, ...partial } : el,
        );
        const updatedSlide = { ...active, elements: updatedElements };
        const next = {
          ...prev,
          slides: { ...prev.slides, [active.id]: updatedSlide },
        };
        onChange(next);
        return next;
      });
    },
    [activeSlideId, onChange],
  );

  // Add text element
  const addTextBox = () => {
    const newEl: SlideElement = {
      id: crypto.randomUUID(),
      type: "text",
      x: 100,
      y: 180,
      width: 400,
      height: 80,
      content: "",
      fontSize: 22,
      ...textDefaults(deck.theme),
      align: "left",
    };
    updateSlide({ elements: [...activeSlide.elements, newEl] });
    setSelectedElementId(newEl.id);
  };

  // Add shape
  const addShape = (shapeType: "rect" | "roundRect" | "ellipse") => {
    const newEl: SlideElement = {
      id: crypto.randomUUID(),
      type: "shape",
      x: 680,
      y: 420,
      width: shapeType === "ellipse" ? 100 : 200,
      height: shapeType === "ellipse" ? 100 : 64,
      shapeType,
      ...shapeDefaults(deck.theme),
      strokeWidth: 2,
    };
    updateSlide({ elements: [...activeSlide.elements, newEl] });
    setSelectedElementId(newEl.id);
  };

  // Add image
  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      onError("Please choose an image smaller than 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const newEl: SlideElement = {
        id: crypto.randomUUID(),
        type: "image",
        x: 150,
        y: 100,
        width: 360,
        height: 240,
        src,
        alt: file.name,
      };
      updateSlide({ elements: [...activeSlide.elements, newEl] });
      setSelectedElementId(newEl.id);
    };
    reader.readAsDataURL(file);
  };

  // Delete selected element
  const deleteSelectedElement = () => {
    if (!selectedElementId || !activeSlide) return;
    const remaining = activeSlide.elements.filter(
      (el) => el.id !== selectedElementId,
    );
    updateSlide({ elements: remaining });
    setSelectedElementId(null);
  };

  // Mouse drag & resize handlers for elements
  const onElementMouseDown = (
    e: React.MouseEvent,
    elementId: string,
    handle?: ResizeHandle,
  ) => {
    e.stopPropagation();
    setSelectedElementId(elementId);
    const el = activeSlide.elements.find((item) => item.id === elementId);
    if (!el) return;

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
      } = draggingRef.current;
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

        updateElement(elementId, {
          x: newX,
          y: newY,
          width: newW,
          height: newH,
        });
      } else {
        const newX = Math.round(initX + dx);
        const newY = Math.round(initY + dy);
        updateElement(elementId, { x: newX, y: newY });
      }
    };

    const onMouseUp = () => {
      draggingRef.current = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [deck.width, updateElement]);

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
              const style = `${pos} font-size: ${(el.fontSize || 20) * 1.5}px; font-weight: ${el.bold ? "bold" : "normal"}; font-style: ${el.italic ? "italic" : "normal"}; color: ${el.color || "#1e293b"}; text-align: ${el.align || "left"}; white-space: pre-wrap; word-break: break-word;`;
              return `<div style="${style}">${el.content || ""}</div>`;
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
    setPresentSlideIndex(fromIndex);
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

  const endShow = useCallback(() => {
    setPresenting(false);
    if (showFullscreenRef.current) {
      showFullscreenRef.current = false;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  }, []);

  const currentSlideIndex = Math.max(0, deck.slideOrder.indexOf(activeSlideId));

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
        newSlide: () => apiRef.current.addSlide("title-body"),
        applyLayout: (layout) => apiRef.current.applyLayout(layout),
        openTheme: () => apiRef.current.openTheme(),
        openTransition: () => apiRef.current.openTransition(),
      },
    });
  }, [onActions, onChange, activeSlideId, beginShow]);

  // Cmd/Ctrl+Enter presents from the current slide, adding Shift from the start
  useEffect(() => {
    if (presenting) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "Enter") {
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
      apiRef.current.addSlide("title-body");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [presenting, activeSlideId, beginShow]);

  // Keyboard navigation and auto-hiding controls for presentation mode
  useEffect(() => {
    if (!presenting) return;
    const last = deck.slideOrder.length - 1;
    const goTo = (index: (prev: number) => number) => {
      setBlankScreen(null);
      setPresentSlideIndex((prev) => Math.max(0, Math.min(last, index(prev))));
    };
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
          goTo((prev) => prev + 1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
        case "Backspace":
        case "p":
          goTo((prev) => prev - 1);
          break;
        case "Home":
          goTo(() => 0);
          break;
        case "End":
          goTo(() => last);
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
  }, [presenting, deck.slideOrder.length, endShow]);

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
  const nextPresentSlide = deck.slides[deck.slideOrder[presentSlideIndex + 1]];
  const elapsedSeconds = Math.max(
    0,
    Math.floor((clock - showStartedAt) / 1000),
  );
  const elapsedLabel = `${Math.floor(elapsedSeconds / 60)}:${String(
    elapsedSeconds % 60,
  ).padStart(2, "0")}`;

  /** Slide content for the show, sized in container units so it scales with
   * whatever box it is drawn in (the full screen or the next-slide preview). */
  const renderShowElements = (slide: Slide | undefined) => {
    const w = deck.width || 960;
    const h = deck.height || 540;
    const units = (n: number) => `calc(${n} / ${w} * 100cqw)`;
    return slide?.elements.map((el) => {
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
            className="show-text"
            style={{
              ...posStyle,
              fontSize: units((el.fontSize || 20) * 0.95),
              padding: units(4),
              fontWeight: el.bold ? "bold" : "normal",
              fontStyle: el.italic ? "italic" : "normal",
              textDecoration: el.underline ? "underline" : "none",
              fontFamily: el.fontFamily || "Arial",
              color: el.color || "#1e293b",
              textAlign: el.align || "left",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              backgroundColor: el.fill || "transparent",
            }}
          >
            {el.content}
          </div>
        );
      }
      if (el.type === "image" && el.src) {
        return (
          <img
            key={el.id}
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
          <table key={el.id} className="show-table" style={posStyle}>
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

  return (
    <div className="slides-editor">
      {/* Slides Toolbar */}
      <div
        className="slides-toolbar"
        role="toolbar"
        aria-label="Slides toolbar"
      >
        <div className="tool-group">
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
            disabled={historyIndex.current <= 0}
          >
            <Undo2 size={16} />
          </Tool>
          <Tool
            label="Redo (Cmd+Y)"
            onClick={redo}
            disabled={historyIndex.current >= history.current.length - 1}
          >
            <Redo2 size={16} />
          </Tool>
          <Tool label="Print (Cmd+P)" onClick={() => printDocument()}>
            <Printer size={16} />
          </Tool>
        </div>

        <div className="toolbar-divider" />

        <div className="tool-group">
          <Tool
            label="Select tool"
            active={!selectedElementId}
            onClick={() => setSelectedElementId(null)}
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
        {selectedElement ? (
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
                        updateElement(selectedElement.id, {
                          fontSize: val,
                        });
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
                  active={!!selectedElement.bold}
                  onClick={() =>
                    updateElement(selectedElement.id, {
                      bold: !selectedElement.bold,
                    })
                  }
                >
                  <Bold size={16} />
                </Tool>
                <Tool
                  label="Italic"
                  active={!!selectedElement.italic}
                  onClick={() =>
                    updateElement(selectedElement.id, {
                      italic: !selectedElement.italic,
                    })
                  }
                >
                  <Italic size={16} />
                </Tool>
                <Tool
                  label="Underline"
                  active={!!selectedElement.underline}
                  onClick={() =>
                    updateElement(selectedElement.id, {
                      underline: !selectedElement.underline,
                    })
                  }
                >
                  <Underline size={16} />
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

        {/* Google Slides styled Slideshow button */}
        <div className="tool-group right-tools" style={{ marginLeft: "auto" }}>
          <div className="slideshow-split">
            <button
              type="button"
              className="slideshow-btn"
              onClick={() => beginShow(currentSlideIndex)}
              title="Present from current slide (Cmd+Enter)"
            >
              <Play size={14} fill="currentColor" />
              <span>Slideshow</span>
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
                onClick={() => moveSlide("up")}
                disabled={deck.slideOrder.indexOf(activeSlideId) <= 0}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                title="Move slide down"
                onClick={() => moveSlide("down")}
                disabled={
                  deck.slideOrder.indexOf(activeSlideId) >=
                  deck.slideOrder.length - 1
                }
              >
                <ChevronDown size={14} />
              </button>
              <button
                type="button"
                title="Duplicate slide"
                onClick={duplicateCurrentSlide}
              >
                <Copy size={14} />
              </button>
              <button
                type="button"
                title="Delete slide"
                onClick={deleteCurrentSlide}
                disabled={deck.slideOrder.length <= 1}
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
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault();
              const idx = deck.slideOrder.indexOf(activeSlideId);
              const to = e.key === "ArrowUp" ? idx - 1 : idx + 1;
              if (to < 0 || to >= deck.slideOrder.length) return;
              if (e.metaKey || e.ctrlKey) moveSlideTo(idx, to);
              else {
                setActiveSlideId(deck.slideOrder[to]);
                setSelectedIds([deck.slideOrder[to]]);
              }
              setSelectedElementId(null);
            }}
          >
            {deck.slideOrder.map((id, index) => {
              const slide = deck.slides[id];
              const isActive = id === activeSlideId;
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
                  aria-selected={isActive}
                  aria-label={`Slide ${index + 1}${slide?.transition && slide.transition.type !== "none" ? `, ${slide.transition.type} transition` : ""}`}
                  data-selected={selectedIds.includes(id) ? "true" : "false"}
                  className={`thumbnail-row ${isActive ? "selected" : ""} ${selectedIds.includes(id) ? "grouped" : ""} ${slideDrag?.over != null && slideDrag.from === index ? "drag-source" : ""} ${dropClass}`}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    setSlideDrag({ from: index, startY: e.clientY, over: null });
                  }}
                  onClick={(e) => {
                    if (suppressThumbnailClick.current) return;
                    if (e.shiftKey) {
                      const start = Math.min(anchorIndex.current, index);
                      const end = Math.max(anchorIndex.current, index);
                      setSelectedIds(deck.slideOrder.slice(start, end + 1));
                      setTransitionScope("selected");
                    } else {
                      anchorIndex.current = index;
                      setSelectedIds([id]);
                    }
                    setActiveSlideId(id);
                    setSelectedElementId(null);
                  }}
                >
                  <span className="thumbnail-num">{index + 1}</span>
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
                                fontWeight: el.bold ? "bold" : "normal",
                              }}
                            >
                              {el.content}
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
                </div>
              );
            })}
          </div>

          <div className="slides-sidebar-footer">
            <button
              type="button"
              className="add-slide-sidebar-btn"
              onClick={() => addSlide("title-body")}
              title="New slide (Cmd+M)"
            >
              <Plus size={16} /> New slide
            </button>
          </div>
        </aside>

        {/* Center Slide Canvas */}
        <div className="slides-canvas-stage">
          <div
            className="slide-stage-viewport"
            ref={stageRef}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest(".slide-element")) return;
              setSelectedElementId(null);
            }}
          >
            <div
              className={`slide-canvas print-slide${canvasMotion ? ` deck-motion-${canvasMotion.type}` : ""}`}
              style={{
                backgroundColor: shownSlide?.background?.color || "#ffffff",
                aspectRatio: `${deck.width || 960} / ${deck.height || 540}`,
                ["--deck-motion" as string]: `${canvasMotion?.ms ?? 0}ms`,
              }}
            >
              {shownSlide?.elements.map((el) => {
                const isSelected = el.id === selectedElementId;
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
                      className={`slide-element slide-text ${isSelected ? "selected" : ""}`}
                      style={{
                        ...posStyle,
                        fontSize: `${(el.fontSize || 20) * 0.95}px`,
                        fontWeight: el.bold ? "bold" : "normal",
                        fontStyle: el.italic ? "italic" : "normal",
                        textDecoration: el.underline ? "underline" : "none",
                        fontFamily: el.fontFamily || "Arial",
                        color: el.color || "#1e293b",
                        textAlign: el.align || "left",
                        backgroundColor: el.fill || "transparent",
                      }}
                      onMouseDown={(e) => onElementMouseDown(e, el.id)}
                    >
                      <textarea
                        className="element-textarea"
                        value={el.content || ""}
                        placeholder={el.placeholder ?? "Click to add text"}
                        onChange={(e) =>
                          updateElement(el.id, { content: e.target.value })
                        }
                        onFocus={() => setSelectedElementId(el.id)}
                      />
                      {isSelected ? renderHandles(el.id) : null}
                    </div>
                  );
                }

                if (el.type === "image" && el.src) {
                  return (
                    <div
                      key={el.id}
                      className={`slide-element slide-image ${isSelected ? "selected" : ""}`}
                      style={posStyle}
                      onMouseDown={(e) => onElementMouseDown(e, el.id)}
                    >
                      <img src={el.src} alt={el.alt || "Slide asset"} />
                      {isSelected ? renderHandles(el.id) : null}
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
                      className={`slide-element slide-shape ${isSelected ? "selected" : ""}`}
                      style={{
                        ...posStyle,
                        backgroundColor: el.fill || "#e2e8f0",
                        border,
                        borderRadius: rad,
                      }}
                      onMouseDown={(e) => onElementMouseDown(e, el.id)}
                    >
                      {isSelected ? renderHandles(el.id) : null}
                    </div>
                  );
                }

                if (el.type === "table" && el.rows) {
                  return (
                    <div
                      key={el.id}
                      className={`slide-element slide-table ${isSelected ? "selected" : ""}`}
                      style={posStyle}
                      onMouseDown={(e) => onElementMouseDown(e, el.id)}
                    >
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
                      {isSelected ? renderHandles(el.id) : null}
                    </div>
                  );
                }

                return null;
              })}
            </div>
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
                placeholder="Click to add speaker notes"
                value={activeSlide?.notes || ""}
                onChange={(e) => updateSlide({ notes: e.target.value })}
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
            duration={transitionDuration}
            onDuration={(seconds) => {
              setDuration(seconds);
              const ids = transitionTargets();
              if (ids.some((id) => deck.slides[id]?.transition))
                commit(setTransitionDuration(deck, ids, seconds));
            }}
            scope={transitionScope}
            onScope={setTransitionScope}
            selectedCount={selectedIds.length}
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
            onClick={() => {
              setBlankScreen(null);
              setPresentSlideIndex((prev) =>
                Math.min(deck.slideOrder.length - 1, prev + 1),
              );
            }}
          >
            {renderShowElements(presentSlide)}
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
                    <div
                      className="presenter-next-slide show-slide"
                      style={{
                        backgroundColor:
                          nextPresentSlide.background?.color || "#ffffff",
                        aspectRatio: `${deck.width || 960} / ${deck.height || 540}`,
                      }}
                    >
                      {renderShowElements(nextPresentSlide)}
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
              onClick={() =>
                setPresentSlideIndex((prev) => Math.max(0, prev - 1))
              }
              disabled={presentSlideIndex <= 0}
              title="Previous slide (Left arrow)"
            >
              <ChevronLeft size={16} />
              Previous
            </button>
            <span className="presenter-counter">
              Slide {presentSlideIndex + 1} of {deck.slideOrder.length}
            </span>
            <button
              type="button"
              onClick={() =>
                setPresentSlideIndex((prev) =>
                  Math.min(deck.slideOrder.length - 1, prev + 1),
                )
              }
              disabled={presentSlideIndex >= deck.slideOrder.length - 1}
              title="Next slide (Right arrow)"
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
