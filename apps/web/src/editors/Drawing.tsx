import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Circle,
  CodeXml,
  GitCommitHorizontal,
  Minus,
  Pencil,
  Plus,
  Redo2,
  Spline,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { filename, type DrawingFile } from "@suiteleaf/core";
import { Tool, type EditorActions } from "../ui";
import { exportBinary, exportText, printDocument } from "../storage";
import { MarpSplitHandle, useMarpSplit } from "./slide-marp-split";
import { MarpTextarea, scrollMarkdownTo, type MarpDraft } from "./slide-marp-textarea";
import { DrawingCanvas, type DrawingSelection, type DrawingZoom } from "./drawing-canvas";
import { FORMAT_NAME, SOURCE_EXTENSION } from "./drawing-format";
import { renderDrawing, svgToPng } from "./drawing-render";
import {
  appendSvgElement,
  moveSvgElement,
  newShapeMarkup,
  removeSvgElement,
  resizeSvgElement,
  scanSvg,
  setSvgAttributes,
  setSvgText,
  svgAttributes,
  svgElementAt,
  svgText,
  type SvgShape,
} from "./drawing-svg";
import {
  addMermaidNode,
  connectMermaidNodes,
  isFlowchart,
  lineWithText,
  mermaidLabel,
  mermaidNodeLine,
  mermaidNodeOnLine,
  removeMermaidNode,
  renameMermaidNode,
  replaceOnLine,
} from "./drawing-mermaid";
import {
  addDotNode,
  connectDotNodes,
  dotLabel,
  dotNodeLine,
  dotNodeOnLine,
  removeDotNode,
  renameDotNode,
} from "./drawing-dot";
import { lineOf, lineRange } from "./drawing-text";
import "./drawing.css";

type Content = DrawingFile["content"];

const HISTORY_CAP = 200;
/** Changes to one thing this close together undo as one, like dragging a colour picker. */
const MERGE_MS = 1000;
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/** Where a selection is written: an element's start tag, or a node's line. */
export function sourceOffsetFor(content: Content, selection: DrawingSelection): number | null {
  const { format, source } = content;
  if (selection.kind === "element") return scanSvg(source)[selection.index]?.start ?? null;
  const line =
    selection.kind === "text"
      ? lineWithText(source, selection.text)
      : format === "mermaid"
        ? mermaidNodeLine(source, selection.id)
        : dotNodeLine(source, selection.id);
  if (line === null) return null;
  const range = lineRange(source, line);
  return range.start + (/^\s*/.exec(source.slice(range.start, range.end))?.[0].length ?? 0);
}

/** What the caret's line of source draws, if anything. */
export function selectionOnLine(content: Content, line: number): DrawingSelection | null {
  const { format, source } = content;
  if (format === "svg") {
    const range = lineRange(source, line);
    const offset = range.start + (/^\s*/.exec(source.slice(range.start, range.end))?.[0].length ?? 0);
    const index = svgElementAt(source, offset);
    return index ? { kind: "element", index } : null;
  }
  const id = format === "mermaid" ? mermaidNodeOnLine(source, line) : dotNodeOnLine(source, line);
  return id ? { kind: "node", id } : null;
}

/** The text a label editor starts with, or null when the selection has none to edit. */
export function labelOf(content: Content, selection: DrawingSelection): string | null {
  const { format, source } = content;
  if (selection.kind === "element") return svgText(source, selection.index);
  if (selection.kind === "text") return selection.text;
  if (format === "mermaid") return mermaidLabel(source, selection.id);
  const label = dotLabel(source, selection.id);
  return label.html ? null : label.text;
}

/** The source with a selection's label changed, or null when the text cannot be found to change. */
export function relabel(content: Content, selection: DrawingSelection, text: string): string | null {
  const { format, source } = content;
  if (selection.kind === "element") return setSvgText(source, selection.index, text);
  if (selection.kind === "node")
    return format === "mermaid"
      ? renameMermaidNode(source, selection.id, text)
      : renameDotNode(source, selection.id, text);
  const line = lineWithText(source, selection.text);
  if (line === null) return null;
  const next = replaceOnLine(source, line, selection.text, text);
  return next === source && text !== selection.text ? null : next;
}

/** The source without the selected element or node, or null when it cannot be removed. */
export function removeSelection(content: Content, selection: DrawingSelection): string | null {
  const { format, source } = content;
  if (selection.kind === "element") return removeSvgElement(source, selection.index);
  if (selection.kind === "node")
    return format === "mermaid" ? removeMermaidNode(source, selection.id) : removeDotNode(source, selection.id);
  return null;
}

/** A colour for `<input type="color">`, which only takes #rrggbb. */
function hexColor(value: string | undefined, fallback: string) {
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(value ?? "");
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return /^#[\da-f]{6}$/i.test(value ?? "") ? value!.toLowerCase() : fallback;
}

export default function DrawingEditor({
  file,
  readOnly,
  onChange,
  onActions,
  onError,
}: {
  file: DrawingFile;
  readOnly?: boolean;
  onChange: (content: Content) => void;
  onActions: (actions: EditorActions) => void;
  onError: (message: string) => void;
}) {
  const format = file.content.format;
  const [source, setSource] = useState(file.content.source);
  const sourceRef = useRef(source);
  const written = useRef(file.content.source);
  const past = useRef<string[]>([]);
  const future = useRef<string[]>([]);
  const lastMerge = useRef<{ key: string; at: number } | null>(null);
  const [, setHistoryMark] = useState(0);
  const [picture, setPicture] = useState<{ svg: string; raw: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pictureRef = useRef(picture);
  pictureRef.current = picture;
  const [selection, setSelection] = useState<DrawingSelection | null>(null);
  const [editing, setEditing] = useState<DrawingSelection | null>(null);
  const [connecting, setConnecting] = useState<{ from: string | null } | null>(null);
  const [zoom, setZoom] = useState<DrawingZoom>("fit");
  const [scale, setScale] = useState(1);
  const [sourceOpen, setSourceOpen] = useState(true);
  const [split, setSplit] = useMarpSplit("suiteleaf.drawingSplit");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef<MarpDraft | null>(null);
  /** The caret line the canvas last moved the source to, so following it back changes nothing. */
  const syncedLine = useRef<number | null>(null);
  const titleRef = useRef(file.title);
  titleRef.current = file.title;
  const editable = !readOnly;

  useEffect(() => {
    const incoming = file.content.source;
    if (incoming === written.current) return;
    written.current = sourceRef.current = incoming;
    setSource(incoming);
  }, [file.content.source]);

  useEffect(() => {
    let live = true;
    renderDrawing(format, source)
      .then((result) => {
        if (!live) return;
        if (result.error !== undefined) setProblem(result.error);
        else {
          setPicture({ svg: result.svg, raw: result.raw });
          setProblem(null);
        }
      })
      .catch((error) => live && setProblem(error instanceof Error ? error.message : String(error)));
    return () => {
      live = false;
    };
  }, [format, source]);

  const apply = useCallback(
    (next: string) => {
      written.current = sourceRef.current = next;
      setSource(next);
      onChange({ format, source: next });
    },
    [format, onChange],
  );

  /** Change the source, remembering what it was so Undo can bring it back. */
  const write = useCallback(
    (next: string, mergeKey?: string) => {
      const previous = sourceRef.current;
      if (next === previous || readOnly) return;
      const now = Date.now();
      const merging = mergeKey && lastMerge.current?.key === mergeKey && now - lastMerge.current.at < MERGE_MS;
      lastMerge.current = mergeKey ? { key: mergeKey, at: now } : null;
      if (!merging) {
        past.current.push(previous);
        if (past.current.length > HISTORY_CAP) past.current.shift();
      }
      future.current = [];
      apply(next);
      setHistoryMark((mark) => mark + 1);
    },
    [apply, readOnly],
  );

  const step = (from: typeof past, to: typeof future) => {
    draftRef.current?.flush();
    const next = from.current.pop();
    if (next === undefined || readOnly) return;
    to.current.push(sourceRef.current);
    lastMerge.current = null;
    apply(next);
    setEditing(null);
    setHistoryMark((mark) => mark + 1);
  };
  const undo = () => step(past, future);
  const redo = () => step(future, past);

  const content = { format, source };
  const flowchart = format === "graphviz" || (format === "mermaid" && isFlowchart(source));

  /** Put the source's caret where the canvas selection is written, without taking focus. */
  const showInSource = (next: DrawingSelection | null) => {
    const area = areaRef.current;
    if (!next || !area) return;
    const offset = sourceOffsetFor({ format, source: sourceRef.current }, next);
    if (offset === null) return;
    syncedLine.current = lineOf(sourceRef.current, offset);
    area.setSelectionRange(offset, offset);
    scrollMarkdownTo(area, offset);
  };

  // Replacing the text box's value puts its caret at the end, so put it back with the selection.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  useLayoutEffect(() => {
    if (document.activeElement !== areaRef.current) showInSource(selectionRef.current);
    // Only a change of source moves the caret away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const select = (next: DrawingSelection | null) => {
    draftRef.current?.flush();
    setSelection(next);
    showInSource(next);
  };

  const followCaret = (text: string, line: number) => {
    if (syncedLine.current === line) {
      syncedLine.current = null;
      return;
    }
    syncedLine.current = null;
    if (text !== sourceRef.current) return;
    setSelection(selectionOnLine({ format, source: text }, line));
  };

  const addShape = (shape: SvgShape) => {
    draftRef.current?.flush();
    const added = appendSvgElement(sourceRef.current, newShapeMarkup(sourceRef.current, shape));
    if (added.index < 0) return onError("Add shapes inside the <svg> element.");
    write(added.source);
    const next = { kind: "element", index: added.index } as const;
    setSelection(next);
    if (shape === "text") setEditing(next);
  };

  const addNode = () => {
    draftRef.current?.flush();
    const added =
      format === "mermaid" ? addMermaidNode(sourceRef.current) : addDotNode(sourceRef.current);
    write(added.source);
    const next = { kind: "node", id: added.id } as const;
    setSelection(next);
    setEditing(next);
  };

  const pickNode = (id: string) => {
    if (!connecting) return;
    if (!connecting.from) {
      setConnecting({ from: id });
      setSelection({ kind: "node", id });
      return;
    }
    const join = format === "mermaid" ? connectMermaidNodes : connectDotNodes;
    write(join(sourceRef.current, connecting.from, id));
    setConnecting(null);
    setSelection({ kind: "node", id });
  };

  const remove = () => {
    if (!selection || readOnly) return;
    draftRef.current?.flush();
    const next = removeSelection({ format, source: sourceRef.current }, selection);
    if (next === null) return;
    write(next);
    setSelection(null);
  };

  const finishEdit = (text: string | null) => {
    const target = editing;
    setEditing(null);
    if (text === null || !target) return;
    const next = relabel({ format, source: sourceRef.current }, target, text);
    if (next === null) return onError("That text is written differently in the source. Change it there instead.");
    write(next);
    if (target.kind === "text") setSelection({ kind: "text", text: text.replace(/\s+/g, " ").trim() });
  };

  const selectedTag =
    format === "svg" && selection?.kind === "element" ? scanSvg(source)[selection.index] : undefined;
  const selectedAttrs = selectedTag ? svgAttributes(source, selectedTag) : null;
  const paint = (name: "fill" | "stroke", value: string) => {
    if (selection?.kind !== "element") return;
    write(setSvgAttributes(sourceRef.current, selection.index, { [name]: value }), `${name}:${selection.index}`);
  };

  const onCanvasKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (event.key === "Escape") {
      setConnecting(null);
      setSelection(null);
      return;
    }
    if (!selection || readOnly || problem) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      remove();
    } else if (event.key === "Enter" || event.key === "F2") {
      if (labelOf(content, selection) === null) return;
      event.preventDefault();
      setEditing(selection);
    } else if (selection.kind === "element" && event.key.startsWith("Arrow")) {
      event.preventDefault();
      const distance = event.shiftKey ? 10 : 1;
      const dx = event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0;
      const dy = event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0;
      write(moveSvgElement(sourceRef.current, selection.index, dx, dy), `nudge:${selection.index}`);
    }
  };

  useEffect(() => {
    const name = (extension: string) => filename(titleRef.current, extension);
    onActions({
      flush: async () => draftRef.current?.flush(),
      export: async (kind) => {
        draftRef.current?.flush();
        const text = sourceRef.current;
        if (kind === SOURCE_EXTENSION[format])
          return exportText(name(kind), text, format === "svg" ? "image/svg+xml" : "text/plain");
        const rendered = pictureRef.current?.raw;
        if (!rendered) throw new Error("Fix the drawing's source before exporting a picture of it.");
        if (kind === "svg") return exportText(name("svg"), rendered, "image/svg+xml");
        if (kind === "png") return exportBinary(name("png"), await svgToPng(rendered), "image/png");
        throw new Error(`Drawings cannot be exported as .${kind}.`);
      },
      print: async () => {
        draftRef.current?.flush();
        await printDocument(titleRef.current);
      },
    });
  }, [onActions, format]);

  const canEditSelection = editable && !problem && !!selection;
  const zoomBy = (direction: 1 | -1) => {
    const steps = direction > 0 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse();
    setZoom(steps.find((s) => (direction > 0 ? s > scale + 0.001 : s < scale - 0.001)) ?? steps.at(-1)!);
  };

  return (
    <div className="drawing-editor">
      <div className="slides-toolbar drawing-toolbar" role="toolbar" aria-label="Drawing toolbar">
        <span className="drawing-format" title={`This drawing is ${FORMAT_NAME[format]} source`}>
          {FORMAT_NAME[format]}
        </span>
        <div className="toolbar-divider" />
        <fieldset className="toolbar-edits" disabled={readOnly}>
          <Tool label="Undo (Cmd+Z)" onClick={undo} disabled={!past.current.length}>
            <Undo2 size={16} />
          </Tool>
          <Tool label="Redo (Cmd+Shift+Z)" onClick={redo} disabled={!future.current.length}>
            <Redo2 size={16} />
          </Tool>
          <div className="toolbar-divider" />
          {format === "svg" ? (
            <>
              <Tool label="Add rectangle" onClick={() => addShape("rect")} disabled={!!problem}>
                <Square size={16} />
              </Tool>
              <Tool label="Add ellipse" onClick={() => addShape("ellipse")} disabled={!!problem}>
                <Circle size={16} />
              </Tool>
              <Tool label="Add line" onClick={() => addShape("line")} disabled={!!problem}>
                <Minus size={16} />
              </Tool>
              <Tool label="Add text" onClick={() => addShape("text")} disabled={!!problem}>
                <Type size={16} />
              </Tool>
              <div className="toolbar-divider" />
              <label className="drawing-color" title="Fill colour">
                <span>Fill</span>
                <input
                  type="color"
                  aria-label="Fill colour"
                  disabled={!canEditSelection || !selectedAttrs}
                  value={hexColor(selectedAttrs?.fill, "#000000")}
                  onChange={(event) => paint("fill", event.target.value)}
                />
              </label>
              <label className="drawing-color" title="Line colour">
                <span>Line</span>
                <input
                  type="color"
                  aria-label="Line colour"
                  disabled={!canEditSelection || !selectedAttrs}
                  value={hexColor(selectedAttrs?.stroke, "#000000")}
                  onChange={(event) => paint("stroke", event.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <Tool
                label="Add node"
                onClick={addNode}
                disabled={!flowchart || !!problem}
              >
                <Plus size={16} />
                <span className="tool-words">Node</span>
              </Tool>
              <Tool
                label={connecting ? "Stop connecting" : "Connect two nodes"}
                active={!!connecting}
                onClick={() => {
                  setEditing(null);
                  setConnecting((was) => (was ? null : { from: null }));
                }}
                disabled={!flowchart || !!problem}
              >
                <Spline size={16} />
                <span className="tool-words">Connect</span>
              </Tool>
            </>
          )}
          <Tool
            label="Edit label (Enter)"
            onClick={() => selection && setEditing(selection)}
            disabled={!canEditSelection || !selection || labelOf(content, selection) === null}
          >
            <Pencil size={16} />
          </Tool>
          <Tool label="Delete (Delete)" onClick={remove} disabled={!canEditSelection || selection?.kind === "text"}>
            <Trash2 size={16} />
          </Tool>
        </fieldset>
        <div className="toolbar-divider" />
        <Tool label="Zoom out" onClick={() => zoomBy(-1)}>
          <Minus size={16} />
        </Tool>
        <button
          type="button"
          className={`tool drawing-zoom${zoom === "fit" ? " active" : ""}`}
          title="Fit the drawing to the pane"
          aria-pressed={zoom === "fit"}
          onClick={() => setZoom("fit")}
        >
          {Math.round(scale * 100)}%
        </button>
        <Tool label="Zoom in" onClick={() => zoomBy(1)}>
          <Plus size={16} />
        </Tool>
        <div className="toolbar-divider" />
        <Tool
          label={sourceOpen ? "Hide the source" : "Show the source beside the drawing"}
          active={sourceOpen}
          onClick={() => setSourceOpen((open) => !open)}
        >
          <CodeXml size={16} />
          <span className="tool-words">Source</span>
        </Tool>
      </div>
      <div
        className="drawing-row"
        style={sourceOpen ? { ["--marp-split" as string]: split } : undefined}
      >
        <div className="drawing-canvas-pane">
          {problem ? (
            <div className="drawing-problem" role="alert">
              <strong>
                {picture ? "The source has a problem, so the drawing shows its last good version." : "The source has a problem."}
              </strong>
              <p>{problem}</p>
            </div>
          ) : null}
          {connecting ? (
            <p className="drawing-hint" role="status">
              <GitCommitHorizontal size={14} aria-hidden="true" />
              {connecting.from ? `Now click the node to connect “${connecting.from}” to.` : "Click the node to connect from."}
            </p>
          ) : null}
          <DrawingCanvas
            svg={picture?.svg ?? null}
            format={format}
            selection={selection}
            stale={!!problem}
            readOnly={!editable}
            zoom={zoom}
            connecting={!!connecting}
            editing={editing}
            labelFor={(target) => labelOf({ format, source: sourceRef.current }, target)}
            onSelect={select}
            onPickNode={pickNode}
            onMove={(index, dx, dy) => write(moveSvgElement(sourceRef.current, index, dx, dy))}
            onResize={(index, dx, dy) => write(resizeSvgElement(sourceRef.current, index, dx, dy))}
            onStartEdit={(target) => {
              setSelection(target);
              setEditing(target);
            }}
            onFinishEdit={finishEdit}
            onScale={setScale}
            onKeyDown={onCanvasKey}
          />
        </div>
        {sourceOpen ? (
          <>
            <MarpSplitHandle split={split} onSplit={setSplit} panes={["Drawing", "source"]} />
            <aside className="drawing-source-pane" aria-label="Source">
              <MarpTextarea
                source={source}
                readOnly={!editable}
                invalid={!!problem}
                onCommit={(text) => write(text)}
                areaRef={areaRef}
                draftRef={draftRef}
                onCaretLine={followCaret}
                label={`${FORMAT_NAME[format]} source`}
              />
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}
