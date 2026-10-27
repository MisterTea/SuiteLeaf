import type { ReactNode } from "react";
import { PenTool } from "lucide-react";
import { createFile, DRAWING_FORMATS, type DrawingFormat, type SuiteFile } from "@suiteleaf/core";
import { createDrawingFile, FORMAT_NAME } from "./editors/drawing-format";
import { createMarpFile } from "./editors/slide-marp";
import "./drawing-home.css";

/** What a "New" card or menu item makes. */
export type NewKind = SuiteFile["kind"] | "marp" | `drawing-${DrawingFormat}`;

export function newFile(kind: NewKind): SuiteFile {
  if (kind === "marp") return createMarpFile();
  if (kind === "drawing") return createDrawingFile("svg");
  if (kind.startsWith("drawing-")) return createDrawingFile(kind.slice("drawing-".length) as DrawingFormat);
  return createFile(kind as SuiteFile["kind"]);
}

/** The `new-…` menu action for a kind of drawing, and back. */
export const drawingAction = (format: DrawingFormat) => `new-drawing-${format}`;
export function drawingFromAction(action: string): NewKind | null {
  const format = action.replace(/^new-drawing-/, "");
  return action.startsWith("new-drawing-") && (DRAWING_FORMATS as readonly string[]).includes(format)
    ? `drawing-${format as DrawingFormat}`
    : null;
}

export function DrawingIcon({ size }: { size: number }) {
  return <PenTool size={size} />;
}

/** The home screen's card for a new drawing, which asks what kind. */
export function NewDrawingCard({
  onCreate,
  where,
}: {
  onCreate: (kind: NewKind) => void;
  where?: ReactNode;
}) {
  return (
    <div className="new-card new-drawing-card" role="group" aria-label="New drawing">
      <span className="app-icon drawing">
        <DrawingIcon size={30} />
      </span>
      <span>
        <strong>New drawing</strong>
        {where ?? <small>A picture or diagram, with its source beside it</small>}
        <span className="new-drawing-choices">
          {DRAWING_FORMATS.map((format) => (
            <button
              key={format}
              type="button"
              aria-label={`New ${FORMAT_NAME[format]} drawing`}
              onClick={() => onCreate(`drawing-${format}`)}
            >
              {FORMAT_NAME[format]}
            </button>
          ))}
        </span>
      </span>
    </div>
  );
}
