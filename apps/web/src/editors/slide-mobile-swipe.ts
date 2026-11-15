import { useEffect, useRef, type RefObject } from "react";

/** Navigate from the slide background while leaving object and text gestures alone. */
export function useSlideMobileSwipe(
  host: RefObject<HTMLDivElement | null>,
  navigate: (direction: -1 | 1) => void,
  readOnly: boolean,
  { overObjects = false, editingId = null }: { overObjects?: boolean; editingId?: string | null } = {},
) {
  const latest = useRef({ navigate, readOnly, overObjects, editingId });
  latest.current = { navigate, readOnly, overObjects, editingId };
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    let suppressClick = false;
    let press: { id: number; x: number; y: number; axis?: "horizontal" | "vertical" } | null = null;
    const down = (event: PointerEvent) => {
      suppressClick = false;
      if (press) { press = null; return; }
      if (event.pointerType !== "touch" || window.innerWidth > 700) return;
      const target = event.target as Element;
      if (target.closest("button, a, input, select, .slide-comment-mark, aside, .presenter-controls")) return;
      const elementId = target.closest<HTMLElement>("[data-element-id]")?.dataset.elementId;
      if (target.closest("textarea, [contenteditable=true]") &&
        (!latest.current.overObjects || !elementId || latest.current.editingId === elementId)) return;
      if (elementId && latest.current.editingId === elementId) return;
      if (!latest.current.readOnly && !latest.current.overObjects && elementId) return;
      press = { id: event.pointerId, x: event.clientX, y: event.clientY };
      node.setPointerCapture?.(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!press || press.id !== event.pointerId || press.axis) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (Math.hypot(dx, dy) < 8) return;
      press.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? "horizontal" : "vertical";
    };
    const up = (event: PointerEvent) => {
      if (!press || press.id !== event.pointerId) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      const vertical = press.axis === "vertical";
      press = null;
      if (vertical || Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      event.preventDefault();
      suppressClick = true;
      latest.current.navigate(dx < 0 ? 1 : -1);
    };
    const cancel = () => { press = null; };
    const click = (event: MouseEvent) => {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    node.addEventListener("click", click, true);
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", cancel);
    return () => {
      node.removeEventListener("click", click, true);
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", cancel);
    };
  }, [host]);
}
