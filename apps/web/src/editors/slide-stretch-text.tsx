import { useLayoutEffect, useState } from "react";
import type { SlideElement } from "@suiteleaf/core";
import { wordArtFill, wordArtFrame, type GlyphInk } from "@suiteleaf/core";

const MEASURE = 100;

type Frame = { viewBox: string; glyphs: { x: number; y: number; text: string }[] };

function inkOf(metrics: TextMetrics): GlyphInk {
  return {
    left: metrics.actualBoundingBoxLeft || 0,
    right: metrics.actualBoundingBoxRight || metrics.width || 0,
    ascent: metrics.actualBoundingBoxAscent || metrics.fontBoundingBoxAscent || 0,
    descent: metrics.actualBoundingBoxDescent || metrics.fontBoundingBoxDescent || 0,
  };
}

/** Letters of a plain WordArt warp, stretched to the shape instead of the stored size. */
export function StretchedWordArt({ el }: { el: SlideElement }) {
  const text = el.content || "";
  const family = el.fontFamily || "Arial";
  const [frame, setFrame] = useState<Frame | undefined>();

  useLayoutEffect(() => {
    const lines = text.split("\n");
    let cancel = false;
    const measure = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const weight = el.bold ? "700" : "400";
      const style = el.italic ? "italic" : "normal";
      ctx.font = `${style} ${weight} ${MEASURE}px ${JSON.stringify(family)}`;
      const usable = lines
        .map((line) => ({ line, ink: inkOf(ctx.measureText(line || " ")) }))
        .filter((item) => item.ink.left + item.ink.right > 0 && item.ink.ascent + item.ink.descent > 0);
      const next = wordArtFrame(usable.map((item) => item.ink));
      if (!cancel && next)
        setFrame({
          viewBox: next.viewBox,
          glyphs: next.glyphs.map((glyph, index) => ({ ...glyph, text: usable[index]?.line || " " })),
        });
    };
    measure();
    const fonts = document.fonts;
    if (!fonts?.load) return () => { cancel = true; };
    void fonts.load(`${MEASURE}px ${JSON.stringify(family)}`).then(() => {
      if (!cancel) measure();
    }).catch(() => {});
    return () => {
      cancel = true;
    };
  }, [text, family, el.bold, el.italic]);

  if (!frame) return null;
  return (
    <svg
      className="slide-text-face"
      data-stretch-text="true"
      width="100%"
      height="100%"
      viewBox={frame.viewBox}
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0 }}
    >
      {frame.glyphs.map((glyph, index) => (
        <text
          key={index}
          x={glyph.x}
          y={glyph.y}
          fontSize={MEASURE}
          fontFamily={family}
          fontWeight={el.bold ? 700 : 400}
          fontStyle={el.italic ? "italic" : "normal"}
            fill={wordArtFill(el.color, el.runs)}
        >
          {glyph.text}
        </text>
      ))}
    </svg>
  );
}
