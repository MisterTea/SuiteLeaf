import { useEffect, useRef, useState, type ComponentType } from "react";
import type { AppState, BinaryFiles, ExcalidrawInitialDataState, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import { drawingRecord, readDrawing } from "./doc-drawing-scene";

type ExcalidrawComponent = ComponentType<ExcalidrawProps>;

type Scene = {
  elements: readonly { isDeleted?: boolean }[];
  appState: AppState;
  files: BinaryFiles;
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Insert › Drawing. Excalidraw supplies the canvas, shapes, and text.
 * Insert stores a PNG in the document and the scene so the drawing can be opened again.
 */
export function DrawingDialog({
  scene,
  onClose,
  onInsert,
}: {
  scene: string | null;
  onClose: () => void;
  onInsert: (src: string, scene: string | null) => void;
}) {
  const latest = useRef<Scene | null>(null);
  const [Canvas, setCanvas] = useState<ExcalidrawComponent | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const initial = useState(() => readDrawing(scene) as ExcalidrawInitialDataState | null)[0];

  useEffect(() => {
    let gone = false;
    void Promise.all([
      import("@excalidraw/excalidraw"),
      import("@excalidraw/excalidraw/index.css"),
    ])
      .then(([mod]) => {
        if (!gone) setCanvas(() => mod.Excalidraw);
      })
      .catch(() => {
        if (!gone) setFailed(true);
      });
    return () => {
      gone = true;
    };
  }, []);

  const insert = async () => {
    const current = latest.current;
    const elements = current?.elements.filter((element) => !element.isDeleted) ?? [];
    if (!current || !elements.length) return;
    setBusy(true);
    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const blob = await exportToBlob({
        elements: elements as Parameters<typeof exportToBlob>[0]["elements"],
        appState: { ...current.appState, exportBackground: true },
        files: current.files,
        mimeType: "image/png",
      });
      const src = await blobToDataUrl(blob);
      onInsert(src, drawingRecord(current));
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gdocs-modal-overlay" onClick={onClose}>
      <form
        className="gdocs-dialog drawing-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Drawing"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void insert();
        }}
      >
        <div className="dialog-header">
          <h2>Drawing</h2>
          <button type="button" className="dialog-close-btn" aria-label="Close drawing" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="dialog-body drawing-body">
          {failed ? (
            <p role="alert">The drawing editor could not be loaded.</p>
          ) : Canvas ? (
            <div className="drawing-stage">
              <Canvas
                initialData={initial}
                onChange={(elements, appState, files) => {
                  latest.current = { elements, appState, files };
                  setReady(elements.some((element) => !element.isDeleted));
                }}
              />
            </div>
          ) : (
            <p className="loading">Opening the drawing editor…</p>
          )}
        </div>
        <div className="dialog-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="dialog-primary-btn" disabled={!ready || busy}>
            {busy ? "Inserting…" : "Insert drawing"}
          </button>
        </div>
      </form>
    </div>
  );
}
