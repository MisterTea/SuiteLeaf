import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { dashMultipliers, type SlideElement } from "@suiteleaf/core";
import { rotatedPictureFrame, turnedPictureTransform } from "./slide-picture-frame";

/**
 * A rotated rectangle whose pre-turn box hangs off the slide is fragmented by
 * print, so the turn happens around the clipped center and a footer bar lands
 * mid-slide. The outer box is the axis-aligned result. The shape turns inside
 * an SVG, the same way a rotated picture does.
 */
export function rotatedShapePrintable(el: SlideElement) {
  return (
    el.type === "shape" &&
    !!el.rotation &&
    el.shapeType !== "line" &&
    el.shapeType !== "arrow" &&
    !el.marpHtml &&
    !(el.fill && el.fill.includes("gradient("))
  );
}

export function rotatedShapeFrameStyle(
  el: SlideElement,
  slideWidth: number,
  slideHeight: number,
): CSSProperties {
  const frame = rotatedPictureFrame(el);
  return {
    position: "absolute",
    left: `${(frame.x / slideWidth) * 100}%`,
    top: `${(frame.y / slideHeight) * 100}%`,
    width: `${(frame.width / slideWidth) * 100}%`,
    height: `${(frame.height / slideHeight) * 100}%`,
    overflow: "visible",
    background: "transparent",
    border: "none",
    ...shapeDropShadow(el),
  };
}

/** A DrawingML outer shadow, scaled with the slide's point size. */
export function shapeDropShadow(el: {
  shadow?: { x: number; y: number; blur: number; color: string };
}): CSSProperties {
  const shadow = el.shadow;
  if (!shadow) return {};
  const px = (value: number) => `calc(${value} * var(--slide-pt, 1) * 1px)`;
  return {
    filter: `drop-shadow(${px(shadow.x)} ${px(shadow.y)} ${px(shadow.blur)} ${shadow.color})`,
  };
}

export function RotatedSlideShape({
  el,
  slideWidth,
  slideHeight,
  className,
  boxProps,
  before,
  after,
}: {
  el: SlideElement;
  slideWidth: number;
  slideHeight: number;
  className: string;
  boxProps?: HTMLAttributes<HTMLDivElement>;
  before?: ReactNode;
  after?: ReactNode;
}) {
  const frame = rotatedPictureFrame(el);
  const dashParts = dashMultipliers(el.strokeStyle);
  const dash = dashParts
    ? dashParts.map((part) => part * (el.strokeWidth || 1)).join(" ")
    : undefined;
  const paint = el.fill || (el.shapeType === "line" ? "transparent" : "#e2e8f0");
  const stroke = el.stroke || "none";
  const strokeWidth = el.stroke ? el.strokeWidth || 1 : 0;
  const body =
    el.shapeType === "ellipse" ? (
      <ellipse
        cx={frame.shapeX + el.width / 2}
        cy={frame.shapeY + el.height / 2}
        rx={el.width / 2}
        ry={el.height / 2}
        fill={paint}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
    ) : (
      <rect
        x={frame.shapeX}
        y={frame.shapeY}
        width={el.width}
        height={el.height}
        rx={el.radius || 0}
        ry={el.radius || 0}
        fill={paint}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
    );
  return (
    <div {...boxProps} className={className} style={{ ...rotatedShapeFrameStyle(el, slideWidth, slideHeight), ...boxProps?.style }}>
      {before}
      <svg
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height: "100%", overflow: "visible" }}
      >
        <g transform={turnedPictureTransform(el, frame)}>{body}</g>
      </svg>
      {after}
    </div>
  );
}
