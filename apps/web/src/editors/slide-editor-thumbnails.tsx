import { useEffect, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import { Link } from "react-router-dom";
import { Blend, ChevronDown, ChevronUp, Copy, Plus, Trash2 } from "lucide-react";
import {
  canDeleteSlides,
  canMove,
  extendSelection,
  rangeIds,
  reorderGroup,
  toggleId,
} from "./slide-editing";
import { SlideStill } from "./slide-surface";
import type { MarpPages } from "./slide-marp-backdrop";
import { presentationSlidePath } from "../slide-location";
import type { SlidesEditorState } from "./slide-editor-state";
import type { DeckHistoryApi } from "./slide-editor-history";
import type { SlideOrderActions } from "./slide-editor-commands";

export type SlideDrag = {
  ids: string[];
  startX: number;
  startY: number;
  over: number | null;
};

type ThumbnailDragRefs = {
  dragRef: RefObject<SlideDrag | null>;
  setSlideDrag: Dispatch<SetStateAction<SlideDrag | null>>;
  thumbnailsRef: RefObject<HTMLDivElement | null>;
  suppressThumbnailClick: RefObject<boolean>;
};

/** Dragging thumbnails into a new order, and keeping the active slide's thumbnail in view. */
export function useThumbnailDrag(
  state: SlidesEditorState,
  { dragRef, setSlideDrag, thumbnailsRef, suppressThumbnailClick }: ThumbnailDragRefs,
) {
  const { deck, deckRef, commitRef, activeSlideId } = state;

  useEffect(() => {
    const filmstrip = () =>
      !!thumbnailsRef.current &&
      getComputedStyle(thumbnailsRef.current).flexDirection === "row";
    const gapAt = (point: number, horizontal: boolean) => {
      const rows = [
        ...(thumbnailsRef.current?.querySelectorAll(".thumbnail-row") ?? []),
      ];
      const i = rows.findIndex((row) => {
        const r = row.getBoundingClientRect();
        return horizontal
          ? point < r.left + r.width / 2
          : point < r.top + r.height / 2;
      });
      return i === -1 ? rows.length : i;
    };
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const horizontal = filmstrip();
      const delta = horizontal ? e.clientX - drag.startX : e.clientY - drag.startY;
      if (drag.over === null && Math.abs(delta) < 6) return;
      const over = gapAt(horizontal ? e.clientX : e.clientY, horizontal);
      if (over === drag.over) return;
      const next = { ...drag, over };
      dragRef.current = next;
      setSlideDrag(next);
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setSlideDrag(null);
      if (drag.over === null) return;
      suppressThumbnailClick.current = true;
      setTimeout(() => (suppressThumbnailClick.current = false));
      const prev = deckRef.current;
      const slideOrder = reorderGroup(prev.slideOrder, drag.ids, drag.over);
      if (slideOrder === prev.slideOrder) return;
      commitRef.current({ ...prev, slideOrder });
    };
    const onDragStart = (event: DragEvent) => event.preventDefault();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("dragend", onUp);
    window.addEventListener("dragstart", onDragStart);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("dragend", onUp);
      window.removeEventListener("dragstart", onDragStart);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, []);

  useEffect(() => {
    thumbnailsRef.current
      ?.querySelector(`[data-slide-id="${activeSlideId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [activeSlideId, deck.slideOrder]);
}

/** The menu a right-click on a thumbnail opens. */
export function SlideContextMenu({
  contextMenu,
  setContextMenu,
  duplicateCurrentSlide,
  deleteCurrentSlide,
  moveSlides,
}: {
  contextMenu: { x: number; y: number };
  setContextMenu: (menu: { x: number; y: number } | null) => void;
} & Pick<SlideOrderActions, "duplicateCurrentSlide" | "deleteCurrentSlide" | "moveSlides">) {
  return (
    <div
      id="slide-context-menu"
      className="menu-content slide-context-menu"
      role="menu"
      style={{ left: contextMenu.x, top: contextMenu.y }}
    >
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        onClick={() => {
          setContextMenu(null);
          duplicateCurrentSlide();
        }}
      >
        <span className="menu-item-label">Duplicate slide</span>
        <span className="menu-item-keys">Cmd+D</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        onClick={() => {
          setContextMenu(null);
          deleteCurrentSlide();
        }}
      >
        <span className="menu-item-label">Delete slide</span>
        <span className="menu-item-keys">Delete</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        onClick={() => {
          setContextMenu(null);
          moveSlides("start");
        }}
      >
        <span className="menu-item-label">Move to start</span>
        <span className="menu-item-keys">Cmd+Shift+Up</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        onClick={() => {
          setContextMenu(null);
          moveSlides("end");
        }}
      >
        <span className="menu-item-label">Move to end</span>
        <span className="menu-item-keys">Cmd+Shift+Down</span>
      </button>
    </div>
  );
}

/** The list of slides beside the canvas. */
export function SlideThumbnails({
  state,
  readOnly,
  fileId,
  marpPages,
  slideDrag,
  setSlideDrag,
  dragRef,
  thumbnailsRef,
  suppressThumbnailClick,
  applySelection,
  addSlide,
  duplicateCurrentSlide,
  deleteCurrentSlide,
  moveSlides,
  stepSlide,
}: ThumbnailDragRefs &
  Pick<DeckHistoryApi, "applySelection"> &
  Pick<
    SlideOrderActions,
    "addSlide" | "duplicateCurrentSlide" | "deleteCurrentSlide" | "moveSlides" | "stepSlide"
  > & {
    state: SlidesEditorState;
    readOnly: boolean;
    fileId?: string;
    marpPages: MarpPages | null;
    slideDrag: SlideDrag | null;
  }) {
  const {
    deck, activeSlideId, selectedSlideIds, selectedRef, anchorRef, activeRef, readOnlyRef,
    setTransitionScope, setContextMenu,
  } = state;
  return (
    <aside className="slides-sidebar" aria-label="Slide thumbnails">
      <div className="slides-sidebar-header">
        <span>Slides ({deck.slideOrder.length})</span>
        <div className="sidebar-slide-actions">
          <button
            type="button"
            title="Move slide up"
            onClick={() => moveSlides("up")}
            disabled={readOnly || !canMove(deck.slideOrder, selectedSlideIds, "up")}
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            title="Move slide down"
            onClick={() => moveSlides("down")}
            disabled={
              readOnly || !canMove(deck.slideOrder, selectedSlideIds, "down")
            }
          >
            <ChevronDown size={14} />
          </button>
          <button
            type="button"
            title="Duplicate slide"
            disabled={readOnly}
            onClick={duplicateCurrentSlide}
          >
            <Copy size={14} />
          </button>
          <button
            type="button"
            title="Delete slide"
            onClick={deleteCurrentSlide}
            disabled={
              readOnly || !canDeleteSlides(deck.slideOrder, selectedSlideIds)
            }
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div
        className={`thumbnails-list ${slideDrag?.over != null ? "dragging" : ""}`}
        ref={thumbnailsRef}
        role="listbox"
        aria-label="Slides"
        aria-multiselectable="true"
        tabIndex={0}
        onKeyDown={(e) => {
          const horizontal =
            getComputedStyle(e.currentTarget).flexDirection === "row";
          const key =
            horizontal && e.key === "ArrowLeft"
              ? "ArrowUp"
              : horizontal && e.key === "ArrowRight"
                ? "ArrowDown"
                : e.key;
          if (key !== "ArrowUp" && key !== "ArrowDown") return;
          if (e.metaKey || e.ctrlKey || e.altKey) return;
          e.preventDefault();
          const order = deck.slideOrder;
          if (e.shiftKey) {
            const next = extendSelection(
              order,
              anchorRef.current,
              activeRef.current,
              key === "ArrowUp" ? "up" : "down",
            );
            applySelection(next.activeId, next.selected, null);
            return;
          }
          stepSlide(key === "ArrowUp" ? "prev" : "next");
        }}
      >
        {deck.slideOrder.map((id, index) => {
          const slide = deck.slides[id];
          const isActive = id === activeSlideId;
          const isChosen = selectedSlideIds.includes(id);
          const heading = slide?.elements
            .find((el) => el.type === "text" && !el.wordArt && el.content?.trim())
            ?.content?.trim()
            .split("\n")[0];
          const bg = slide?.background?.color || "#ffffff";
          const dropClass =
            slideDrag?.over === index
              ? "drop-before"
              : slideDrag?.over === index + 1 &&
                  index === deck.slideOrder.length - 1
                ? "drop-after"
                : "";

          const label = `Slide ${index + 1}${slide?.transition && slide.transition.type !== "none" ? `, ${slide.transition.type} transition` : ""}${heading ? `: ${heading}` : ""}`;
          const rowProps = {
            key: id,
            role: "option" as const,
            "data-slide-id": id,
            "aria-selected": isChosen,
            "aria-label": label,
            className: `thumbnail-row ${isChosen ? "selected" : ""} ${isActive ? "active" : ""} ${slideDrag?.over != null && slideDrag.ids.includes(id) ? "drag-source" : ""} ${dropClass}`,
          };
          const body: ReactNode = (
            <>
              <span className="thumbnail-num">{index + 1}</span>
              <div
                className="thumbnail-card"
                style={{ backgroundColor: bg }}
              >
                <div className="thumbnail-preview">
                  <SlideStill
                    deck={deck}
                    slide={slide}
                    index={index}
                    pages={marpPages}
                    lazy
                  />
                </div>
                {slide?.transition && slide.transition.type !== "none" ? (
                  <span
                    className="thumbnail-transition"
                    title={slide.transition.type}
                  >
                    <Blend size={10} />
                  </span>
                ) : null}
              </div>
            </>
          );
          const handlers = {
              onMouseDown: (e: React.MouseEvent) => {
                if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey)
                  return;
                // Firefox starts a native drag unless the press is cancelled,
                // and then the thumbnail never lands in the new gap.
                e.preventDefault();
                const ids = selectedRef.current.includes(id)
                  ? [...selectedRef.current]
                  : [id];
                if (!selectedRef.current.includes(id)) {
                  anchorRef.current = id;
                  applySelection(id, [id], null);
                }
                const next = { ids, startX: e.clientX, startY: e.clientY, over: null };
                dragRef.current = next;
                setSlideDrag(next);
              },
              onClick: (e: React.MouseEvent) => {
                // The row is a link; the editor chooses the slide instead of following it.
                e.preventDefault();
                if (suppressThumbnailClick.current) return;
                thumbnailsRef.current?.focus();
                if (e.shiftKey) {
                  const ids = rangeIds(deck.slideOrder, anchorRef.current, id);
                  applySelection(id, ids, null);
                  if (ids.length > 1) setTransitionScope("selected");
                  return;
                }
                if (e.metaKey || e.ctrlKey) {
                  const ids = toggleId(selectedRef.current, id);
                  anchorRef.current = id;
                  applySelection(
                    ids.includes(id) ? id : ids[ids.length - 1],
                    ids,
                    null,
                  );
                  return;
                }
                anchorRef.current = id;
                applySelection(id, [id], null);
              },
              onContextMenu: (e: React.MouseEvent) => {
                e.preventDefault();
                if (readOnlyRef.current) return;
                if (!selectedRef.current.includes(id)) {
                  anchorRef.current = id;
                  applySelection(id, [id], null);
                }
                setContextMenu({
                  x: Math.max(8, Math.min(e.clientX, window.innerWidth - 230)),
                  y: Math.max(8, Math.min(e.clientY, window.innerHeight - 210)),
                });
              },
          };
          return fileId ? (
            <Link {...rowProps} {...handlers} to={presentationSlidePath(fileId, id)}>
              {body}
            </Link>
          ) : (
            <div {...rowProps} {...handlers}>
              {body}
            </div>
          );
        })}
      </div>

      <div className="slides-sidebar-footer">
        <button
          type="button"
          className="add-slide-sidebar-btn"
          disabled={readOnly}
          onClick={() => addSlide("title-body")}
          title="New slide (Cmd+M)"
        >
          <Plus size={16} /> New slide
        </button>
      </div>
    </aside>
  );
}
