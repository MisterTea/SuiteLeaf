import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { SlidesEditorState } from "./slide-editor-state";
import type { SlideDrag } from "./slide-editor-thumbnails";

export const SLIDE_HOLD_MS = 500;

/** A hold selects slides; selected thumbnails can then be dragged as a group. */
export function useSlideThumbnailTouch(
  state: SlidesEditorState,
  applySelection: (
    active: string,
    selected: string[],
    element: string | null,
  ) => void,
  dragRef: { current: SlideDrag | null },
  setSlideDrag: (drag: SlideDrag | null) => void,
) {
  const [selectMode, setSelectMode] = useState(false);
  const mode = useRef(false);
  const ignoreClick = useRef(false);
  const touchInteraction = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseTouchMove = useRef<(() => void) | null>(null);
  const press = useRef<{
    x: number;
    y: number;
    held: boolean;
  } | null>(null);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      releaseTouchMove.current?.();
    },
    [],
  );
  const finishSelection = () => {
    clearTimer();
    mode.current = false;
    setSelectMode(false);
    applySelection(state.activeRef.current, [state.activeRef.current], null);
  };
  const onPointerDown = (e: PointerEvent<HTMLElement>, id: string) => {
    touchInteraction.current =
      e.pointerType === "touch" && window.innerWidth <= 700;
    if (!touchInteraction.current) return;
    clearTimer();
    ignoreClick.current = false;
    press.current = {
      x: e.clientX,
      y: e.clientY,
      held: false,
    };
    const target = e.currentTarget;
    releaseTouchMove.current?.();
    // Native scrolling owns ordinary swipes. Once a hold selects a slide,
    // cancel touch movement so this same gesture can reorder it. Changing
    // touch-action after pointerdown cannot change the browser's decision.
    const preventDragScroll = (event: TouchEvent) => {
      if (dragRef.current && event.cancelable) event.preventDefault();
    };
    target.addEventListener("touchmove", preventDragScroll, { passive: false });
    releaseTouchMove.current = () => {
      target.removeEventListener("touchmove", preventDragScroll);
      releaseTouchMove.current = null;
    };
    const pointerId = e.pointerId;
    const startX = e.clientX,
      startY = e.clientY;
    // Selection mode already distinguishes a thumbnail drag from filmstrip
    // scrolling. Pick up a selected group without requiring another hold.
    if (mode.current && state.selectedRef.current.includes(id) && !state.readOnlyRef.current) {
      const next = { ids: [...state.selectedRef.current], startX, startY, over: null };
      dragRef.current = next;
      setSlideDrag(next);
      target.setPointerCapture?.(pointerId);
    }
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!press.current) return;
      press.current.held = true;
      ignoreClick.current = true;
      const alreadySelecting = mode.current;
      mode.current = true;
      setSelectMode(true);
      const ids =
        alreadySelecting && state.selectedRef.current.includes(id)
          ? [...state.selectedRef.current]
          : [id];
      state.anchorRef.current = id;
      applySelection(id, ids, null);
      if (!state.readOnlyRef.current) {
        const next = { ids, startX, startY, over: null };
        dragRef.current = next;
        setSlideDrag(next);
      }
      target.setPointerCapture?.(pointerId);
    }, SLIDE_HOLD_MS);
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const start = press.current;
    if (!start) return;
    if (
      !start.held &&
      Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10
    ) {
      clearTimer();
      ignoreClick.current = true;
    }
  };
  const onPointerUp = () => {
    clearTimer();
    if (dragRef.current?.over != null) ignoreClick.current = true;
    releaseTouchMove.current?.();
    press.current = null;
  };
  const onPointerCancel = () => {
    onPointerUp();
    ignoreClick.current = true;
    dragRef.current = null;
    setSlideDrag(null);
  };
  const click = (id: string): boolean => {
    if (!touchInteraction.current) return false;
    if (ignoreClick.current) {
      ignoreClick.current = false;
      return true;
    }
    if (!mode.current) return false;
    const selected = state.selectedRef.current;
    const ids = selected.includes(id)
      ? selected.filter((item) => item !== id)
      : [...selected, id];
    // Keep one active slide even when the last selected thumbnail is tapped.
    if (ids.length)
      applySelection(ids.includes(id) ? id : ids[ids.length - 1], ids, null);
    return true;
  };
  return {
    selectMode,
    finishSelection,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    click,
    touchInteraction,
  };
}
