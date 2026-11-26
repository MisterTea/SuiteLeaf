import type { CSSProperties, HTMLAttributes } from "react";
import type { SlideElement } from "@suiteleaf/core";
import { croppedPictureStyle, pictureCropBox } from "./slide-picture-crop";
import { rotatedPictureFrame, turnedPictureTransform } from "./slide-picture-frame";
import { usePlayableUrl } from "./slide-media";

/**
 * Print still of a clip. A rotated poster uses the same SVG frame as a
 * picture: Chromium drops a CSS rotate on a box that also clips overflow.
 */
export function SlideMediaStill({
  el,
  posStyle,
  slideWidth,
  slideHeight,
  extra,
  boxProps,
}: {
  el: SlideElement;
  posStyle: CSSProperties;
  slideWidth: number;
  slideHeight: number;
  extra: string;
  boxProps?: HTMLAttributes<HTMLDivElement>;
}) {
  const crop = croppedPictureStyle(el);
  const resolvedPoster = usePlayableUrl(el.poster);
  const turnedFrame = el.rotation ? rotatedPictureFrame(el) : undefined;
  const bare: CSSProperties = {
    background: "transparent",
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: 0,
    padding: 0,
    overflow: "hidden",
  };
  const frameStyle: CSSProperties = turnedFrame
    ? {
        ...posStyle,
        left: `${(turnedFrame.x / slideWidth) * 100}%`,
        top: `${(turnedFrame.y / slideHeight) * 100}%`,
        width: `${(turnedFrame.width / slideWidth) * 100}%`,
        height: `${(turnedFrame.height / slideHeight) * 100}%`,
        transform: undefined,
        ...bare,
      }
    : { ...posStyle, ...bare };
  const cropBox = pictureCropBox(el);
  const alt = el.alt || (el.type === "audio" ? "Audio" : "Video");
  const svgTurned =
    turnedFrame && resolvedPoster ? (
      <svg
        viewBox={`0 0 ${turnedFrame.width} ${turnedFrame.height}`}
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height: "100%", overflow: "visible" }}
      >
        <g transform={turnedPictureTransform(el, turnedFrame)}>
          <svg
            x={turnedFrame.shapeX}
            y={turnedFrame.shapeY}
            width={el.width}
            height={el.height}
            overflow="hidden"
          >
            <image
              href={resolvedPoster}
              x={cropBox.x}
              y={cropBox.y}
              width={cropBox.width}
              height={cropBox.height}
              preserveAspectRatio="none"
            >
              <title>{alt}</title>
            </image>
          </svg>
        </g>
      </svg>
    ) : null;
  return (
    <div
      data-media={el.type}
      {...boxProps}
      className={`slide-element slide-video slide-video-still${extra}`}
      style={frameStyle}
    >
      {svgTurned ??
        (resolvedPoster ? (
          <img
            src={resolvedPoster}
            alt={alt}
            draggable={false}
            style={{ objectFit: "fill", ...crop }}
          />
        ) : (
          <span className="slide-media-name">{alt}</span>
        ))}
    </div>
  );
}
