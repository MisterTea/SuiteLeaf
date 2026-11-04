import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { filename, type Slide, type SlideFile } from "@suiteleaf/core";
import { animationSequence } from "@suiteleaf/core/slide-motion";
import { exportBinary } from "../storage";
import {
  formatElapsed,
  nextSlideTitle,
  showAdvanceDelay,
  showFrame,
  shownElapsedMs,
  slideTitleText,
} from "./presenter-display";
import { audienceLines, openAudienceScreen } from "./audience-screen";
import { readMaster } from "./slide-master";
import { transitionMs } from "./slide-theme";
import {
  animationEnterMs,
  audienceClass,
  audiencePhase,
  clickSteps,
  exitConcealed,
  fadeOnClickIds,
  hiddenParagraphIndexes,
  moveShowCursor,
  samePlace,
  shownSlideIndex,
  startOfShow,
} from "./slide-fade-in";
import type { SlideFaceHooks } from "./slide-surface";
import type { MarpDraft } from "./slide-marp-textarea";
import type { SlidesEditorState } from "./slide-editor-state";

/** Starting, stepping, and ending the slideshow. */
export function useShowControls(
  state: SlidesEditorState,
  { file, marpDraft }: { file: SlideFile; marpDraft: RefObject<MarpDraft | null> },
) {
  const {
    deckRef, showCursorRef, setShowCursor, setShowSpeakerNotes, setBlankScreen, setShowStartedAt,
    setClock, setTimerPaused, setFrozenElapsedMs, setPresenting, moveShowRef, recorderRef,
    setRecording,
  } = state;

  const [controlsVisible, setControlsVisible] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsHoveredRef = useRef(false);
  const showFullscreenRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const beginShow = useCallback((fromIndex: number, withNotes?: boolean) => {
    marpDraft.current?.flush();
    const order = deckRef.current.slideOrder;
    const shown = (index: number) => deckRef.current.slides[order[index]]?.hidden !== true;
    const next = startOfShow(shownSlideIndex(fromIndex, order.length, 1, shown) ?? fromIndex);
    showCursorRef.current = next;
    setShowCursor(next);
    if (withNotes !== undefined) setShowSpeakerNotes(withNotes);
    setBlankScreen(null);
    setControlsVisible(true);
    const now = Date.now();
    setShowStartedAt(now);
    setClock(now);
    setTimerPaused(false);
    setFrozenElapsedMs(0);
    setPresenting(true);
    // Browsers only allow fullscreen from inside the click or key press.
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) {
      showFullscreenRef.current = true;
      root.requestFullscreen().then(
        () => {
          if (!showFullscreenRef.current)
            document.exitFullscreen().catch(() => {});
        },
        () => {
          showFullscreenRef.current = false;
        },
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, []);

  moveShowRef.current = (where) => {
    setBlankScreen(null);
    const order = deckRef.current.slideOrder;
    const current = showCursorRef.current;
    const shown = (index: number) => deckRef.current.slides[order[index]]?.hidden !== true;
    const next = moveShowCursor(
      current,
      where,
      (index) =>
        fadeOnClickIds(deckRef.current.slides[order[index]]?.elements ?? []),
      order.length,
      (index) => clickSteps(deckRef.current.slides[order[index]]?.elements ?? []),
      shown,
    );
    if (samePlace(current, next) && current.enteringId === next.enteringId)
      return;
    showCursorRef.current = next;
    setShowCursor(next);
  };

  const endShow = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    if (recorder) {
      void recorder.stop().then(async (blob) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!bytes.length) return;
        await exportBinary(filename(file.title, "webm"), bytes, blob.type || "video/webm");
      });
    }
    setPresenting(false);
    if (showFullscreenRef.current) {
      showFullscreenRef.current = false;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [file.title]);

  return {
    controlsVisible,
    setControlsVisible,
    idleTimerRef,
    controlsHoveredRef,
    showFullscreenRef,
    overlayRef,
    beginShow,
    endShow,
  };
}

export type ShowControls = ReturnType<typeof useShowControls>;

/** The running slideshow: its keys, timers, transitions, recording, and audience screen. */
export function useShowPlayback(
  state: SlidesEditorState,
  {
    activeSlide,
    endShow,
    idleTimerRef,
    controlsHoveredRef,
    setControlsVisible,
    showFullscreenRef,
    overlayRef,
  }: Pick<
    ShowControls,
    | "endShow"
    | "idleTimerRef"
    | "controlsHoveredRef"
    | "setControlsVisible"
    | "showFullscreenRef"
    | "overlayRef"
  > & { activeSlide: Slide },
) {
  const {
    deck, deckRef, presenting, setPresenting, presentSlideIndex, showCursor, blankScreen,
    setBlankScreen, timerPaused, setShowSpeakerNotes, showSpeakerNotes, setClock, clock,
    showStartedAt, frozenElapsedMs, showMotion, setShowMotion, reducedMotion, recording,
    recorderRef, audiencePopup, moveShowRef,
  } = state;

  useEffect(() => {
    const slide = deckRef.current.slides[deckRef.current.slideOrder[presentSlideIndex]];
    const wait = showAdvanceDelay({
      presenting,
      blank: blankScreen != null,
      paused: timerPaused,
      seconds: slide?.advanceSeconds,
    });
    if (wait == null) return;
    const timer = window.setTimeout(() => moveShowRef.current("next"), wait);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [presenting, presentSlideIndex, showCursor.revealed, blankScreen, timerPaused]);

  // Keyboard navigation and auto-hiding controls for presentation mode
  useEffect(() => {
    if (!presenting) return;
    const toggleBlank = (color: string) =>
      setBlankScreen((prev) => (prev === color ? null : color));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
        case "n":
          moveShowRef.current("next");
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
        case "Backspace":
        case "p":
          moveShowRef.current("prev");
          break;
        case "Home":
          moveShowRef.current("home");
          break;
        case "End":
          moveShowRef.current("end");
          break;
        case "b":
        case "B":
        case ".":
          toggleBlank("#000000");
          break;
        case "w":
        case "W":
        case ",":
          toggleBlank("#ffffff");
          break;
        case "s":
        case "S":
          setShowSpeakerNotes((prev) => !prev);
          break;
        case "Escape":
          endShow();
          break;
        default:
          return;
      }
      e.preventDefault();
    };

    const scheduleHide = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        if (!controlsHoveredRef.current) setControlsVisible(false);
      }, 2500);
    };
    const onMouseMove = () => {
      setControlsVisible(true);
      scheduleHide();
    };
    scheduleHide();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMouseMove);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMouseMove);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [presenting, endShow]);

  // Leaving fullscreen (the browser's own Esc or exit button) ends the show
  useEffect(() => {
    if (!presenting) return;
    overlayRef.current?.focus();
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && showFullscreenRef.current) {
        showFullscreenRef.current = false;
        setPresenting(false);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (showFullscreenRef.current && document.fullscreenElement) {
        showFullscreenRef.current = false;
        document.exitFullscreen().catch(() => {});
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [presenting]);

  useEffect(() => {
    if (!presenting || !showSpeakerNotes) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [presenting, showSpeakerNotes]);

  const showArmed = useRef(false);
  if (!presenting) {
    showArmed.current = false;
    if (showMotion.type) setShowMotion({ index: -1, type: null });
  } else if (!showArmed.current) {
    showArmed.current = true;
    if (showMotion.index !== presentSlideIndex)
      setShowMotion({ index: presentSlideIndex, type: null });
  } else if (showMotion.index !== presentSlideIndex) {
    const incoming = deck.slides[deck.slideOrder[presentSlideIndex]]?.transition;
    const ms = transitionMs(incoming, reducedMotion);
    setShowMotion({
      index: presentSlideIndex,
      type: ms > 0 && incoming && incoming.type !== "none" ? incoming.type : null,
    });
  }
  const showMotionClass =
    showMotion.index === presentSlideIndex && showMotion.type
      ? ` deck-motion-${showMotion.type}`
      : "";

  const presentSlide =
    deck.slides[deck.slideOrder[presentSlideIndex]] || activeSlide;
  useEffect(() => {
    if (!recording) return;
    const master = readMaster(deck);
    recorderRef.current?.paint(
      presentSlide,
      deck.width || 960,
      deck.height || 540,
      master.elements,
      master.background?.color,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [recording, presentSlide, deck]);
  const shownAt = (index: number) => deck.slides[deck.slideOrder[index]]?.hidden !== true;
  const upcoming = shownSlideIndex(presentSlideIndex + 1, deck.slideOrder.length, 1, shownAt);
  const nextPresentSlide = upcoming === null ? undefined : deck.slides[deck.slideOrder[upcoming]];
  const fadeIdsAt = (index: number) =>
    fadeOnClickIds(deck.slides[deck.slideOrder[index]]?.elements ?? []);
  const stepsAt = (index: number) =>
    clickSteps(deck.slides[deck.slideOrder[index]]?.elements ?? []);
  const cannotAdvance = samePlace(
    showCursor,
    moveShowCursor(showCursor, "next", fadeIdsAt, deck.slideOrder.length, stepsAt, shownAt),
  );
  const cannotRetreat = samePlace(
    showCursor,
    moveShowCursor(showCursor, "prev", fadeIdsAt, deck.slideOrder.length, stepsAt, shownAt),
  );
  const fadeWaiting = showCursor.revealed < fadeIdsAt(presentSlideIndex).length;
  const elapsedSeconds = Math.floor(
    shownElapsedMs(clock - showStartedAt, timerPaused, frozenElapsedMs) / 1000,
  );
  const elapsedLabel = formatElapsed(elapsedSeconds);

  /** The audience sees fade-on-click objects only once they are revealed. */
  const audienceHooks = (slide: Slide | undefined): SlideFaceHooks => {
    const sequence = animationSequence(slide?.elements ?? []);
    const order = sequence.map((item) => item.id);
    return {
      box: (el) => {
        const phase = exitConcealed(el.id, sequence, showCursor.revealed)
          ? "hidden"
          : audiencePhase(el, showCursor.revealed, order, showCursor.enteringId);
        return {
          className: ` ${audienceClass(phase, el.animation)}`,
          props: {
            "data-element-id": el.id,
            ...(phase === "entering" || phase === "after"
              ? { style: { animationDuration: `${animationEnterMs(el.animationDuration)}ms` } }
              : {}),
            ...(phase === "plain" ? {} : { "data-fade": phase === "hidden" ? "hidden" : "visible" }),
            ...(phase === "hidden" ? { "aria-hidden": true } : {}),
          },
        };
      },
      before: (el) => {
        const hidden = hiddenParagraphIndexes(el, sequence, showCursor.revealed);
        if (!hidden.length) return undefined;
        const css = hidden
          .map(
            (index) =>
              `[data-element-id="${el.id}"] .slide-para[data-para-index="${index}"]{visibility:hidden}`,
          )
          .join("");
        return <style>{css}</style>;
      },
    };
  };

  const slideHeading = (slide: Slide) => slideTitleText(slide.elements, deck.master?.elements ?? []);
  const frame = showFrame({
    slideIndex: presentSlideIndex,
    slideCount: deck.slideOrder.length,
    notes: presentSlide?.notes ?? "",
    nextTitle: nextSlideTitle(
      upcoming,
      nextPresentSlide ? slideHeading(nextPresentSlide) : undefined,
    ),
    elapsedMs: elapsedSeconds * 1000,
    blank: Boolean(blankScreen),
  });
  useEffect(() => {
    if (!presenting) return;
    const popup = audiencePopup.current;
    if (!popup || popup.closed) return;
    const slide = deck.slides[deck.slideOrder[presentSlideIndex]];
    openAudienceScreen(
      popup,
      frame.audience,
      slide ? audienceLines(slide.elements, showCursor.revealed, deck.master?.elements ?? []) : [],
    );
  }, [presenting, presentSlideIndex, blankScreen, deck, showCursor.revealed]);

  return {
    showMotionClass,
    presentSlide,
    nextPresentSlide,
    cannotAdvance,
    cannotRetreat,
    fadeWaiting,
    elapsedLabel,
    audienceHooks,
    frame,
  };
}

export type ShowPlayback = ReturnType<typeof useShowPlayback>;
