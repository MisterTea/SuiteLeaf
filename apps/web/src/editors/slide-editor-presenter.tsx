import { marpAudienceDocument, marpFragmentStep, showBuildIds } from "./slide-marp-fragments";
import { ArrowLeft, ArrowRight, Monitor, Pause, Play, StickyNote, Video, X } from "lucide-react";
import { useSlideMobileSwipe } from "./slide-mobile-swipe";
import { useState } from "react";
import { filename, type SlideFile } from "@suiteleaf/core";
import { exportBinary } from "../storage";
import { audienceLines, openAudienceScreen } from "./audience-screen";
import { PresenterNextSlide } from "./slide-master-ui";
import { SlideshowRecorder } from "./slide-record";
import { masterForSlide } from "./slide-master";
import { slideBackground } from "./slide-surface-paint";
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
  useSlideMobileSwipe(overlayRef, (direction) => {
    moveShowRef.current(direction === 1 ? "next" : "prev");
  }, true);
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
      style={{ touchAction: "pan-y pinch-zoom" }}
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
          backgroundColor: slideBackground(deck, presentSlide),
          ["--deck-motion" as string]: `${transitionMs(presentSlide?.transition, reducedMotion)}ms`,
          aspectRatio: `${deck.width || 960} / ${deck.height || 540}`,
          width: showSpeakerNotes
            ? `min(62vw, calc((100vh - 112px) * ${deck.width || 960} / ${deck.height || 540}))`
            : `min(100vw, calc(100vh * ${deck.width || 960} / ${deck.height || 540}))`,
        }}
        onClick={() => {
          window.getSelection()?.removeAllRanges();
          moveShowRef.current("next");
        }}
        onMouseDown={() => {
          window.getSelection()?.removeAllRanges();
        }}
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
                fragmentStep={marpFragmentStep(deck, n, showCursor.revealed)}
              />
            ) : (
              <SlideStill
                key={deck.slideOrder[n]}
                deck={deck}
                slide={deck.slides[deck.slideOrder[n]]}
                index={n}
                pages={marpPages}
                className="slide-still-waiting"
                fragmentStep={marpFragmentStep(
                  deck,
                  n,
                  n < presentSlideIndex ? showBuildIds(deck, n).length : 0,
                )}
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
            <div className="presenter-notes-heading">
              <StickyNote size={14} aria-hidden="true" />
              <span>Speaker notes</span>
            </div>
            <span
              className="presenter-timer"
              title="Time since the show started"
            >
              {elapsedLabel}
            </span>
            <button
              type="button"
              className={`presenter-timer-btn${timerPaused ? " paused" : ""}`}
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
              title={timerPaused ? "Resume presentation timer" : "Pause presentation timer"}
            >
              {timerPaused ? <Play size={11} aria-hidden="true" /> : <Pause size={11} aria-hidden="true" />}
              <span>{timerPaused ? "Resume timer" : "Pause timer"}</span>
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
                <div className="presenter-next-header">
                  <span>Next: {frame.presenter.nextTitle}</span>
                </div>
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
              <div className="presenter-next-end">
                <span>End of presentation</span>
              </div>
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
          className="presenter-nav-btn"
          aria-label="Previous"
          onClick={() => moveShowRef.current("prev")}
          disabled={cannotRetreat}
          title={
            showCursor.revealed > 0
              ? "Hide fade-in (Left arrow)"
              : "Previous slide (Left arrow)"
          }
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <span className="presenter-counter">
          Slide {presentSlideIndex + 1} of {deck.slideOrder.length}
        </span>
        <button
          type="button"
          className="presenter-nav-btn"
          aria-label="Next"
          onClick={() => moveShowRef.current("next")}
          disabled={cannotAdvance}
          title={
            fadeWaiting ? "Fade in (Right arrow)" : "Next slide (Right arrow)"
          }
        >
          <ArrowRight size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="presenter-audience-btn"
          title="Audience display screen"
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
                presentSlide ? audienceLines(presentSlide.elements, showCursor.revealed, masterForSlide(deck, presentSlide).elements) : [],
                marpPages?.pages[presentSlideIndex] ? marpAudienceDocument(marpPages.pages[presentSlideIndex].plain, marpFragmentStep(deck, presentSlideIndex, showCursor.revealed)) : undefined,
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
          <Monitor size={14} aria-hidden="true" />
          <span>Audience screen</span>
        </button>
        <button
          type="button"
          className="presenter-notes-btn presenter-record-btn"
          aria-pressed={recording}
          title={recording ? "Stop recording presentation" : "Record presentation video"}
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
            const master = masterForSlide(deck, presentSlide);
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
          <Video size={14} aria-hidden="true" />
          <span>{recording ? "Stop recording" : "Record"}</span>
        </button>
        <button
          type="button"
          className="presenter-notes-btn"
          aria-pressed={showSpeakerNotes}
          onClick={() => setShowSpeakerNotes((prev) => !prev)}
          title="Show or hide speaker notes (S)"
        >
          <StickyNote size={15} />
          <span>Notes</span>
          <kbd className="presenter-key-badge" aria-hidden="true">S</kbd>
        </button>
        <button
          type="button"
          className="exit-present-btn"
          onClick={endShow}
          title="Exit presentation (Esc)"
        >
          <X size={15} />
          <span>Exit</span>
          <kbd className="presenter-key-badge" aria-hidden="true">Esc</kbd>
        </button>
        {controls.castConnected ? <button type="button" onClick={controls.stopCast}>Stop casting</button> : null}
      </div>
      {controls.castError ? <p className="presenter-audience-error" role="alert">{controls.castError}</p> : null}
      {audienceError ? <p className="presenter-audience-error" role="alert">{audienceError}</p> : null}
    </div>
  );
}
