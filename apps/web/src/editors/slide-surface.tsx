import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type SVGProps,
  type TdHTMLAttributes,
} from "react";
import { dashMultipliers, fontKerning, kernFeature, lineFrame, lineMarkerEnds, officeGradient, paintFontFamily, slidePointScale, straightGradientBackground, svgFillMarkup, type LineMarker, type Presentation, type Slide, type SlideElement, type TextRun } from "@suiteleaf/core";
import { runsToHtml } from "./slide-runs";
import { AutofitBox, autofitSignature } from "./slide-autofit";
import { MarpBackdrop, type MarpPages } from "./slide-marp-backdrop";
import { marpMediaSrc } from "./slide-marp-import";
import { drawnTextKind } from "./slide-drawn-text";
import { MarpCode, MarpMath, MarpRichText } from "./slide-marp-math";
import { inheritedText } from "./slide-master";
import { SlideMasterLayer } from "./slide-master-ui";
import { SlideMediaControls } from "./slide-media";
import { loadEmbeddedFonts } from "./slide-fonts";
import { ClippedSlidePicture } from "./slide-clipped-picture";
import { clipPictureToSlide, croppedPictureStyle, pictureCropBox } from "./slide-picture-crop";
import { clipBoxToSlide, offslideShiftStyle, type SlideClip } from "./slide-print-clip";
import { rotatedPictureFrame, turnedPictureTransform } from "./slide-picture-frame";
import { RotatedSlideShape, rotatedShapePrintable, shapeDropShadow } from "./slide-rotated-shape";
import { SlideMediaStill } from "./slide-media-still";
import { slideCellPaint, tableCellLayout, tableRowHeightCss } from "./slide-table-format";
import { boxFont, SlideTextBody } from "./slide-text";
import { wordArtProps } from "./slide-word-art";
import { StretchedWordArt } from "./slide-stretch-text";
import { TiledPictureFill } from "./slide-tiled-picture";
/** The editor's canvas at its widest. Every other view draws the slide at this size and scales it. */
export const SLIDE_DRAW_WIDTH = 960;

/**
 * SVG fill rejects a CSS gradient and paints the default black. Each ellipse
 * needs its own gradient id; HTML shares one document id space.
 */
function ellipseSvgPaint(id: string, fill: string | undefined) {
  const painted = svgFillMarkup(fill || "#e2e8f0");
  if (!painted.defs) return { inner: "", value: painted.value };
  const grad = `slf-${id.replace(/[^A-Za-z0-9_-]/g, "")}`;
  return {
    inner: painted.defs
      .replaceAll('id="sl-fill"', `id="${grad}"`)
      .replace(/^<defs>/, "")
      .replace(/<\/defs>$/, ""),
    value: `url(#${grad})`,
  };
}

/**
 * A box that misses the slide entirely. Layouts park a footer off the page so
 * PowerPoint hides it; painting it makes print scale the whole deck down.
 */
export function intersectsSlide(
  el: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
) {
  return el.x < width && el.y < height && el.x + el.width > 0 && el.y + el.height > 0;
}

/** A MARP deck laid out from its rendering, sized in slide units. */
export function isFittedDeck(deck: Presentation) {
  return !!deck.marpFit || (!!deck.marp && deck.marpSource !== undefined);
}

export function slideBackground(deck: Presentation, slide: Slide | undefined) {
  return slide?.background?.color || deck.master?.background?.color || "#ffffff";
}

/** Solid colours use background-color. Gradients need the background shorthand. */
export function slideBackgroundPaint(color: string): CSSProperties {
  const straight = straightGradientBackground(color);
  if (straight) return { background: straight };
  return color.includes("gradient(")
    ? { background: officeGradient(color) }
    : { backgroundColor: color };
}

function placedPose(el: SlideElement): CSSProperties {
  const line =
    el.type === "shape" && (el.shapeType === "line" || el.shapeType === "arrow");
  const parts: string[] = [];
  if (el.rotation) parts.push(`rotate(${el.rotation}deg)`);
  if (!line && el.flipH) parts.push("scaleX(-1)");
  if (!line && el.flipV) parts.push("scaleY(-1)");
  return parts.length ? { transform: parts.join(" ") } : {};
}

/** Painted on the slide, not stored in a text box, so editing the title leaves it. */
export function SlideNumber({ n }: { n: number }) {
  return (
    <div className="slide-number" aria-label={`Slide number ${n}`}>
      {n}
    </div>
  );
}

export type SlideBoxProps = HTMLAttributes<HTMLDivElement> & {
  [data: `data-${string}`]: string | number | boolean | undefined;
};

/**
 * What a view adds to the shared drawing. The editor makes boxes selectable and
 * editable; the slideshow fades them in. Without hooks the slide is only drawn.
 */
export type SlideFaceHooks = {
  /** Classes (each with a leading space) and attributes for an element's box. */
  box?: (el: SlideElement) => { className?: string; props?: SlideBoxProps };
  /** Words to show instead of the drawn ones, such as the box being typed in. */
  text?: (el: SlideElement) => ReactNode | undefined;
  before?: (el: SlideElement) => ReactNode;
  after?: (el: SlideElement) => ReactNode;
  cell?: (el: SlideElement, row: number, col: number) => TdHTMLAttributes<HTMLTableCellElement>;
};

const noop = () => {};

/** A text box's words when nobody is typing in it. */
function DrawnWords({ el }: { el: SlideElement }) {
  if (el.stretchText) return <StretchedWordArt el={el} />;
  const kind = drawnTextKind(el);
  if (kind === "code") return <MarpCode source={el.content || ""} language={el.codeLanguage} />;
  if (kind === "math") return <MarpMath source={el.content || ""} />;
  if (kind === "marp" || kind === "rich") return <MarpRichText source={el.content || ""} />;
  if (kind === "runs")
    return (
      <SlideTextBody
        content={el.content}
        runs={el.runs}
        bold={el.bold}
        italic={el.italic}
        underline={el.underline}
        kern={el.kern}
        hang={el.hang}
        fontFamily={el.fontFamily}
        fontSize={el.fontSize}
        editing={false}
        onText={noop}
        onCaret={noop}
      />
    );
  return <div className="element-textarea slide-text-face">{el.content}</div>;
}

/**
 * Scale the picture so the uncropped region fills the box.
 * Vertical offset uses `top`, because a percentage margin is relative to width.
 */
/** A slide-unit length. `--slide-pt` also changes point size, which these lengths already include. */
function fitLength(value: number): string {
  return `calc(${value}px * var(--canvas-fit, 1))`;
}

function fitDash(style: string | undefined, width: number): string | undefined {
  const parts = dashMultipliers(style);
  if (!parts) return;
  const w = width || 1;
  return parts.map((part) => fitLength(part * w)).join(" ");
}

/**
 * Arrowhead length in slide pixels.
 * A medium triangle is three times the pen, and the pen is at least 0.7 mm,
 * which is how a 0.75 pt line still gets a head about 6 points long.
 * Small is two thirds of that and large is five thirds, matching DrawingML.
 */
function lineEndLength(_kind: LineMarker, size: "sm" | "lg" | undefined, stroke: number) {
  const scale = size === "lg" ? 5 / 3 : size === "sm" ? 2 / 3 : 1;
  const pen = Math.max(stroke, (0.7 / 25.4) * 72);
  return 3 * scale * pen;
}

/** A filled end in the line's own pixel space. SVG markers disappear under the print zoom. */
function lineEndPath(
  kind: LineMarker,
  length: number,
  tip: { x: number; y: number },
  dir: { x: number; y: number },
) {
  const across = length / 2;
  const base = { x: tip.x - dir.x * length, y: tip.y - dir.y * length };
  const px = -dir.y;
  const py = dir.x;
  if (kind === "oval") {
    const r = length / 2;
    return `M ${tip.x - r},${tip.y} a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 ${-r * 2},0`;
  }
  if (kind === "diamond")
    return `M ${tip.x},${tip.y - across} L ${tip.x + across},${tip.y} L ${tip.x},${tip.y + across} L ${tip.x - across},${tip.y} Z`;
  if (kind === "stealth") {
    const notch = length * 0.35;
    return `M ${tip.x},${tip.y} L ${base.x + px * across},${base.y + py * across} L ${tip.x - dir.x * notch},${tip.y - dir.y * notch} L ${base.x - px * across},${base.y - py * across} Z`;
  }
  return `M ${tip.x},${tip.y} L ${base.x + px * across},${base.y + py * across} L ${base.x - px * across},${base.y - py * across} Z`;
}

/** Feather every side by the DrawingML soft-edge radius. */
export function softEdgeMask(px: number): string {
  const feather = `min(${fitLength(px)}, 49%)`;
  return [
    `linear-gradient(to right, transparent, #000 ${feather}, #000 calc(100% - ${feather}), transparent)`,
    `linear-gradient(to bottom, transparent, #000 ${feather}, #000 calc(100% - ${feather}), transparent)`,
  ].join(", ");
}

function featherStyle(px?: number): CSSProperties {
  if (!px) return {};
  const mask = softEdgeMask(px);
  return {
    WebkitMaskImage: mask,
    maskImage: mask,
    WebkitMaskComposite: "source-in",
    maskComposite: "intersect",
  };
}

export { croppedPictureStyle, pictureCropBox } from "./slide-picture-crop";

function cellText(cell: string) {
  if (!cell.includes("`")) return cell;
  return cell.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <code key={index}>{part.slice(1, -1)}</code>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

/** A trailing newline is an empty paragraph. CSS drops it unless it is its own line. */
function cellParagraphs(
  cell: string,
  mark?: { bold?: boolean; italic?: boolean; font?: string; fontSize?: number; tabSize?: number },
) {
  const paint = (part: string) =>
    part.includes("\t") ? tabbedCellLine(part, mark) : cellText(part);
  if (!cell.includes("\n")) return paint(cell);
  return cell.split("\n").map((part, index) => (
    <span key={index} style={{ display: "block", minHeight: part ? undefined : "1lh" }}>
      {part ? paint(part) : "\u00a0"}
    </span>
  ));
}

function tabbedCellLine(
  part: string,
  mark?: { bold?: boolean; italic?: boolean; font?: string; fontSize?: number; tabSize?: number },
  line?: { margin?: number; hang?: number; first?: number; tabs?: TextRun["paraTabs"] },
) {
  const html = runsToHtml(
    [
      {
        text: part,
        ...(mark?.bold ? { bold: true } : {}),
        ...(mark?.italic ? { italic: true } : {}),
        ...(mark?.font ? { font: mark.font } : {}),
        ...(mark?.fontSize ? { fontSize: mark.fontSize } : {}),
        ...(mark?.tabSize ? { paraTab: mark.tabSize } : {}),
        ...(line?.margin ? { paraMargin: line.margin } : {}),
        ...(line?.hang ? { paraHang: line.hang } : {}),
        ...(line?.first ? { paraFirst: line.first } : {}),
        ...(line?.tabs?.length ? { paraTabs: line.tabs } : {}),
      },
    ],
    undefined,
    undefined,
    { fontFamily: mark?.font, fontSize: mark?.fontSize, bold: mark?.bold, italic: mark?.italic },
  );
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function MathPieces({
  parts,
}: {
  parts: { text: string; script?: "sub" | "sup" }[];
}) {
  return parts.map((part, index) => (
    <span
      key={index}
      style={
        part.script === "sub"
          ? { fontSize: "0.65em", verticalAlign: "-0.25em" }
          : part.script === "sup"
            ? { fontSize: "0.65em", verticalAlign: "0.4em" }
            : undefined
      }
    >
      {part.text}
    </span>
  ));
}

/** Office math fraction, stacked the same way a text box paints it. */
function StackedFraction({
  fraction,
}: {
  fraction: {
    num: { text: string; script?: "sub" | "sup" }[];
    den: { text: string; script?: "sub" | "sup" }[];
    bar?: boolean;
  };
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        verticalAlign: "middle",
        textAlign: "center",
        lineHeight: 1,
        margin: "0 0.06em",
      }}
    >
      <span>{fraction.num.length ? <MathPieces parts={fraction.num} /> : "\u200b"}</span>
      <span
        style={{
          ...(fraction.bar === false
            ? { fontSize: "0.7em" }
            : { borderTop: "0.06em solid currentColor" }),
        }}
      >
        {fraction.den.length ? <MathPieces parts={fraction.den} /> : "\u200b"}
      </span>
    </span>
  );
}

function cellBody(
  cell: string,
  mark:
    | {
        fontSize?: number;
        lines?: { margin?: number; hang?: number; first?: number; tabs?: TextRun["paraTabs"] }[];
        tabSize?: number;
        runs?: {
          text: string;
          color?: string;
          font?: string;
          fontSize?: number;
          baseline?: number;
          bold?: boolean;
          fraction?: {
            num: { text: string; script?: "sub" | "sup" }[];
            den: { text: string; script?: "sub" | "sup" }[];
          };
        }[];
      }
    | undefined,
) {
  if (mark?.runs?.length) {
    return (
      <span
        dangerouslySetInnerHTML={{
          __html: runsToHtml(mark.runs as TextRun[], undefined, undefined, {
            fontFamily: mark.font,
            fontSize: mark.fontSize,
            bold: mark.bold,
            italic: mark.italic,
          }),
        }}
      />
    );
  }
  const lines = mark?.lines;
  if (!lines?.some((line) => line.margin || line.hang || line.first || line.tabs?.length))
    return cellParagraphs(cell, mark);
  return cell.split("\n").map((part, index) => {
    const line = lines[index];
    const hang = line?.hang ?? 0;
    const inset = (line?.margin ?? 0) + hang;
    const indented = !!(line?.first || part.includes("\t") || line?.tabs?.length);
    return (
      <span
        key={index}
        style={{
          display: "block",
          margin: 0,
          paddingLeft: inset ? `calc(${inset}px * var(--canvas-fit, 1))` : undefined,
          textIndent: !indented && hang ? `calc(${-hang}px * var(--canvas-fit, 1))` : undefined,
        }}
      >
        {part
          ? indented
            ? tabbedCellLine(part, mark, { first: line?.first, tabs: line?.tabs })
            : cellText(part)
          : "\u00a0"}
      </span>
    );
  });
}

/** The slide's master, elements, and number, as the editor draws them. */
export function SlideFace({
  deck,
  slide,
  index,
  hooks = {},
  still = false,
}: {
  deck: Presentation;
  slide: Slide | undefined;
  index: number;
  hooks?: SlideFaceHooks;
  /** Print, thumbnails, and handouts draw media as a still picture. */
  still?: boolean;
}) {
  const w = deck.width || 960;
  const h = deck.height || 540;
  const fitted = isFittedDeck(deck);
  const units = (n: number) => `calc(${n} / ${w} * 100cqw)`;
  return (
    <>
      <SlideMasterLayer deck={deck} font={(size) => `calc(${size} * var(--slide-pt, 1) * 1px)`} />
      {slide?.elements.filter((el) => intersectsSlide(el, w, h)).map((raw) => {
        // Print clips a picture, or a text box, that starts off the page.
        // The words keep their origin so a section numeral is not dropped.
        const offslide: SlideClip | undefined =
          still && raw.type === "text" ? clipBoxToSlide(raw, w, h) : undefined;
        const el = offslide
          ? { ...raw, x: offslide.x, y: offslide.y, width: offslide.width, height: offslide.height }
          : still && raw.type === "image" && !raw.rotation
            ? clipPictureToSlide(raw, w, h)
            : raw;
        const view = hooks.box?.(el) ?? {};
        const extra = view.className ?? "";
        const posStyle: CSSProperties = {
          position: "absolute",
          left: `${(el.x / w) * 100}%`,
          top: `${(el.y / h) * 100}%`,
          width: `${(el.width / w) * 100}%`,
          height: `${(el.height / h) * 100}%`,
          ...placedPose(el),
        };

        if (el.type === "text") {
          const art = wordArtProps(el);
          const inherited = inheritedText(el, deck.master?.elements ?? []);
          const face = el.content?.trim() ? el : { ...el, content: inherited.content ?? "" };
          const typeSize = inherited.fontSize ?? 20;
          const normalPx = typeSize * slidePointScale(deck.width, deck.pointWidth);
          return (
            <AutofitBox
              key={el.id}
              autofit={!!el.autofit && !el.wordArt}
              normalPx={normalPx}
              signature={autofitSignature(el)}
              data-word-art={el.wordArt}
              data-nowrap={el.nowrap ? "true" : undefined}
              data-autofit={el.autofit && !el.wordArt ? "on" : undefined}
              {...view.props}
              className={`slide-element slide-text${extra}${art.className}`}
              style={{
                ...posStyle,
                ...art.style,
                fontSize: fitted
                  ? units(typeSize)
                  : `calc(${typeSize} * var(--slide-pt, 1) * 1px)`,
                ...boxFont(el),
                fontKerning: fontKerning(el.kern, typeSize),
                fontFeatureSettings: kernFeature(el.kern, typeSize),
                fontFamily: paintFontFamily(inherited.fontFamily || "Arial"),
                color: inherited.color || "#1e293b",
                textAlign: el.align || "left",
                lineHeight: el.lineHeight,
                whiteSpace: el.preformatted ? "pre" : "pre-wrap",
                writingMode:
                  el.textFlow === "up"
                    ? "sideways-lr"
                    : el.textFlow === "down"
                      ? "sideways-rl"
                      : el.textFlow === "upright"
                        ? "vertical-lr"
                        : undefined,
                textOrientation: el.textFlow === "upright" ? "upright" : undefined,
                backgroundColor: el.fill || "transparent",
                ["--spell-caret" as string]: inherited.color || "#1e293b",
                ["--marp-pad" as string]: fitted && el.padLeft ? units(el.padLeft) : "0px",
                ["--marp-hang" as string]: fitted && el.hang ? units(el.hang) : "0px",
                ["--slide-inset" as string]:
                  el.inset != null ? `calc(${el.inset}px * var(--canvas-fit, 1))` : undefined,
                ["--slide-pad-r" as string]:
                  el.padRight != null ? `calc(${el.padRight}px * var(--canvas-fit, 1))` : undefined,
                ["--slide-pad-b" as string]:
                  el.padBottom != null ? `calc(${el.padBottom}px * var(--canvas-fit, 1))` : undefined,
                ["--slide-pad-l" as string]:
                  el.padLeft != null ? `calc(${el.padLeft}px * var(--canvas-fit, 1))` : undefined,
                ["--slide-hang" as string]:
                  el.hang ? `calc(${el.hang}px * var(--canvas-fit, 1))` : undefined,
                ...shapeDropShadow(el),
                ...(offslide ? { overflow: "hidden" } : {}),
              }}
              data-valign={el.valign && el.valign !== "top" ? el.valign : undefined}
            >
              {offslide ? (
                <div className="slide-text-shift" style={offslideShiftStyle(offslide)}>
                  {hooks.before?.(el)}
                  {hooks.text?.(el) ?? <DrawnWords el={face} />}
                  {hooks.after?.(el)}
                </div>
              ) : (
                <>
                  {hooks.before?.(el)}
                  {hooks.text?.(el) ?? <DrawnWords el={face} />}
                  {hooks.after?.(el)}
                </>
              )}
            </AutofitBox>
          );
        }

        if (el.type === "image" && el.src) {
          const crop = croppedPictureStyle(el);
          // Print drops a box that is both rotated and the overflow clip. The
          // frame is the rotated rectangle, and the photo rotates inside it.
          const turn = placedPose(el).transform;
          const turnedFrame = el.rotation ? rotatedPictureFrame(el) : undefined;
          const plainFrame: CSSProperties = {
            ...posStyle,
            ...(turn ? { transform: undefined, overflow: "hidden" } : {}),
            ...shapeDropShadow(el),
          };
          const frameStyle: CSSProperties = turnedFrame
            ? {
                ...posStyle,
                left: `${(turnedFrame.x / w) * 100}%`,
                top: `${(turnedFrame.y / h) * 100}%`,
                width: `${(turnedFrame.width / w) * 100}%`,
                height: `${(turnedFrame.height / h) * 100}%`,
                transform: undefined,
                overflow: "hidden",
                ...shapeDropShadow(el),
              }
            : plainFrame;
          const inFrame = (node: ReactNode) =>
            turn ? (
              <div style={{ position: "absolute", inset: 0, transform: turn }}>{node}</div>
            ) : (
              node
            );
          const cropBox = pictureCropBox(el);
          // Chromium print mis-places a CSS-rotated picture. The SVG is the
          // rotated rectangle, so a quarter-turn is not clipped to a center strip.
          const svgTurned = turnedFrame ? (
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
                  overflow="hidden"
                >
                  <image
                    href={marpMediaSrc(el.src, deck.marpAssets)}
                    x={cropBox.x}
                    y={cropBox.y}
                    width={cropBox.width}
                    height={cropBox.height}
                    preserveAspectRatio="none"
                  />
                </svg>
              </g>
            </svg>
          ) : null;
          if (el.clipPath) {
            return (
              <ClippedSlidePicture
                el={el}
                media={marpMediaSrc(el.src, deck.marpAssets)}
                turnedFrame={turnedFrame}
                inFrame={inFrame}
                view={view}
                extra={extra}
                before={hooks.before?.(el)}
                after={hooks.after?.(el)}
                style={{
                  ...(turnedFrame ? frameStyle : plainFrame),
                  ...(el.opacity != null && el.opacity < 1 ? { opacity: el.opacity } : {}),
                  ...featherStyle(el.softEdge),
                }}
              />
            );
          }
          const picture = (
            <>
              {hooks.before?.(el)}
              {el.tile && !turnedFrame
                ? inFrame(
                    <TiledPictureFill
                      src={marpMediaSrc(el.src, deck.marpAssets) ?? ""}
                      tile={el.tile}
                      shape={{ width: el.width, height: el.height }}
                      label={el.alt || "Tiled picture"}
                    />,
                  )
                : svgTurned ??
                  inFrame(
                    <img
                      src={marpMediaSrc(el.src, deck.marpAssets)}
                      alt={el.src.startsWith("data:image/emf") ? "" : el.alt || "Slide asset"}
                      draggable={false}
                      style={{ ...(fitted ? {} : { objectFit: "fill" }), ...crop }}
                    />,
                  )}
              {hooks.after?.(el)}
            </>
          );
          const linked =
            el.href && /^(https?:|mailto:)/i.test(el.href) ? (
              <a
                href={el.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "block", width: "100%", height: "100%" }}
              >
                {picture}
              </a>
            ) : (
              picture
            );
          return (
            <div
              key={el.id}
              {...view.props}
              className={`slide-element slide-image${extra}`}
              style={{
                ...frameStyle,
                ...(crop && !el.shadow ? { overflow: "hidden" } : {}),
                ...(el.opacity != null && el.opacity < 1
                  ? { opacity: el.opacity }
                  : {}),
                ...featherStyle(el.softEdge),
                ...shapeDropShadow(el),
              }}
            >
              {crop && el.shadow ? (
                <div style={{ overflow: "hidden", width: "100%", height: "100%" }}>{linked}</div>
              ) : (
                linked
              )}
            </div>
          );
        }

        if (el.type === "shape" && el.marpHtml) {
          return (
            <div
              key={el.id}
              {...view.props}
              className={`slide-element marp-html${extra}`}
              style={posStyle}
            >
              {hooks.after?.(el)}
            </div>
          );
        }

        if (el.type === "shape" && (el.shapeType === "line" || el.shapeType === "arrow")) {
          const frame = lineFrame(el);
          const stroke = el.strokeWidth || 1;
          const alongX = el.width >= stroke;
          const alongY = el.height >= stroke;
          const x1 = alongX ? (el.flipH ? frame.width : 0) : frame.width / 2;
          const y1 = alongY ? (el.flipV ? frame.height : 0) : frame.height / 2;
          const x2 = alongX ? (el.flipH ? 0 : frame.width) : frame.width / 2;
          const y2 = alongY ? (el.flipV ? 0 : frame.height) : frame.height / 2;
          const color = el.stroke || "#1e293b";
          const ends = lineMarkerEnds(el);
          const dx = x2 - x1;
          const dy = y2 - y1;
          const span = Math.hypot(dx, dy) || 1;
          const dir = { x: dx / span, y: dy / span };
          const startLen = ends.start ? lineEndLength(ends.start, el.lineHeadSize, stroke) : 0;
          const endLen = ends.end ? lineEndLength(ends.end, el.lineTailSize, stroke) : 0;
          const room = Math.min(1, span / Math.max(startLen + endLen, 0.001));
          const pad = Math.max(startLen, endLen, stroke);
          return (
            <svg
              key={el.id}
              {...(view.props as SVGProps<SVGSVGElement>)}
              className={`slide-element slide-shape slide-line${extra}`}
              style={{
                ...posStyle,
                left: `${((frame.x - pad) / w) * 100}%`,
                top: `${((frame.y - pad) / h) * 100}%`,
                width: `${((frame.width + pad * 2) / w) * 100}%`,
                height: `${((frame.height + pad * 2) / h) * 100}%`,
                overflow: "visible",
                ...shapeDropShadow(el),
              }}
              viewBox={`${-pad} ${-pad} ${frame.width + pad * 2} ${frame.height + pad * 2}`}
              preserveAspectRatio="none"
            >
              <line
                x1={x1 + dir.x * startLen * room}
                y1={y1 + dir.y * startLen * room}
                x2={x2 - dir.x * endLen * room}
                y2={y2 - dir.y * endLen * room}
                stroke={color}
                strokeWidth={stroke}
                strokeDasharray={
                  dashMultipliers(el.strokeStyle)
                    ?.map((part) => part * stroke)
                    .join(" ")
                }
              />
              {ends.start ? (
                <path d={lineEndPath(ends.start, startLen * room, { x: x1, y: y1 }, { x: -dir.x, y: -dir.y })} fill={color} />
              ) : null}
              {ends.end ? (
                <path d={lineEndPath(ends.end, endLen * room, { x: x2, y: y2 }, dir)} fill={color} />
              ) : null}
            </svg>
          );
        }

        if (rotatedShapePrintable(el)) {
          return (
            <RotatedSlideShape key={el.id} el={el} slideWidth={w} slideHeight={h} className={`slide-element slide-shape${extra}`} boxProps={view.props} before={hooks.before?.(el)} after={hooks.after?.(el)} />
          );
        }

        const ellipseGradient = el.fill ? straightGradientBackground(el.fill) : undefined;
        if (el.type === "shape" && el.shapeType === "ellipse" && !ellipseGradient) {
          // A CSS border-radius ellipse that hangs off the slide prints as a
          // rounded rectangle. An SVG ellipse clips to the page as a curve.
          // Opaque CSS gradients are not valid SVG paint and would fill black.
          const paint = ellipseSvgPaint(el.id, el.fill);
          return (
            <div
              key={el.id}
              {...view.props}
              className={`slide-element slide-shape${extra}`}
              style={{
                ...posStyle,
                background: "transparent",
                border: "none",
                overflow: "visible",
                ...featherStyle(el.softEdge),
                ...shapeDropShadow(el),
              }}
            >
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                style={{ display: "block", overflow: "visible" }}
              >
                {paint.inner ? <defs dangerouslySetInnerHTML={{ __html: paint.inner }} /> : null}
                <ellipse
                  cx="50"
                  cy="50"
                  rx="50"
                  ry="50"
                  fill={paint.value}
                  stroke={el.stroke || "none"}
                  strokeDasharray={fitDash(el.strokeStyle, el.strokeWidth || 1)}
                  vectorEffect="non-scaling-stroke"
                  style={{ strokeWidth: el.stroke ? fitLength(el.strokeWidth || 1) : 0 }}
                />
              </svg>
              {hooks.before?.(el)}
              {hooks.after?.(el)}
            </div>
          );
        }

        if (el.type === "shape") {
          const dashParts = dashMultipliers(el.strokeStyle);
          const cssDash = !el.strokeStyle || el.strokeStyle === "dashed" || el.strokeStyle === "dotted";
          const border = el.stroke && cssDash
            ? `${fitLength(el.strokeWidth || 1)} ${el.strokeStyle || "solid"} ${el.stroke}`
            : "none";
          const rad =
            el.shapeType === "ellipse" ? "50%" : el.shapeType === "roundRect" ? fitLength(12) : "0px";
          const straight = el.fill ? straightGradientBackground(el.fill) : undefined;
          return (
            <div
              key={el.id}
              {...view.props}
              className={`slide-element slide-shape${extra}`}
              style={{
                ...posStyle,
                background: straight || (el.fill ? officeGradient(el.fill) : "#e2e8f0"),
                border,
                ...featherStyle(el.softEdge),
                ...shapeDropShadow(el),
                borderRadius:
                  el.radius != null
                    ? `calc(${el.radius} * var(--slide-unit, 1px))`
                    : rad,
              }}
            >
              {el.stroke && dashParts && !cssDash ? (
                <svg
                  viewBox={`0 0 ${el.width} ${el.height}`}
                  width="100%"
                  height="100%"
                  preserveAspectRatio="none"
                  style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
                >
                  <rect
                    x={(el.strokeWidth || 1) / 2}
                    y={(el.strokeWidth || 1) / 2}
                    width={Math.max(0, el.width - (el.strokeWidth || 1))}
                    height={Math.max(0, el.height - (el.strokeWidth || 1))}
                    rx={el.radius ?? (el.shapeType === "roundRect" ? 12 : 0)}
                    ry={el.radius ?? (el.shapeType === "roundRect" ? 12 : 0)}
                    fill="none"
                    stroke={el.stroke}
                    strokeWidth={el.strokeWidth || 1}
                    strokeDasharray={dashParts.map((part) => part * (el.strokeWidth || 1)).join(" ")}
                  />
                </svg>
              ) : null}
              {hooks.before?.(el)}
              {hooks.after?.(el)}
            </div>
          );
        }

        if (el.type === "table" && el.rows) {
          const hideDefaultRules = !!el.cellMarks?.some((tableRow) =>
            tableRow.some(
              (cell) =>
                cell.fill ||
                cell.border ||
                cell.borderTop ||
                cell.borderRight ||
                cell.borderBottom ||
                cell.borderLeft,
            ),
          );
          return (
            <div
              key={el.id}
              {...view.props}
              className={`slide-element slide-table${extra}`}
              style={{
                ...posStyle,
                fontFamily: paintFontFamily(el.fontFamily),
                ...(el.fill ? { background: officeGradient(el.fill) } : {}),
                ...(fitted && el.fontSize ? { fontSize: units(el.fontSize) } : {}),
              }}
            >
              {hooks.before?.(el)}
              <table
                style={{
                  ...(el.colWidths ? { tableLayout: "fixed" } : {}),
                  ...(el.rtl ? { direction: "rtl" } : {}),
                }}
              >
                {el.colWidths ? (
                  <colgroup>
                    {el.colWidths.map((fraction, index) => (
                      <col key={index} style={{ width: `${fraction * 100}%` }} />
                    ))}
                  </colgroup>
                ) : null}
                <tbody>
                  {el.rows.map((row, rIdx) => {
                    const rowHeight =
                      el.rowHeights?.[rIdx] != null
                        ? tableRowHeightCss(el.rowHeights[rIdx]!, el.height, w)
                        : undefined;
                    return (
                    <tr key={rIdx} style={rowHeight ? { height: rowHeight } : undefined}>
                      {row.map((cell, cIdx) => {
                        const cellProps = hooks.cell?.(el, rIdx, cIdx) ?? {};
                        const mark = el.cellMarks?.[rIdx]?.[cIdx];
                        const layout = tableCellLayout(
                          rowHeight,
                          (mark?.rowSpan ?? 1) > 1,
                          slideCellPaint(mark, hideDefaultRules),
                        );
                        return (
                          <td
                            key={cIdx}
                            {...cellProps}
                            colSpan={mark?.colSpan}
                            rowSpan={mark?.rowSpan}
                            style={{
                              ...cellProps.style,
                              ...layout.td,
                            }}
                          >
                            {layout.clip ? (
                              <div data-row-clip="" style={layout.clip}>
                                {cellBody(cell, mark)}
                              </div>
                            ) : (
                              cellBody(cell, mark)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {hooks.after?.(el)}
            </div>
          );
        }

        if ((el.type === "audio" || el.type === "video") && (el.src || el.poster)) {
          if (still && (el.type === "video" || el.poster)) {
            return (
              <SlideMediaStill
                key={el.id}
                el={el}
                posStyle={posStyle}
                slideWidth={w}
                slideHeight={h}
                extra={extra}
                boxProps={view.props}
              />
            );
          }
          return (
            <div
              key={el.id}
              data-media={el.type}
              {...view.props}
              className={`slide-element slide-${el.type}${extra}`}
              style={posStyle}
            >
              {hooks.before?.(el)}
              <SlideMediaControls element={el} />
              {hooks.after?.(el)}
            </div>
          );
        }

        return null;
      })}
      {deck.slideNumbers ? <SlideNumber n={index + 1} /> : null}
    </>
  );
}

/**
 * The slide exactly as the editor draws it at its widest, scaled to fit its
 * holder like a picture of it. Thumbnails, the slideshow, handouts, and
 * printing all show this, so none of them can drift from the editor. A MARP
 * deck shows MARP's drawing behind the boxes, as the editor does; a lazy still
 * loads that drawing once it scrolls near the screen.
 */
type StillProps = {
  deck: Presentation;
  slide: Slide | undefined;
  index: number;
  pages?: MarpPages | null;
  hooks?: SlideFaceHooks;
  /** Media controls can be used, as in the slideshow. */
  interactive?: boolean;
  lazy?: boolean;
  className?: string;
  children?: ReactNode;
};

const sameAssets = (a: Presentation["marpAssets"], b: Presentation["marpAssets"]) =>
  a === b ||
  (!!a &&
    !!b &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([path, uri]) => b[path] === uri));

/** The parts of a deck that change how one of its slides is drawn. */
const sameLook = (a: Presentation, b: Presentation) =>
  a === b ||
  (a.width === b.width &&
    a.height === b.height &&
    !!a.marp === !!b.marp &&
    isFittedDeck(a) === isFittedDeck(b) &&
    a.master === b.master &&
    !!a.slideNumbers === !!b.slideNumbers &&
    sameAssets(a.marpAssets, b.marpAssets));

/** Unchanged slides skip redrawing when another slide of the deck changes. */
export const sameStill = (a: StillProps, b: StillProps) =>
  a.slide === b.slide &&
  a.index === b.index &&
  a.hooks === b.hooks &&
  a.interactive === b.interactive &&
  a.lazy === b.lazy &&
  a.className === b.className &&
  a.children === b.children &&
  !!a.pages === !!b.pages &&
  a.pages?.pages[a.index] === b.pages?.pages[b.index] &&
  sameLook(a.deck, b.deck);

export const SlideStill = memo(function SlideStill({
  deck,
  slide,
  index,
  pages = null,
  hooks,
  interactive = false,
  lazy = false,
  className = "",
  children,
}: StillProps) {
  const width = SLIDE_DRAW_WIDTH;
  const height = (SLIDE_DRAW_WIDTH * (deck.height || 540)) / (deck.width || 960);
  const holder = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, x: 0, y: 0 });
  const [near, setNear] = useState(!lazy);
  const [painted, setPainted] = useState(false);
  const drawn = !!deck.marp && !!pages;

  useLayoutEffect(() => {
    void loadEmbeddedFonts(deck.fonts);
  }, [deck.fonts]);

  useLayoutEffect(() => {
    const box = holder.current;
    if (!box) return;
    const measure = () => {
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (!w || !h) return;
      const scale = Math.min(w / width, h / height);
      setFit({ scale, x: (w - width * scale) / 2, y: (h - height * scale) / 2 });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [width, height]);

  useEffect(() => {
    if (near || !drawn) return;
    const box = holder.current;
    if (!box || typeof IntersectionObserver === "undefined") return setNear(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [near, drawn]);

  return (
    <div
      ref={holder}
      className={`slide-still${interactive ? " slide-still-live" : ""}${className ? ` ${className}` : ""}`}
    >
      <div
        className={`slide-surface${isFittedDeck(deck) ? " marp-fit" : ""}${drawn && painted ? " marp-painted" : ""}`}
        style={{
          width,
          height,
          // Print pages are 96dpi CSS pixels, 4/3 of the point size. Table rows
          // use cqw, so this drawing surface has to be the container. Otherwise
          // cqw is the page and every row paints a third too tall.
          containerType: "inline-size",
          transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
          ["--slide-fit" as string]: String(fit.scale),
          ["--slide-fit-x" as string]: `${fit.x}px`,
          ["--slide-fit-y" as string]: `${fit.y}px`,
          ["--slide-pt" as string]: String(slidePointScale(deck.width, deck.pointWidth)),
          ["--slide-unit" as string]: `${SLIDE_DRAW_WIDTH / (deck.width || 960)}px`,
          ...slideBackgroundPaint(slideBackground(deck, slide)),
        }}
      >
        {drawn && near ? (
          <MarpBackdrop pages={pages} index={index} live={null} plain onPainted={setPainted} />
        ) : null}
        <SlideFace deck={deck} slide={slide} index={index} hooks={hooks} still={!interactive} />
        {children}
      </div>
    </div>
  );
}, sameStill);
