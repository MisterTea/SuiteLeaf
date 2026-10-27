import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { DrawingFormat } from "@suiteleaf/core";
import { INDEX_ATTRIBUTE, naturalSize } from "./drawing-render";
import { canResize, movedAttributes, resizedAttributes } from "./drawing-svg";

/** What is picked on the canvas: an SVG element by its place in the source, a diagram node, or a piece of diagram text. */
export type DrawingSelection =
  | { kind: "element"; index: number }
  | { kind: "node"; id: string }
  | { kind: "text"; text: string };

export type DrawingZoom = number | "fit";

const PAPER_MARGIN = 24;
/** Fitting a small diagram to the pane stops at this, so a two-node graph is not drawn huge. */
const MAX_FIT = 2;
const DRAG_START_PX = 3;

const SHADOW_CSS = `
:host { display: block; }
svg { display: block; overflow: visible; max-width: none !important; }
:host(.editable.svg) [${INDEX_ATTRIBUTE}]:not([${INDEX_ATTRIBUTE}="0"]) { cursor: move; }
:host(.nodes) g.node { cursor: pointer; }
:host(.connecting) g.node { cursor: crosshair; }
`;

const squash = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/** The node a Mermaid element draws, from `data-id` or an id like `flowchart-A-3`. */
function mermaidNodeId(node: Element) {
  const data = node.getAttribute("data-id");
  if (data) return data;
  return /flowchart-(.+)-\d+$/.exec(node.id)?.[1] ?? null;
}

function pick(target: Element, format: DrawingFormat, deep: boolean): DrawingSelection | null {
  if (format === "svg") {
    let element = target.closest(`[${INDEX_ATTRIBUTE}]`);
    if (!element || element.getAttribute(INDEX_ATTRIBUTE) === "0") return null;
    // A click takes the whole top-level shape or group; Alt+click the element itself.
    while (!deep) {
      const parent: Element | null | undefined = element.parentElement?.closest(`[${INDEX_ATTRIBUTE}]`);
      if (!parent || parent.getAttribute(INDEX_ATTRIBUTE) === "0") break;
      element = parent;
    }
    return { kind: "element", index: Number(element.getAttribute(INDEX_ATTRIBUTE)) };
  }
  const node = target.closest("g.node");
  if (node) {
    const id = format === "graphviz" ? node.querySelector(":scope > title")?.textContent : mermaidNodeId(node);
    if (id) return { kind: "node", id };
  }
  const text = squash(target.closest("text")?.textContent);
  return text ? { kind: "text", text } : null;
}

function find(root: ParentNode, format: DrawingFormat, selection: DrawingSelection): Element | null {
  if (selection.kind === "element") return root.querySelector(`[${INDEX_ATTRIBUTE}="${selection.index}"]`);
  if (selection.kind === "node")
    return (
      [...root.querySelectorAll("g.node")].find((node) =>
        format === "graphviz"
          ? node.querySelector(":scope > title")?.textContent === selection.id
          : mermaidNodeId(node) === selection.id,
      ) ?? null
    );
  return [...root.querySelectorAll("text")].find((t) => squash(t.textContent) === selection.text) ?? null;
}

/** A point on screen in an element's own units, or in screen pixels where layout is unknown. */
function pointIn(element: Element | null, x: number, y: number, scale: number) {
  const matrix = (element as SVGGraphicsElement | null)?.getScreenCTM?.();
  if (!matrix) return { x: x / scale, y: y / scale };
  const point = new DOMPoint(x, y).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

function attributesOf(element: Element) {
  const attrs: Record<string, string> = {};
  for (const attr of element.attributes) if (attr.name !== INDEX_ATTRIBUTE) attrs[attr.name] = attr.value;
  return attrs;
}

type Drag = {
  mode: "move" | "resize";
  element: Element;
  index: number;
  attrs: Record<string, string>;
  /** The element whose units the drag is measured in. */
  frame: Element | null;
  start: { x: number; y: number };
  screen: { x: number; y: number };
  delta: { x: number; y: number };
  moved: boolean;
};

export function DrawingCanvas({
  svg,
  format,
  selection,
  stale,
  readOnly,
  zoom,
  connecting,
  editing,
  labelFor,
  onSelect,
  onPickNode,
  onMove,
  onResize,
  onStartEdit,
  onFinishEdit,
  onScale,
  onKeyDown,
}: {
  svg: string | null;
  format: DrawingFormat;
  selection: DrawingSelection | null;
  /** The picture is from before the source went wrong, so it cannot be edited. */
  stale: boolean;
  readOnly: boolean;
  zoom: DrawingZoom;
  /** Picking nodes to join rather than selecting. */
  connecting: boolean;
  /** Whose label is being typed over the canvas. */
  editing: DrawingSelection | null;
  labelFor: (selection: DrawingSelection) => string | null;
  onSelect: (selection: DrawingSelection | null) => void;
  onPickNode: (id: string) => void;
  onMove: (index: number, dx: number, dy: number) => void;
  onResize: (index: number, dx: number, dy: number) => void;
  onStartEdit: (selection: DrawingSelection) => void;
  onFinishEdit: (text: string | null) => void;
  onScale: (scale: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [natural, setNatural] = useState({ width: 300, height: 150 });
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [resizable, setResizable] = useState(false);

  const root = useCallback(() => {
    const host = hostRef.current;
    if (!host) return null;
    return host.shadowRoot ?? host.attachShadow({ mode: "open" });
  }, []);

  const fit =
    stage.width > 0 && stage.height > 0
      ? Math.min(
          (stage.width - PAPER_MARGIN * 2) / natural.width,
          (stage.height - PAPER_MARGIN * 2) / natural.height,
          MAX_FIT,
        )
      : 1;
  const scale = Math.max(0.05, zoom === "fit" ? fit : zoom);

  useEffect(() => onScale(scale), [onScale, scale]);

  useLayoutEffect(() => {
    const stageElement = stageRef.current;
    if (!stageElement) return;
    const measure = () => setStage({ width: stageElement.clientWidth, height: stageElement.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(stageElement);
    return () => observer.disconnect();
  }, []);

  const paint = useCallback(() => {
    const shadow = root();
    if (!shadow) return;
    shadow.innerHTML = `<style>${SHADOW_CSS}</style>${svg ?? ""}`;
    const picture = shadow.querySelector("svg");
    if (!picture) return;
    const size = naturalSize(picture);
    // Without a view box, a picture would be cropped rather than scaled.
    if (!picture.getAttribute("viewBox")) picture.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    setNatural((was) => (was.width === size.width && was.height === size.height ? was : size));
  }, [root, svg]);

  useLayoutEffect(paint, [paint]);

  const measure = useCallback(() => {
    const shadow = root();
    const paper = paperRef.current;
    const element = shadow && selection ? find(shadow, format, selection) : null;
    if (!element || !paper) {
      setBox(null);
      return;
    }
    const outer = paper.getBoundingClientRect();
    const inner = element.getBoundingClientRect();
    setBox({ left: inner.left - outer.left, top: inner.top - outer.top, width: inner.width, height: inner.height });
    setResizable(
      format === "svg" && !readOnly && !stale && canResize(element.localName, attributesOf(element)),
    );
  }, [root, selection, format, readOnly, stale]);

  useLayoutEffect(() => {
    const picture = root()?.querySelector("svg");
    if (picture) {
      picture.style.width = `${natural.width * scale}px`;
      picture.style.height = `${natural.height * scale}px`;
    }
    measure();
  }, [root, svg, natural, scale, measure]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.classList.toggle("editable", !readOnly && !stale);
    host.classList.toggle("svg", format === "svg");
    host.classList.toggle("nodes", format !== "svg");
    host.classList.toggle("connecting", connecting);
  }, [readOnly, stale, format, connecting]);

  const startDrag = (mode: Drag["mode"], event: PointerEvent<HTMLElement>, index: number) => {
    const shadow = root();
    const element = shadow?.querySelector(`[${INDEX_ATTRIBUTE}="${index}"]`);
    if (!element) return;
    const frame = mode === "move" ? element.parentElement : element;
    drag.current = {
      mode,
      element,
      index,
      attrs: attributesOf(element),
      frame,
      start: pointIn(frame, event.clientX, event.clientY, scale),
      screen: { x: event.clientX, y: event.clientY },
      delta: { x: 0, y: 0 },
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const editable = !readOnly && !stale;

  return (
    <div
      ref={stageRef}
      className={`drawing-stage${stale ? " stale" : ""}`}
      tabIndex={0}
      role="application"
      aria-label="Drawing canvas"
      aria-roledescription="drawing"
      onKeyDown={onKeyDown}
    >
      <div
        ref={paperRef}
        className="drawing-paper"
        onPointerDown={(event) => {
          if (event.button !== 0 || editing || stale) return;
          stageRef.current?.focus({ preventScroll: true });
          const target = event.nativeEvent.composedPath()[0];
          if (!(target instanceof Element)) return;
          const picked = pick(target, format, event.altKey);
          if (connecting) {
            if (picked?.kind === "node") onPickNode(picked.id);
            return;
          }
          onSelect(picked);
          if (picked?.kind === "element" && editable) startDrag("move", event, picked.index);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current) return;
          if (
            !current.moved &&
            Math.hypot(event.clientX - current.screen.x, event.clientY - current.screen.y) < DRAG_START_PX
          )
            return;
          current.moved = true;
          const point = pointIn(current.frame, event.clientX, event.clientY, scale);
          current.delta = { x: point.x - current.start.x, y: point.y - current.start.y };
          const preview = (current.mode === "move" ? movedAttributes : resizedAttributes)(
            current.element.localName,
            current.attrs,
            current.delta.x,
            current.delta.y,
          );
          for (const [name, value] of Object.entries(preview)) current.element.setAttribute(name, value);
          measure();
        }}
        onPointerUp={() => {
          const current = drag.current;
          drag.current = null;
          if (!current?.moved) return;
          const { x, y } = current.delta;
          if (current.mode === "move") onMove(current.index, x, y);
          else onResize(current.index, x, y);
        }}
        onPointerCancel={() => {
          if (!drag.current) return;
          drag.current = null;
          paint();
        }}
        onDoubleClick={(event) => {
          if (stale || readOnly || connecting) return;
          const target = event.nativeEvent.composedPath()[0];
          if (!(target instanceof Element)) return;
          const picked = pick(target, format, true);
          if (picked && labelFor(picked) !== null) onStartEdit(picked);
        }}
      >
        <div ref={hostRef} className="drawing-host" />
        {box ? (
          <div
            className="drawing-selection"
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          >
            {resizable && selection?.kind === "element" ? (
              <div
                className="drawing-resize-handle"
                role="presentation"
                title="Drag to resize"
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.stopPropagation();
                  startDrag("resize", event, selection.index);
                }}
              />
            ) : null}
          </div>
        ) : null}
        {editing && box ? (
          <LabelEditor
            key={JSON.stringify(editing)}
            initial={labelFor(editing) ?? ""}
            box={box}
            onDone={onFinishEdit}
          />
        ) : null}
      </div>
    </div>
  );
}

function LabelEditor({
  initial,
  box,
  onDone,
}: {
  initial: string;
  box: { left: number; top: number; width: number; height: number };
  onDone: (text: string | null) => void;
}) {
  const done = useRef(false);
  const finish = (text: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  return (
    <input
      className="drawing-label-editor"
      aria-label="Label"
      autoFocus
      defaultValue={initial}
      style={{ left: box.left, top: box.top + box.height / 2, minWidth: Math.max(140, box.width) }}
      onFocus={(event) => event.currentTarget.select()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(event.currentTarget.value);
        if (event.key === "Escape") finish(null);
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  );
}
