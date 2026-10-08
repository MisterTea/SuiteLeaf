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
  Search,
  Grid,
} from "lucide-react";
import {
  filename,
  type SlideFile,
  type Slide,
  type SlideElement,
} from "@suiteleaf/core";
import { exportText, printDocument } from "../storage";
import { Menu, MenuItem, Tool, type EditorActions } from "../ui";

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
  const addSlide = (layout: Slide["layout"] = "title-body") => {
    const newId = crypto.randomUUID();
    const newSlide: Slide = {
      id: newId,
      title: layout === "blank" ? "Untitled slide" : "Slide Title",
      layout,
      elements: [],
      notes: "",
    };

    if (layout === "title") {
      newSlide.elements.push(
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 100,
          y: 160,
          width: 760,
          height: 100,
          content: "Presentation Title",
          fontSize: 44,
          bold: true,
          align: "center",
          color: "#0f172a",
        },
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 100,
          y: 280,
          width: 760,
          height: 60,
          content: "Click to add subtitle",
          fontSize: 22,
          align: "center",
          color: "#64748b",
        },
      );
    } else if (layout === "title-body") {
      newSlide.elements.push(
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 80,
          y: 50,
          width: 800,
          height: 70,
          content: "Slide Title",
          fontSize: 34,
          bold: true,
          align: "left",
          color: "#0f172a",
        },
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 80,
          y: 150,
          width: 800,
          height: 320,
          content: "• First key point\n• Second key point\n• Third key point",
          fontSize: 20,
          bullet: true,
          align: "left",
          color: "#334155",
        },
      );
    } else if (layout === "two-column") {
      newSlide.elements.push(
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 80,
          y: 50,
          width: 800,
          height: 70,
          content: "Comparison Title",
          fontSize: 34,
          bold: true,
          align: "left",
          color: "#0f172a",
        },
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 80,
          y: 150,
          width: 380,
          height: 320,
          content: "Column 1 Details\n• Point A\n• Point B",
          fontSize: 18,
          align: "left",
          color: "#334155",
        },
        {
          id: crypto.randomUUID(),
          type: "text",
          x: 500,
          y: 150,
          width: 380,
          height: 320,
          content: "Column 2 Details\n• Point C\n• Point D",
          fontSize: 18,
          align: "left",
          color: "#334155",
        },
      );
    } else if (layout === "section") {
      newSlide.background = { color: "#1e293b" };
      newSlide.elements.push({
        id: crypto.randomUUID(),
        type: "text",
        x: 100,
        y: 200,
        width: 760,
        height: 120,
        content: "Section Header",
        fontSize: 46,
        bold: true,
        align: "center",
        color: "#f8fafc",
      });
    }

    const currentIdx = deck.slideOrder.indexOf(activeSlideId);
    const newOrder = [...deck.slideOrder];
    newOrder.splice(currentIdx + 1, 0, newId);

    const updated = {
      ...deck,
      slideOrder: newOrder,
      slides: { ...deck.slides, [newId]: newSlide },
    };
    commit(updated);
    setActiveSlideId(newId);
    setSelectedElementId(null);
  };

  // Duplicate slide
  const duplicateCurrentSlide = () => {
    if (!activeSlide) return;
    const newId = crypto.randomUUID();
    const clonedSlide: Slide = structuredClone(activeSlide);
    clonedSlide.id = newId;
    clonedSlide.title = `${activeSlide.title || "Slide"} (copy)`;
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

    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    const newOrder = [...deck.slideOrder];
    const [moved] = newOrder.splice(idx, 1);
    newOrder.splice(targetIdx, 0, moved);

    commit({ ...deck, slideOrder: newOrder });
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
      content: "Click to edit text",
      fontSize: 22,
      fontFamily: "Arial",
      color: "#1e293b",
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
      x: 150,
      y: 150,
      width: 220,
      height: 140,
      shapeType,
      fill: "#e2e8f0",
      stroke: "#94a3b8",
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
      lines.push(`--- Slide ${i + 1}: ${s.title || "Untitled"} ---`);
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

  // Wire editor actions for workspace header
  useEffect(() => {
    onActions({
      flush: async () => onChange(deckRef.current),
      export: async (format: string) => {
        if (format === "html") await exportHtmlRef.current();
        else await exportTxtRef.current();
      },
      print: async () => printDocument(),
      present: () => {
        const currentIdx = Math.max(
          0,
          deckRef.current.slideOrder.indexOf(activeSlideId),
        );
        setPresentSlideIndex(currentIdx);
        setPresenting(true);
      },
    });
  }, [onActions, onChange, activeSlideId]);

  const [controlsVisible, setControlsVisible] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keyboard navigation and auto-hiding controls for presentation mode
  useEffect(() => {
    if (!presenting) return;
    const onKeyDown = (e: KeyboardEvent) => {
      setControlsVisible(true);
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        setPresentSlideIndex((prev) =>
          Math.min(deck.slideOrder.length - 1, prev + 1),
        );
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setPresentSlideIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "Escape") {
        setPresenting(false);
      }
    };

    const onMouseMove = () => {
      setControlsVisible(true);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 2500);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [presenting, deck.slideOrder.length]);

  // Start presenting
  const startPresenting = () => {
    const currentIdx = Math.max(0, deck.slideOrder.indexOf(activeSlideId));
    setPresentSlideIndex(currentIdx);
    setPresenting(true);
  };

  const presentSlide =
    deck.slides[deck.slideOrder[presentSlideIndex]] || activeSlide;

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
      <div className="rotation-stem" />
      <div className="rotation-handle" title="Rotate" />
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
        <button
          type="button"
          className="menu-search-pill"
          title="Search the menus (Option+/)"
          onClick={() => {}}
        >
          <Search size={14} className="menu-search-icon" />
          <span>Menus</span>
        </button>

        <div className="tool-group">
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
          <select className="toolbar-select zoom-select" aria-label="Zoom" defaultValue="Fit">
            <option value="Fit">Fit</option>
            <option value="50%">50%</option>
            <option value="100%">100%</option>
          </select>
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
          <Tool label="Line" onClick={() => {}}>
            <Minus size={16} />
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
                { label: "Blue", val: "#d2e3fc" },
                { label: "Green", val: "#ceead6" },
                { label: "Yellow", val: "#feefc3" },
                { label: "Red", val: "#fad2cf" },
              ].map((c) => (
                <MenuItem
                  key={c.val}
                  onSelect={() =>
                    updateElement(selectedElement.id, { fill: c.val })
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
                    updateElement(selectedElement.id, {
                      stroke: c.val,
                      strokeWidth: 2,
                    })
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
                    updateElement(selectedElement.id, {
                      fontFamily: e.target.value,
                    })
                  }
                >
                  <option value="Arial">Arial</option>
                  <option value="Roboto">Roboto</option>
                  <option value="Helvetica">Helvetica</option>
                  <option value="Georgia">Georgia</option>
                  <option value="Times New Roman">Times New Roman</option>
                  <option value="Courier New">Courier New</option>
                  <option value="Trebuchet MS">Trebuchet MS</option>
                </select>

                <div className="font-size-stepper">
                  <button
                    type="button"
                    className="stepper-btn"
                    title="Decrease font size"
                    aria-label="Decrease font size"
                    onClick={() =>
                      updateElement(selectedElement.id, {
                        fontSize: Math.max(6, (selectedElement.fontSize || 20) - 1),
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
                        fontSize: Math.min(96, (selectedElement.fontSize || 20) + 1),
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
                    updateSlide({ background: { color: color.val } })
                  }
                >
                  <span
                    className="menu-color-swatch"
                    style={{ backgroundColor: color.val }}
                  />
                  {color.label}
                </MenuItem>
              ))}
            </Menu>

            <Menu label="Layout">
              <MenuItem onSelect={() => updateSlide({ layout: "title" })}>
                Title slide
              </MenuItem>
              <MenuItem onSelect={() => updateSlide({ layout: "title-body" })}>
                Title & body
              </MenuItem>
              <MenuItem onSelect={() => updateSlide({ layout: "two-column" })}>
                Two columns
              </MenuItem>
              <MenuItem onSelect={() => updateSlide({ layout: "section" })}>
                Section header
              </MenuItem>
              <MenuItem onSelect={() => updateSlide({ layout: "blank" })}>
                Blank slide
              </MenuItem>
            </Menu>

            <Menu label="Theme">
              <MenuItem
                onSelect={() =>
                  updateSlide({ background: { color: "#ffffff" } })
                }
              >
                Simple Light
              </MenuItem>
              <MenuItem
                onSelect={() =>
                  updateSlide({ background: { color: "#f8fafc" } })
                }
              >
                Streamline
              </MenuItem>
              <MenuItem
                onSelect={() =>
                  updateSlide({ background: { color: "#0f172a" } })
                }
              >
                Focus (Dark)
              </MenuItem>
              <MenuItem
                onSelect={() =>
                  updateSlide({ background: { color: "#fef3c7" } })
                }
              >
                Warm Sand
              </MenuItem>
            </Menu>

            <button
              type="button"
              className="toolbar-text-btn"
              onClick={() => {}}
            >
              Transition
            </button>
          </div>
        )}

        {/* Google Slides styled Slideshow button */}
        <div className="tool-group right-tools" style={{ marginLeft: "auto" }}>
          <button
            type="button"
            className="slideshow-btn"
            aria-label="Present"
            onClick={startPresenting}
            title="Slideshow (Cmd+Enter)"
          >
            <Play size={14} fill="currentColor" />
            <span>Slideshow</span>
            <ChevronDown size={12} />
          </button>
        </div>
      </div>

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

          <div className="thumbnails-list">
            {deck.slideOrder.map((id, index) => {
              const slide = deck.slides[id];
              const isActive = id === activeSlideId;
              const bg = slide?.background?.color || "#ffffff";

              return (
                <div
                  key={id}
                  className={`thumbnail-row ${isActive ? "selected" : ""}`}
                  onClick={() => {
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
            <button
              type="button"
              className="grid-view-btn"
              title="Grid view"
              aria-label="Grid view"
            >
              <Grid size={15} />
            </button>
          </div>
        </aside>

        {/* Center Slide Canvas */}
        <div className="slides-canvas-stage">
          <div
            className="slide-stage-viewport"
            ref={stageRef}
            onClick={() => setSelectedElementId(null)}
          >
            <div
              className="slide-canvas print-slide"
              style={{
                backgroundColor: activeSlide?.background?.color || "#ffffff",
                aspectRatio: `${deck.width || 960} / ${deck.height || 540}`,
              }}
            >
              {activeSlide?.elements.map((el) => {
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
                        placeholder="Click to type text..."
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
      </div>

      {/* Presentation Fullscreen Mode Modal */}
      {presenting ? (
        <div className="presenter-overlay" role="dialog" aria-modal="true">
          <div
            className="presenter-slide-box"
            style={{
              backgroundColor: presentSlide?.background?.color || "#ffffff",
              aspectRatio: `${deck.width || 960} / ${deck.height || 540}`,
            }}
          >
            {presentSlide?.elements.map((el) => {
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
                    style={{
                      ...posStyle,
                      fontSize: `${(el.fontSize || 20) * 1.5}px`,
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
                  ? `${el.strokeWidth || 1}px solid ${el.stroke}`
                  : "none";
                const rad =
                  el.shapeType === "ellipse"
                    ? "50%"
                    : el.shapeType === "roundRect"
                      ? "16px"
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
              return null;
            })}
          </div>

          {/* Presenter bottom floating controls */}
          <div
            className={`presenter-controls ${controlsVisible ? "visible" : "hidden"}`}
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
              className="exit-present-btn"
              onClick={() => setPresenting(false)}
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
