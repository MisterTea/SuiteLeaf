import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { SlideElement } from "@suiteleaf/core";
import { rotatedPictureFrame, turnedPictureTransform } from "./slide-picture-frame";

type Frame = ReturnType<typeof rotatedPictureFrame>;

/**
 * A picture clipped to a preset. A rotated one turns inside the print frame:
 * a CSS rotate on the clip paints the pre-rotation box.
 */
export function ClippedSlidePicture({
  el,
  media,
  turnedFrame,
  style,
  inFrame,
  view,
  extra,
  before,
  after,
}: {
  el: SlideElement;
  media: string;
  turnedFrame: Frame | undefined;
  style: CSSProperties;
  inFrame: (node: ReactNode) => ReactNode;
  view: { props?: HTMLAttributes<HTMLDivElement> };
  extra: string;
  before?: ReactNode;
  after?: ReactNode;
}) {
  const left = (el.cropLeft ?? 0) / 100;
  const top = (el.cropTop ?? 0) / 100;
  const right = (el.cropRight ?? 0) / 100;
  const bottom = (el.cropBottom ?? 0) / 100;
  const spanX = 1 - left - right;
  const spanY = 1 - top - bottom;
  const scaleX = spanX > 0 ? 1 / spanX : 1;
  const scaleY = spanY > 0 ? 1 / spanY : 1;
  const clipId = `pic-${el.id.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const clipped = (
    <>
      <clipPath id={clipId} clipRule="evenodd">
        <path d={el.clipPath} />
      </clipPath>
      <image
        href={media}
        x={-left * scaleX * el.width}
        y={-top * scaleY * el.height}
        width={scaleX * el.width}
        height={scaleY * el.height}
        preserveAspectRatio="none"
        clipPath={`url(#${clipId})`}
      />
    </>
  );
  const graphic = turnedFrame ? (
    <svg
      viewBox={`0 0 ${turnedFrame.width} ${turnedFrame.height}`}
      preserveAspectRatio="none"
      style={{ display: "block", width: "100%", height: "100%", overflow: "visible" }}
    >
      <g
        transform={turnedPictureTransform(el, turnedFrame)}
      >
        <svg
          x={turnedFrame.shapeX}
          y={turnedFrame.shapeY}
          width={el.width}
          height={el.height}
          viewBox={`0 0 ${el.width} ${el.height}`}
          overflow="hidden"
        >
          {clipped}
        </svg>
      </g>
    </svg>
  ) : (
    inFrame(
      <svg
        viewBox={`0 0 ${el.width} ${el.height}`}
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height: "100%" }}
      >
        {clipped}
      </svg>,
    )
  );
  return (
    <div key={el.id} {...view.props} className={`slide-element slide-image${extra}`} style={style}>
      {before}
      {graphic}
      {after}
    </div>
  );
}
