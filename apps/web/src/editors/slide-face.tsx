import type { CSSProperties, HTMLAttributes, ReactNode, SVGProps, TdHTMLAttributes } from "react";
import { dashMultipliers, fontKerning, kernFeature, lineFrame, lineMarkerEnds, officeGradient, paintFontFamily, slidePointScale, straightGradientBackground, type Presentation, type Slide, type SlideElement } from "@suiteleaf/core";
import { AutofitBox, autofitSignature } from "./slide-autofit";
import { marpMediaSrc } from "./slide-marp-import";
import { drawnTextKind } from "./slide-drawn-text";
import { MarpCode, MarpMath, MarpRichText } from "./slide-marp-math";
import { inheritedText } from "./slide-master";
import { SlideMasterLayer } from "./slide-master-ui";
import { SlideMediaControls } from "./slide-media";
import { ClippedSlidePicture } from "./slide-clipped-picture";
import { clipPictureToSlide, croppedPictureStyle, pictureCropBox } from "./slide-picture-crop";
import { clipBoxToSlide, offslideShiftStyle, type SlideClip } from "./slide-print-clip";
import { rotatedPictureFrame, turnedPictureTransform } from "./slide-picture-frame";
import { RotatedSlideShape, rotatedShapePrintable, shapeDropShadow } from "./slide-rotated-shape";
import { SlideMediaStill } from "./slide-media-still";
import { slideCellPaint, tableCellFlow, tableCellLayout, tableRowHeightCss } from "./slide-table-format";
import { boxFont, SlideTextBody } from "./slide-text";
import { proofingLanguage, proofingTextDirection } from "./proofing-language";
import { wordArtProps } from "./slide-word-art";
import { StretchedWordArt } from "./slide-stretch-text";
import { TiledPictureFill } from "./slide-tiled-picture";
import { cellBody } from "./slide-table-cell";
import {
  ellipseSvgPaint,
  featherStyle,
  fitDash,
  fitLength,
  intersectsSlide,
  isFittedDeck,
  lineEndLength,
  lineEndPath,
  placedPose,
} from "./slide-surface-paint";

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

/** PowerPoint draws a pen at least one device pixel wide. A dash or a see-through pen would show the copy. */
function hairline(color: string | undefined, dash: readonly number[] | undefined): boolean {
  return !dash && !!color && /^#[0-9a-f]{6}$/i.test(color);
}

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
        lineHeight={el.lineHeight}
        lineHeightPt={el.lineHeightPt}
        align={el.align}
        nowrap={el.nowrap}
        editing={false}
        onText={noop}
        onCaret={noop}
      />
    );
  return <div className="element-textarea slide-text-face">{el.content}</div>;
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
        // The still surface is already the slide's pixel size, then scaled.
        // Percent heights there collapse, so a centered title stays at the top.
        const posStyle: CSSProperties = still
          ? {
              position: "absolute",
              left: `${el.x}px`,
              top: `${el.y}px`,
              width: `${el.width}px`,
              height: `${el.height}px`,
              ...placedPose(el),
            }
          : {
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
              dir={proofingTextDirection(proofingLanguage(deck.proofingLanguage))}
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
                lineHeight: el.lineHeightPt
                  ? `calc(${el.lineHeightPt} * var(--slide-pt, 1) * 1px)`
                  : el.lineHeight
                  ? `calc(${typeSize} * var(--slide-pt, 1) * ${el.lineHeight} * 1px)`
                  : undefined,
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
                <div
                  className="slide-text-shift"
                  style={offslideShiftStyle(
                    offslide,
                    el.valign === "middle" || el.valign === "bottom" ? el.valign : "top",
                  )}
                >
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
                media={marpMediaSrc(el.src, deck.marpAssets) ?? el.src}
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
              {hairline(color, dashMultipliers(el.strokeStyle)) ? (
                <line
                  x1={x1 + dir.x * startLen * room}
                  y1={y1 + dir.y * startLen * room}
                  x2={x2 - dir.x * endLen * room}
                  y2={y2 - dir.y * endLen * room}
                  stroke={color}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
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
          const stroke = el.strokeWidth || 1;
          const rad =
            el.shapeType === "ellipse" ? "50%" : el.shapeType === "roundRect" ? fitLength(12) : "0px";
          const straight = el.fill ? straightGradientBackground(el.fill) : undefined;
          // PowerPoint centers the outline on the edge, so half of it sits
          // outside the box. A CSS border stays inside and leaves a gap.
          const corner = el.radius ?? (el.shapeType === "roundRect" ? 12 : 0);
          return (
            <div
              key={el.id}
              {...view.props}
              className={`slide-element slide-shape${extra}`}
              style={{
                ...posStyle,
                background: straight || (el.fill ? officeGradient(el.fill) : "#e2e8f0"),
                border: "none",
                ...(el.stroke ? { overflow: "visible" } : {}),
                ...featherStyle(el.softEdge),
                ...shapeDropShadow(el),
                borderRadius:
                  el.radius != null
                    ? `calc(${el.radius} * var(--slide-unit, 1px))`
                    : rad,
              }}
            >
              {el.stroke ? (
                <svg
                  viewBox={`0 0 ${el.width} ${el.height}`}
                  width="100%"
                  height="100%"
                  preserveAspectRatio="none"
                  style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}
                >
                  <rect
                    x={0}
                    y={0}
                    width={Math.max(0, el.width)}
                    height={Math.max(0, el.height)}
                    rx={corner}
                    ry={corner}
                    fill="none"
                    stroke={el.stroke}
                    strokeWidth={stroke}
                    strokeDasharray={
                      dashParts ? dashParts.map((part) => part * stroke).join(" ") : undefined
                    }
                  />
                  {hairline(el.stroke, dashParts) ? (
                    <rect
                      x={0}
                      y={0}
                      width={Math.max(0, el.width)}
                      height={Math.max(0, el.height)}
                      rx={corner}
                      ry={corner}
                      fill="none"
                      stroke={el.stroke}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
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
                        const flow = tableCellFlow(mark);
                        const body = flow ? <div data-cell-flow={mark?.textFlow} style={flow}>{cellBody(cell, mark)}</div> : cellBody(cell, mark);
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
                                {body}
                              </div>
                            ) : (
                              body
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
