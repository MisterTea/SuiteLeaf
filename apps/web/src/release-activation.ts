import { useRef, type MouseEvent, type PointerEvent } from "react";

/** A click after a drag or cancelled touch is not a toolbar command. */
export function useReleaseActivation(activate: () => void) {
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    cancelled: boolean;
  } | null>(null);
  const moved = (event: PointerEvent<HTMLElement>) => {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
      start.cancelled = true;
    }
  };
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      gesture.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        cancelled: false,
      };
    },
    onPointerMove: moved,
    onPointerUp: moved,
    onPointerCancel() {
      if (gesture.current) gesture.current.cancelled = true;
    },
    onClick(event: MouseEvent<HTMLElement>) {
      const cancelled = gesture.current?.cancelled;
      gesture.current = null;
      if (event.detail !== 0 && cancelled) {
        event.preventDefault();
        return;
      }
      activate();
    },
  };
}
