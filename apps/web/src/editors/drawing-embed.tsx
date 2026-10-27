import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, PenTool } from "lucide-react";
import type { DrawingFile } from "@suiteleaf/core";
import type { EditorActions } from "../ui";
import DrawingEditor from "./Drawing";
import { createDrawingFile } from "./drawing-format";
import { prepareSvg } from "./drawing-render";

/**
 * Drawing, opened on a picture inside another file. Nothing here is saved or
 * versioned: the picture's new SVG goes back to the file it came from when
 * the person leaves, and that file records the change.
 */
export default function EmbeddedDrawing({
  svg,
  name,
  parentTitle,
  readOnly,
  onClose,
}: {
  svg: string;
  /** The picture's own file, such as a MARP deck's `media/logo.svg`. */
  name?: string;
  parentTitle: string;
  readOnly: boolean;
  /** The new SVG, or null when the picture did not change. */
  onClose: (svg: string | null) => void;
}) {
  const label = `${name ?? "Picture"} in ${parentTitle}`;
  const [file] = useState<DrawingFile>(() => createDrawingFile("svg", label, svg));
  const latest = useRef(svg);
  const actions = useRef<EditorActions | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState("");
  const [broken, setBroken] = useState<string | null>(null);
  const takeActions = useCallback((next: EditorActions) => {
    actions.current = next;
  }, []);

  useEffect(() => {
    // Keys typed outside this layer would reach the file underneath, which is hidden.
    const guard = (event: KeyboardEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) event.stopPropagation();
    };
    window.addEventListener("keydown", guard, true);
    return () => window.removeEventListener("keydown", guard, true);
  }, []);

  useEffect(() => {
    if (!changed) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [changed]);

  const leave = async () => {
    await actions.current?.flush();
    const next = latest.current;
    if (readOnly || next === svg) return onClose(null);
    const problem = prepareSvg(next).error;
    if (problem) return setBroken(problem);
    onClose(next);
  };

  return createPortal(
    <div
      ref={root}
      className="drawing-embed"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-own-shortcuts=""
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="drawing-embed-header">
        <button
          type="button"
          className="drawing-embed-back"
          aria-label={`Back to ${parentTitle}`}
          title={`Back to ${parentTitle}`}
          autoFocus
          onClick={() => void leave()}
        >
          <ArrowLeft size={20} />
        </button>
        <span className="file-icon drawing" aria-hidden="true">
          <PenTool size={22} />
        </span>
        <div className="drawing-embed-title">
          <strong>
            {name ?? "Picture"} in “{parentTitle}”
          </strong>
          <small role="status">
            {readOnly
              ? "View only"
              : changed
                ? `Your changes go into “${parentTitle}” when you go back.`
                : `Edit the picture, then go back to “${parentTitle}”.`}
          </small>
        </div>
      </header>
      {error ? (
        <div className="drawing-embed-notice" role="alert">
          {error}
          <button type="button" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      ) : null}
      {broken ? (
        <div className="drawing-embed-notice" role="alert">
          <span>
            The SVG has a problem, so it cannot go back into “{parentTitle}”: {broken}
          </span>
          <button type="button" onClick={() => setBroken(null)}>
            Keep editing
          </button>
          <button type="button" onClick={() => onClose(null)}>
            Go back without changing the picture
          </button>
        </div>
      ) : null}
      <DrawingEditor
        file={file}
        readOnly={readOnly}
        onChange={(content) => {
          latest.current = content.source;
          setChanged(content.source !== svg);
          setBroken(null);
        }}
        onActions={takeActions}
        onError={setError}
      />
    </div>,
    document.body,
  );
}
