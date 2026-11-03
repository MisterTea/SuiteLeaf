import { useEffect, useMemo, type MouseEvent } from "react";
import type { SlideElement } from "@suiteleaf/core";

/** A clip stored in the file. A blob address plays where a long data address does not. */
function playableUrl(src: string | undefined): string | undefined {
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

function usePlayableUrl(src: string | undefined) {
  const url = useMemo(() => playableUrl(src), [src]);
  useEffect(
    () => () => {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

/** Play the clip on this object. The slideshow slide itself advances on click, so this stops there. */
function playClip(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.stopPropagation();
  const media =
    event.currentTarget.parentElement?.querySelector("audio, video");
  if (media instanceof HTMLMediaElement) void media.play().catch(() => {});
}

/** A caption track for the spoken words. The media address is not included. */
export function captionTrack(caption: string): string {
  const vtt = `WEBVTT\n\n00:00:00.000 --> 00:05:00.000\n${caption.trim()}\n`;
  return `data:text/vtt,${encodeURIComponent(vtt)}`;
}

/** File name plus a play button. Video also shows the picture. */
export function SlideMediaControls({ element }: { element: SlideElement }) {
  const video = element.type === "video";
  const src = usePlayableUrl(element.src);
  const name = element.alt?.trim() || (video ? "Video" : "Audio");
  const caption = element.caption?.trim() ?? "";
  const track = caption ? (
    <track kind="captions" srcLang="en" label="Captions" src={captionTrack(caption)} default />
  ) : null;
  return (
    <>
      {video ? (
        <video
          src={src}
          poster={element.poster}
          preload="auto"
          playsInline
        >
          {track}
        </video>
      ) : null}
      <span className="slide-media-name">{name}</span>
      <button
        type="button"
        className="slide-media-play"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={playClip}
      >
        {video ? "Play video" : "Play audio"}
      </button>
      {video ? null : (
        <audio src={src} preload="auto">
          {track}
        </audio>
      )}
    </>
  );
}
