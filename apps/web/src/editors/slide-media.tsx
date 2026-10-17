import type { MouseEvent } from "react";
import type { SlideElement } from "@suiteleaf/core";

/** Play the clip on this object. The slideshow slide itself advances on click, so this stops there. */
function playClip(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.stopPropagation();
  const media = event.currentTarget.parentElement?.querySelector("audio, video");
  if (media instanceof HTMLMediaElement) void media.play().catch(() => {});
}

/** File name plus a play button. Video also shows the picture. */
export function SlideMediaControls({ element }: { element: SlideElement }) {
  const video = element.type === "video";
  const name = element.alt?.trim() || (video ? "Video" : "Audio");
  return (
    <>
      {video ? <video src={element.src} preload="auto" playsInline /> : null}
      <span className="slide-media-name">{name}</span>
      <button
        type="button"
        className="slide-media-play"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={playClip}
      >
        {video ? "Play video" : "Play audio"}
      </button>
      {video ? null : <audio src={element.src} preload="auto" />}
    </>
  );
}
