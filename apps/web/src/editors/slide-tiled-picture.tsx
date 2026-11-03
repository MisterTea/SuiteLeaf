import { useId } from "react";
import type { SlideElement } from "@suiteleaf/core";

type Tile = NonNullable<SlideElement["tile"]>;

/**
 * A DrawingML tile repeats in the element's own slide units.
 * An img with object-fit stretches one copy across the shape, which turns a
 * grain texture into a single blotch.
 */
export function TiledPictureFill({
  src,
  tile,
  shape,
  label,
}: {
  src: string;
  tile: Tile;
  shape: { width: number; height: number };
  label: string;
}) {
  // Print puts every slide in one document. A pattern id taken from the alt
  // text ("Slide background") would make later tiles reuse the first image.
  const id = `tile${useId().replace(/[^A-Za-z0-9]/g, "")}`;
  const flipX = tile.flip === "x" || tile.flip === "xy";
  const flipY = tile.flip === "y" || tile.flip === "xy";
  const transform = flipX || flipY
    ? `translate(${flipX ? tile.width : 0} ${flipY ? tile.height : 0}) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})`
    : undefined;
  return (
    <svg
      viewBox={`0 0 ${shape.width} ${shape.height}`}
      preserveAspectRatio="none"
      style={{ display: "block", width: "100%", height: "100%" }}
      role="img"
      aria-label={label}
    >
      <defs>
        <pattern
          id={id}
          patternUnits="userSpaceOnUse"
          x={tile.x}
          y={tile.y}
          width={tile.width}
          height={tile.height}
        >
          <image
            href={src}
            width={tile.width}
            height={tile.height}
            preserveAspectRatio="none"
            transform={transform}
          />
        </pattern>
      </defs>
      <rect width={shape.width} height={shape.height} fill={`url(#${id})`} />
    </svg>
  );
}
