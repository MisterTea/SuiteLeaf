import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { isSlmediaUri, type SlideElement } from "@suiteleaf/core";
import { mediaBlobStore } from "../media-blob-store";

const CONTROLS_AUTO_HIDE_MS = 3000;

/** SuiteDrive item ID for the currently open presentation, so `slmedia://` refs can fetch missing blobs. */
export const SlideDriveItemContext = createContext<string | undefined>(undefined);

/** A clip stored in the file. A blob address plays where a long data address does not. */
function playableDataUrl(src: string | undefined): string | undefined {
  if (!src?.startsWith("data:")) return src;
  const comma = src.indexOf(",");
  if (comma < 0) return src;
  const meta = src.slice(5, comma);
  const mime = meta.split(";")[0] || "application/octet-stream";
  try {
    const payload = src.slice(comma + 1);
    const binary = meta.includes(";base64") ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i) & 0xff;
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return src;
  }
}

export function usePlayableUrl(src: string | undefined) {
  const driveItemId = useContext(SlideDriveItemContext);
  const isSlmedia = Boolean(src && isSlmediaUri(src));
  const dataUrl = useMemo(() => (isSlmedia ? undefined : playableDataUrl(src)), [src, isSlmedia]);
  const [slmediaUrl, setSlmediaUrl] = useState<string | undefined>(() =>
    isSlmedia && src ? (mediaBlobStore.peekObjectUrl(src) ?? undefined) : undefined,
  );

  useEffect(() => {
    if (!isSlmedia || !src) {
      setSlmediaUrl(undefined);
      return;
    }
    const immediate = mediaBlobStore.peekObjectUrl(src);
    if (immediate) {
      setSlmediaUrl(immediate);
      return;
    }
    let cancelled = false;
    void mediaBlobStore
      .resolveObjectUrl(src, {
        remote: driveItemId ? { itemId: driveItemId } : undefined,
      })
      .then((resolved) => {
        if (!cancelled && resolved) setSlmediaUrl(resolved);
      });
    return () => {
      cancelled = true;
    };
  }, [src, isSlmedia, driveItemId]);

  useEffect(
    () => () => {
      if (dataUrl?.startsWith("blob:")) URL.revokeObjectURL(dataUrl);
    },
    [dataUrl],
  );
  return isSlmedia ? slmediaUrl : dataUrl;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/** Play an audio clip on this object. The slideshow slide advances on click, so stop there. */
function playAudioClip(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.stopPropagation();
  const media = event.currentTarget.parentElement?.querySelector("audio");
  if (!(media instanceof HTMLMediaElement)) return;
  void media.play().catch(() => {});
}

/** A caption track for the spoken words. The media address is not included. */
export function captionTrack(caption: string): string {
  const vtt = `WEBVTT\n\n00:00:00.000 --> 00:05:00.000\n${caption.trim()}\n`;
  return `data:text/vtt,${encodeURIComponent(vtt)}`;
}

/** Media player for slides. Videos use YouTube-style auto-hiding controls without a filename overlay. */
export function SlideMediaControls({ element }: { element: SlideElement }) {
  const video = element.type === "video";
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [playing, setPlaying] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);

  const driveItemId = useContext(SlideDriveItemContext);
  const lazyVideo = video && Boolean(element.src && isSlmediaUri(element.src));
  const immediateSrc = usePlayableUrl(lazyVideo ? undefined : element.src);
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>();
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [videoError, setVideoError] = useState("");
  const playWhenReady = useRef(false);
  const src = lazyVideo ? loadedSrc : immediateSrc;
  const poster = usePlayableUrl(element.poster);
  const name = element.alt?.trim() || (video ? "Video" : "Audio");
  const caption = element.caption?.trim() ?? "";
  const track = caption ? (
    <track kind="captions" srcLang="en" label="Captions" src={captionTrack(caption)} default />
  ) : null;

  const clearHideTimer = useCallback(() => {
    clearTimeout(hideTimer.current);
    hideTimer.current = undefined;
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimer.current = setTimeout(() => {
      setControlsVisible(false);
    }, CONTROLS_AUTO_HIDE_MS);
  }, [clearHideTimer]);

  useEffect(() => clearHideTimer, [clearHideTimer]);

  useEffect(() => {
    if (!playWhenReady.current || !src) return;
    playWhenReady.current = false;
    const media = videoRef.current;
    if (!media) return;
    void media.play().catch(() => setVideoError("This video could not be played."));
  }, [src]);

  if (!video) {
    return (
      <>
        <span className="slide-media-name">{name}</span>
        <button
          type="button"
          className="slide-media-play"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={playAudioClip}
        >
          Play audio
        </button>
        <audio src={src} preload="auto">
          {track}
        </audio>
      </>
    );
  }

  const showControls = !playing || controlsVisible;
  const videoAction = loadingVideo
    ? "Loading video"
    : videoError
      ? "Retry video"
      : playing
        ? "Pause video"
        : "Play video";
  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  const togglePlay = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const media = videoRef.current;
    if (!media || !media.isConnected || loadingVideo) return;
    if (!media.paused && !media.ended) {
      media.pause();
      return;
    }
    if (lazyVideo && !src && element.src) {
      setLoadingVideo(true);
      setVideoError("");
      playWhenReady.current = true;
      void mediaBlobStore
        .resolveObjectUrl(element.src, {
          remote: driveItemId ? { itemId: driveItemId } : undefined,
        })
        .then((url) => {
          if (!url) {
            playWhenReady.current = false;
            setVideoError("This video could not be loaded.");
            return;
          }
          setLoadedSrc(url);
        })
        .finally(() => setLoadingVideo(false));
      return;
    }
    void media.play().catch(() => setVideoError("This video could not be played."));
  };

  const toggleTap = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!playing) return;
    if (controlsVisible) {
      clearHideTimer();
      setControlsVisible(false);
    } else {
      setControlsVisible(true);
      scheduleHide();
    }
  };

  const toggleMute = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const media = videoRef.current;
    if (!media) return;
    media.muted = !media.muted;
    setMuted(media.muted);
    if (playing) scheduleHide();
  };

  const seek = (next: number) => {
    const media = videoRef.current;
    if (!media) return;
    media.currentTime = next;
    setCurrentTime(next);
    if (playing) scheduleHide();
  };

  return (
    <>
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        aria-label={name}
        preload={src ? "auto" : "none"}
        playsInline
        onPlay={() => {
          setPlaying(true);
          setControlsVisible(false);
          clearHideTimer();
        }}
        onPause={() => {
          setPlaying(false);
          setControlsVisible(true);
          clearHideTimer();
        }}
        onEnded={() => {
          setPlaying(false);
          setControlsVisible(true);
          clearHideTimer();
        }}
        onEmptied={() => {
          setPlaying(false);
          setControlsVisible(true);
          setCurrentTime(0);
          setDuration(0);
          clearHideTimer();
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
      >
        {track}
      </video>
      {playing ? (
        <div
          className="slide-video-tap"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={toggleTap}
        />
      ) : null}
      <div
        className={`slide-video-controls${showControls ? " visible" : " hidden"}`}
        data-controls={showControls ? "visible" : "hidden"}
        aria-hidden={!showControls}
      >
        <button
          type="button"
          className="slide-media-play slide-video-center-play"
          aria-label={videoError || videoAction}
          title={videoError || videoAction}
          tabIndex={showControls ? 0 : -1}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={togglePlay}
        >
          {playing ? <Pause size={24} aria-hidden="true" /> : <Play size={24} aria-hidden="true" />}
        </button>
        <div
          className="slide-video-bar"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <input
            type="range"
            className="slide-video-scrubber"
            aria-label="Seek video"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(currentTime, duration || 1)}
            disabled={duration <= 0}
            tabIndex={showControls ? 0 : -1}
            style={{ "--video-progress": `${progress}%` } as React.CSSProperties}
            onChange={(event) => seek(Number(event.target.value))}
          />
          <div className="slide-video-bar-row">
            <span className="slide-video-time">
              {formatTime(currentTime)}
              {duration > 0 ? ` / ${formatTime(duration)}` : ""}
            </span>
            <button
              type="button"
              className="slide-video-mute"
              aria-label={muted ? "Unmute video" : "Mute video"}
              title={muted ? "Unmute video" : "Mute video"}
              tabIndex={showControls ? 0 : -1}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={toggleMute}
            >
              {muted ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
