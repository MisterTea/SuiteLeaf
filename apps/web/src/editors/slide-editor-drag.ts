import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { placeSlideGroup, snapSlideBox, type Presentation, type Slide } from "@suiteleaf/core";
import { hasTextRuns } from "./slide-runs";
import { isMarpChrome, isMarpTitle, reorderFittedMarpItem, reorderMarpItem } from "./slide-marp";
import type { ResizeHandle, SlidesEditorState } from "./slide-editor-state";
import type { SlideUpdates } from "./slide-editor-elements";

/** Moving, resizing, and reordering objects on the slide with the mouse. */
export function useElementDrag(
  state: SlidesEditorState,
  { activeSlide, updateElement, publishLive }: Pick<SlideUpdates, "updateElement"> & {
    activeSlide: Slide;
    publishLive: (next: Presentation) => void;
  },
) {
  const {
    deck, deckRef, activeRef, textPress, dragMoved, selectedIdsRef, selectedElementRef,
    setSelectedElementId, setTableCell, editingRef, setEditingId, textRange, readOnlyRef,
    draggingRef, marpOpenRef, stageRef, liveDirty, setSnapGuide, historyRef,
    commitRef,
  } = state;
  const lastTouchTap = useRef<{ id: string; time: number } | null>(null);
  const publishRef = useRef(publishLive);
  publishRef.current = publishLive;
  const touchPress = useRef<{ id: number; elementId: string; handle?: ResizeHandle } | null>(null);

  // Mouse drag & resize handlers for elements
  const onElementMouseDown = (
    e: React.MouseEvent,
    elementId: string,
    handle?: ResizeHandle,
  ) => {
    e.stopPropagation();
    textPress.current = !!(e.target as HTMLElement).closest?.(
      ".element-textarea, .element-editor",
    );
    dragMoved.current = false;
    if (e.shiftKey) {
      const ids = selectedIdsRef.current.includes(elementId)
        ? selectedIdsRef.current.filter((id) => id !== elementId)
        : [...selectedIdsRef.current, elementId];
      selectedIdsRef.current = ids.length ? ids : [elementId];
    } else {
      selectedIdsRef.current = [elementId];
    }
    selectedElementRef.current = elementId;
    setSelectedElementId(elementId);
    setTableCell((current) => (current?.id === elementId ? current : null));
    if (!handle && editingRef.current && editingRef.current !== elementId) {
      editingRef.current = null;
      setEditingId(null);
      textRange.current = null;
    }
    const el = activeSlide.elements.find((item) => item.id === elementId);
    if (!el || readOnlyRef.current || el.locked) return;
    if (
      el.type === "text" &&
      !("pointerType" in e && e.pointerType === "touch") &&
      (el.math || el.preformatted || el.hang || hasTextRuns(el) || el.content?.includes("$")) &&
      deckRef.current.marp
    ) {
      editingRef.current = elementId;
      setEditingId(elementId);
    }
    if (deckRef.current.marp) {
      if (handle || isMarpTitle(el) || isMarpChrome(el)) return;
      draggingRef.current = {
        elementId,
        startX: e.clientX,
        startY: e.clientY,
        initX: el.x,
        initY: el.y,
        reorder: true,
        fitted: !!deckRef.current.marpFit,
      };
      return;
    }
    if (marpOpenRef.current) return;

    const group = el.groupId
      ? activeSlide.elements
          .filter((item) => item.groupId === el.groupId)
          .map((item) => ({ id: item.id, x: item.x, y: item.y }))
      : undefined;
    draggingRef.current = {
      elementId,
      startX: e.clientX,
      startY: e.clientY,
      initX: el.x,
      initY: el.y,
      handle,
      initW: el.width,
      initH: el.height,
      proportional: el.type === "image" && handle?.length === 2,
      group,
    };
  };

  const onElementPointerDown = (e: React.PointerEvent, elementId: string, handle?: ResizeHandle) => {
    if (e.pointerType !== "touch" || window.innerWidth > 700) return;
    if (!handle && editingRef.current === elementId) return;
    e.preventDefault();
    onElementMouseDown(e, elementId, handle);
    touchPress.current = { id: e.pointerId, elementId, handle };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onElementPointerUp = (e: React.PointerEvent) => {
    const press = touchPress.current;
    if (!press || press.id !== e.pointerId) return;
    touchPress.current = null;
    const el = activeSlide.elements.find((item) => item.id === press.elementId);
    if (dragMoved.current || press.handle || el?.type !== "text" || readOnlyRef.current) {
      lastTouchTap.current = null;
      return;
    }
    const now = performance.now();
    if (lastTouchTap.current?.id === el.id && now - lastTouchTap.current.time < 350) {
      draggingRef.current = null;
      editingRef.current = el.id;
      textRange.current = null;
      flushSync(() => setEditingId(el.id));
      e.currentTarget.querySelector<HTMLElement>('[contenteditable="true"], textarea')?.focus();
      lastTouchTap.current = null;
    } else lastTouchTap.current = { id: el.id, time: now };
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
        proportional,
        reorder,
        fitted,
        group,
      } = draggingRef.current;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < 8) return;
      dragMoved.current = true;
      textPress.current = false;
      if (reorder) {
        const canvas = stageRef.current.querySelector(".slide-canvas");
        const slide =
          deckRef.current.slides[activeRef.current] ||
          deckRef.current.slides[deckRef.current.slideOrder[0]];
        if (!canvas || !slide) return;
        const rect = canvas.getBoundingClientRect();
        const width = deckRef.current.width || 960;
        const height = deckRef.current.height || 540;
        const nextSlide = (fitted ? reorderFittedMarpItem : reorderMarpItem)(
          slide,
          elementId,
          {
            x: ((e.clientX - rect.left) / rect.width) * width,
            y: ((e.clientY - rect.top) / rect.height) * height,
          },
          width,
        );
        if (!nextSlide) return;
        const prev = deckRef.current;
        publishRef.current({
          ...prev,
          slides: { ...prev.slides, [slide.id]: nextSlide },
        });
        return;
      }
      if (deckRef.current.marp) return;
      const stageRect = (stageRef.current.querySelector(".slide-canvas") ?? stageRef.current).getBoundingClientRect();
      const scale = stageRect.width / (deck.width || 960);

      const dx = (e.clientX - startX) / scale;
      const dy = (e.clientY - startY) / scale;

      if (handle && proportional && initW > 0 && initH > 0) {
        const west = handle.includes("w");
        const north = handle.includes("n");
        const outwardX = west ? -dx : dx;
        const outwardY = north ? -dy : dy;
        // Project the pointer movement onto the original diagonal.
        const growth = (outwardX * initW + outwardY * initH) / (initW ** 2 + initH ** 2);
        const minimum = Math.min(1, Math.max(30 / initW, 20 / initH));
        const factor = Math.max(minimum, 1 + growth);
        const width = initW * factor;
        const height = initH * factor;
        updateElement(elementId, {
          x: west ? initX + initW - width : initX,
          y: north ? initY + initH - height : initY,
          width,
          height,
        }, { live: true });
      } else if (handle) {
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

        updateElement(
          elementId,
          { x: newX, y: newY, width: newW, height: newH },
          { live: true },
        );
      } else {
        const newX = Math.round(initX + dx);
        const newY = Math.round(initY + dy);
        const slide =
          deckRef.current.slides[activeRef.current] ||
          deckRef.current.slides[deckRef.current.slideOrder[0]];
        const mates = new Set((group ?? []).map((item) => item.id));
        const snapped = snapSlideBox(
          { id: elementId, x: newX, y: newY, width: initW, height: initH },
          (slide?.elements ?? []).filter((item) => !mates.has(item.id)),
          deckRef.current,
        );
        setSnapGuide(
          snapped.guideX === null && snapped.guideY === null
            ? null
            : { x: snapped.guideX, y: snapped.guideY },
        );
        if (slide && group && group.length > 1) {
          const elements = placeSlideGroup(slide.elements, group, snapped.x - initX, snapped.y - initY);
          publishRef.current({
            ...deckRef.current,
            slides: { ...deckRef.current.slides, [slide.id]: { ...slide, elements } },
          });
        } else {
          updateElement(elementId, { x: snapped.x, y: snapped.y }, { live: true });
        }
      }
    };

    const onMouseUp = () => {
      setTimeout(() => {
        textPress.current = false;
        dragMoved.current = false;
      }, 0);
      if (!draggingRef.current) return;
      draggingRef.current = null;
      setSnapGuide(null);
      if (!liveDirty.current) return;
      liveDirty.current = false;
      const next = deckRef.current;
      if (JSON.stringify(next) === JSON.stringify(historyRef.current!.tip))
        return;
      commitRef.current(next);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    const onPointerMove = (e: PointerEvent) => {
      if (touchPress.current?.id === e.pointerId) onMouseMove(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      touchPress.current = null;
      onMouseUp();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [deck.width, updateElement]);

  return { onElementMouseDown, onElementPointerDown, onElementPointerUp };
}
