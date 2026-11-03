import { useEffect, useState } from "react";
import { placeSlideObject, readSlideGeometry, type SlideGeometry } from "@suiteleaf/core";

type Box = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  locked?: boolean;
  rotation?: number;
};

/** Exact position for the selected box. A locked box is not moved. */
export function SlideGeometryPanel({
  object,
  onPlace,
  onClose,
}: {
  object: Box | null;
  onPlace: (id: string, next: SlideGeometry) => void;
  onClose: () => void;
}) {
  const [x, setX] = useState(object ? String(object.x) : "");
  const [y, setY] = useState(object ? String(object.y) : "");
  const [width, setWidth] = useState(object ? String(object.width) : "");
  const [height, setHeight] = useState(object ? String(object.height) : "");
  const [rotation, setRotation] = useState(object?.rotation != null ? String(object.rotation) : "");
  const [note, setNote] = useState("");
  useEffect(() => {
    setX(object ? String(object.x) : "");
    setY(object ? String(object.y) : "");
    setWidth(object ? String(object.width) : "");
    setHeight(object ? String(object.height) : "");
    setRotation(object?.rotation != null ? String(object.rotation) : "");
    setNote("");
  }, [object?.id, object?.x, object?.y, object?.width, object?.height, object?.rotation, object?.locked]);
  return (
    <section className="access-notes" aria-label="Size and position">
      <h2>Size and position</h2>
      {object ? null : <p>Select one object.</p>}
      <label>
        X
        <input aria-label="Object x" value={x} onChange={(event) => setX(event.target.value)} />
      </label>
      <label>
        Y
        <input aria-label="Object y" value={y} onChange={(event) => setY(event.target.value)} />
      </label>
      <label>
        Width
        <input
          aria-label="Object width"
          value={width}
          onChange={(event) => setWidth(event.target.value)}
        />
      </label>
      <label>
        Height
        <input
          aria-label="Object height"
          value={height}
          onChange={(event) => setHeight(event.target.value)}
        />
      </label>
      <label>
        Rotation
        <input
          aria-label="Object rotation"
          value={rotation}
          onChange={(event) => setRotation(event.target.value)}
        />
      </label>
      <button
        type="button"
        onClick={() => {
          if (!object) {
            setNote("Select one object.");
            return;
          }
          if (object.locked) {
            setNote("That object is locked.");
            return;
          }
          const next = readSlideGeometry({ x, y, width, height, rotation });
          if ("error" in next) {
            setNote(next.error);
            return;
          }
          const placed = placeSlideObject(object, next);
          onPlace(object.id, {
            x: placed.x,
            y: placed.y,
            width: placed.width,
            height: placed.height,
            ...(placed.rotation != null ? { rotation: placed.rotation } : {}),
          });
          setNote("The position was applied.");
        }}
      >
        Apply position
      </button>
      <button type="button" onClick={onClose}>
        Close
      </button>
      {note ? <p role="status">{note}</p> : null}
    </section>
  );
}
