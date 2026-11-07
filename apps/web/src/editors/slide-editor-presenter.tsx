import { ChevronLeft, ChevronRight, StickyNote, X } from "lucide-react";
import { useState } from "react";
import { filename, type SlideFile } from "@suiteleaf/core";
import { exportBinary } from "../storage";
import { audienceLines, openAudienceScreen } from "./audience-screen";
import { PresenterNextSlide } from "./slide-master-ui";
import { SlideshowRecorder } from "./slide-record";
import { readMaster } from "./slide-master";
import { transitionMs } from "./slide-theme";
import { SlideStill } from "./slide-surface";
import type { MarpPages } from "./slide-marp-backdrop";
import type { SlidesEditorState } from "./slide-editor-state";
import type { ShowControls, ShowPlayback } from "./slide-editor-show";

/** The slideshow over the whole screen, with speaker notes and its controls. */
export function SlideShowOverlay({
  state,
  file,
  marpShow,
  marpPages,
  controls,
  playback,
}: {
  state: SlidesEditorState;
  file: SlideFile;
  marpShow: boolean;
  marpPages: MarpPages | null;
  controls: ShowControls;
  playback: ShowPlayback;
}) {
  const [audienceError, setAudienceError] = useState("");
  const {
    deck, presentSlideIndex, showSpeakerNotes, setShowSpeakerNotes, reducedMotion, moveShowRef,
    blankScreen, timerPaused, setTimerPaused, showStartedAt, setShowStartedAt, frozenElapsedMs,
    setFrozenElapsedMs, clock, setClock, showCursor, audiencePopup, recording, setRecording,
    recorderRef,
  } = state;
  const { overlayRef, controlsVisible, controlsHoveredRef, endShow, showFullscreenRef } = controls;
  const {
    showMotionClass,
    presentSlide,
    nextPresentSlide,
    cannotAdvance,
    cannotRetreat,
    fadeWaiting,
    elapsedLabel,
    audienceHooks,
    frame,
  } = playback;
  return (
    <div
      ref={overlayRef}
      className={`presenter-overlay ${showSpeakerNotes ? "with-notes" : ""} ${controlsVisible ? "" : "idle"}`}
      role="dialog"
      aria-modal="true"
      aria-label="Slideshow"
      tabIndex={-1}
    >
      <div
        key={marpShow && !showMotionClass ? "marp" : presentSlideIndex}
        className={`presenter-slide-box show-slide${showMotionClass}`}
        data-audience-slide={frame.audience.slideIndex}
        data-audience-blank={frame.audience.blank ? "yes" : "no"}
        style={{
          backgroundColor:
            presentSlide?.background?.color ||
            deck.master?.background?.color ||
            "#ffffff",
          ["--deck-motion" as string]: `${transitionMs(presentSlide?.transition, reducedMotion)}ms`,
          aspectRatio: `${deck.width || 960} / ${deck.height || 540}`,
          width: showSpeakerNotes
            ? `min(62vw, calc((100vh - 112px) * ${deck.width || 960} / ${deck.height || 540}))`
            : `min(100vw, calc(100vh * ${deck.width || 960} / ${deck.height || 540}))`,
        }}
        onClick={() => moveShowRef.current("next")}
      >
        {(marpShow
          ? [presentSlideIndex - 1, presentSlideIndex, presentSlideIndex + 1]
          : [presentSlideIndex]
        )
          .filter((n) => n >= 0 && n < deck.slideOrder.length)
          .map((n) =>
            n === presentSlideIndex ? (
              <SlideStill
                key={deck.slideOrder[n] ?? n}
                deck={deck}
                slide={presentSlide}
                index={n}
                pages={marpPages}
                hooks={audienceHooks(presentSlide)}
                interactive
              />
            ) : (
              <SlideStill
                key={deck.slideOrder[n]}
                deck={deck}
                slide={deck.slides[deck.slideOrder[n]]}
                index={n}
                pages={marpPages}
                className="slide-still-waiting"
              />
            ),
          )}
        {blankScreen ? (
          <div
            className="presenter-blank"
            style={{ backgroundColor: blankScreen }}
          />
        ) : null}
      </div>

      {showSpeakerNotes ? (
        <aside className="presenter-notes-panel" aria-label="Speaker notes">
          <div className="presenter-notes-header">
            <span>Speaker notes</span>
            <span
              className="presenter-timer"
              title="Time since the show started"
            >
              {elapsedLabel}
            </span>
            <button
              type="button"
              onClick={() => {
                if (timerPaused) {
                  setShowStartedAt(Date.now() - frozenElapsedMs);
                  setClock(Date.now());
                  setTimerPaused(false);
                  return;
                }
                setFrozenElapsedMs(Math.max(0, clock - showStartedAt));
                setTimerPaused(true);
              }}
            >
              {timerPaused ? "Resume timer" : "Pause timer"}
            </button>
          </div>
          <div className="presenter-notes-text">
            {frame.presenter.notes.trim() || (
              <span className="presenter-notes-empty">
                No speaker notes for this slide.
              </span>
            )}
          </div>
          <div className="presenter-next">
            {frame.presenter.nextTitle ? (
              <>
                <span>Next: {frame.presenter.nextTitle}</span>
                <PresenterNextSlide deck={deck}>
                  <SlideStill
                    deck={deck}
                    slide={nextPresentSlide}
                    index={presentSlideIndex + 1}
                    pages={marpPages}
                  />
                </PresenterNextSlide>
              </>
            ) : (
              <span>End of presentation</span>
            )}
          </div>
        </aside>
      ) : null}

      {/* Presenter bottom floating controls */}
      <div
        className={`presenter-controls ${controlsVisible ? "visible" : "hidden"}`}
        onMouseEnter={() => {
          controlsHoveredRef.current = true;
        }}
        onMouseLeave={() => {
          controlsHoveredRef.current = false;
        }}
      >
        <button
          type="button"
          onClick={() => moveShowRef.current("prev")}
          disabled={cannotRetreat}
          title={
            showCursor.revealed > 0
              ? "Hide fade-in (Left arrow)"
              : "Previous slide (Left arrow)"
          }
        >
          <ChevronLeft size={16} />
          Previous
        </button>
        <span className="presenter-counter">
          Slide {presentSlideIndex + 1} of {deck.slideOrder.length}
        </span>
        <button
          type="button"
          onClick={() => {
            setAudienceError("");
            // Switching to a second window can leave fullscreen. It must not end the show.
            const wasFullscreen = showFullscreenRef.current;
            showFullscreenRef.current = false;
            try {
              const popup = audiencePopup.current && !audiencePopup.current.closed
                ? audiencePopup.current
                : window.open("about:blank", "_blank");
              audiencePopup.current = popup;
              if (!openAudienceScreen(
                popup,
                frame.audience,
                presentSlide ? audienceLines(presentSlide.elements, showCursor.revealed, deck.master?.elements ?? []) : [],
              )) {
                showFullscreenRef.current = wasFullscreen && !!document.fullscreenElement;
                setAudienceError("Could not open the audience screen. Allow pop-ups for SuiteLeaf and try again.");
              } else if (wasFullscreen && document.fullscreenElement) {
                void document.exitFullscreen().catch(() => {});
              }
            } catch {
              showFullscreenRef.current = wasFullscreen && !!document.fullscreenElement;
              audiencePopup.current = null;
              setAudienceError("Could not open the audience screen. Allow pop-ups for SuiteLeaf and try again.");
            }
          }}
        >
          Audience screen
        </button>
        <button
          type="button"
          onClick={() => moveShowRef.current("next")}
          disabled={cannotAdvance}
          title={
            fadeWaiting ? "Fade in (Right arrow)" : "Next slide (Right arrow)"
          }
        >
          Next
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          className="presenter-notes-btn"
          aria-pressed={recording}
          onClick={() => {
            if (recording) {
              const recorder = recorderRef.current;
              recorderRef.current = null;
              setRecording(false);
              void recorder?.stop().then(async (blob) => {
                const bytes = new Uint8Array(await blob.arrayBuffer());
                if (!bytes.length) return;
                await exportBinary(
                  filename(file.title, "webm"),
                  bytes,
                  blob.type || "video/webm",
                );
              });
              return;
            }
            const recorder = new SlideshowRecorder(deck.width || 960, deck.height || 540);
            const master = readMaster(deck);
            recorder.paint(
              presentSlide,
              deck.width || 960,
              deck.height || 540,
              master.elements,
              master.background?.color,
            );
            try {
              recorder.start();
            } catch {
              return;
            }
            recorderRef.current = recorder;
            setRecording(true);
          }}
        >
          {recording ? "Stop recording" : "Record"}
        </button>
        <button
          type="button"
          className="presenter-notes-btn"
          aria-pressed={showSpeakerNotes}
          onClick={() => setShowSpeakerNotes((prev) => !prev)}
          title="Show or hide speaker notes (S)"
        >
          <StickyNote size={15} /> Notes
        </button>
        <button
          type="button"
          className="exit-present-btn"
          onClick={endShow}
          title="Exit presentation (Esc)"
        >
          <X size={15} /> Exit
        </button>
        {controls.castConnected ? <button type="button" onClick={controls.stopCast}>Stop casting</button> : null}
      </div>
      {controls.castError ? <p className="presenter-audience-error" role="alert">{controls.castError}</p> : null}
      {audienceError ? <p className="presenter-audience-error" role="alert">{audienceError}</p> : null}
    </div>
  );
}
