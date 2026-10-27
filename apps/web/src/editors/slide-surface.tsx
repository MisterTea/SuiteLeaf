import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type TdHTMLAttributes,
} from "react";
import type { Presentation, Slide, SlideElement } from "@suiteleaf/core";
import { AutofitBox, autofitSignature } from "./slide-autofit";
import { MarpBackdrop, type MarpPages } from "./slide-marp-backdrop";
import { marpMediaSrc } from "./slide-marp-import";
import { MarpCode, MarpMath, MarpRichText } from "./slide-marp-math";
import { SlideMasterLayer } from "./slide-master-ui";
import { SlideMediaControls } from "./slide-media";
import { hasTextRuns } from "./slide-runs";
import { boxFont, SlideTextBody } from "./slide-text";
import { wordArtProps } from "./slide-word-art";

/** The editor's canvas at its widest. Every other view draws the slide at this size and scales it. */
export const SLIDE_DRAW_WIDTH = 960;

/** A MARP deck laid out from its rendering, sized in slide units. */
export function isFittedDeck(deck: Presentation) {
  return !!deck.marpFit || (!!deck.marp && deck.marpSource !== undefined);
}

export function slideBackground(deck: Presentation, slide: Slide | undefined) {
  return slide?.background?.color || deck.master?.background?.color || "#ffffff";
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
  if (el.preformatted) return <MarpCode source={el.content || ""} language={el.codeLanguage} />;
  if (el.math) return <MarpMath source={el.content || ""} />;
  if (el.content?.includes("$")) return <MarpRichText source={el.content} />;
  if (hasTextRuns(el))
    return (
      <SlideTextBody
        content={el.content}
        runs={el.runs}
        bold={el.bold}
        italic={el.italic}
        underline={el.underline}
        editing={false}
        onText={noop}
        onCaret={noop}
      />
    );
  return <div className="element-textarea slide-text-face">{el.content}</div>;
}

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

/** The slide's master, elements, and number, as the editor draws them. */
export function SlideFace({
  deck,
  slide,
  index,
  hooks = {},
}: {
  deck: Presentation;
  slide: Slide | undefined;
  index: number;
  hooks?: SlideFaceHooks;
}) {
  const w = deck.width || 960;
  const h = deck.height || 540;
  const fitted = isFittedDeck(deck);
  const units = (n: number) => `calc(${n} / ${w} * 100cqw)`;
  return (
    <>
      <SlideMasterLayer deck={deck} font={(size) => `${size * 0.95}px`} />
      {slide?.elements.map((el) => {
        const view = hooks.box?.(el) ?? {};
        const extra = view.className ?? "";
        const posStyle: CSSProperties = {
          position: "absolute",
          left: `${(el.x / w) * 100}%`,
          top: `${(el.y / h) * 100}%`,
          width: `${(el.width / w) * 100}%`,
          height: `${(el.height / h) * 100}%`,
        };

        if (el.type === "text") {
          const art = wordArtProps(el);
          const normalPx = (el.fontSize || 20) * 0.95;
          return (
            <AutofitBox
              key={el.id}
              autofit={!!el.autofit && !el.wordArt}
              normalPx={normalPx}
              signature={autofitSignature(el)}
              data-word-art={el.wordArt}
              data-autofit={el.autofit && !el.wordArt ? "on" : undefined}
              {...view.props}
              className={`slide-element slide-text${extra}${art.className}`}
              style={{
                ...posStyle,
                ...art.style,
                fontSize: fitted ? units(el.fontSize || 20) : `${normalPx}px`,
                ...boxFont(el),
                fontFamily: el.fontFamily || "Arial",
                color: el.color || "#1e293b",
                textAlign: el.align || "left",
                lineHeight: el.lineHeight,
                whiteSpace: el.preformatted ? "pre" : "pre-wrap",
                backgroundColor: el.fill || "transparent",
                ["--spell-caret" as string]: el.color || "#1e293b",
                ["--marp-pad" as string]: fitted && el.padLeft ? units(el.padLeft) : "0px",
                ["--marp-hang" as string]: fitted && el.hang ? units(el.hang) : "0px",
              }}
            >
              {hooks.before?.(el)}
              {hooks.text?.(el) ?? <DrawnWords el={el} />}
              {hooks.after?.(el)}
            </AutofitBox>
          );
        }

        if (el.type === "image" && el.src) {
          return (
            <div
              key={el.id}
              {...view.props}
              className={`slide-element slide-image${extra}`}
              style={posStyle}
            >
              {hooks.before?.(el)}
              <img
                src={marpMediaSrc(el.src, deck.marpAssets)}
                alt={el.alt || "Slide asset"}
                draggable={false}
              />
              {hooks.after?.(el)}
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

        if (el.type === "shape") {
          const border = el.stroke ? `${el.strokeWidth || 1}px solid ${el.stroke}` : "none";
          const rad =
            el.shapeType === "ellipse" ? "50%" : el.shapeType === "roundRect" ? "12px" : "0px";
          return (
            <div
              key={el.id}
              {...view.props}
              className={`slide-element slide-shape${extra}`}
              style={{
                ...posStyle,
                backgroundColor: el.fill || "#e2e8f0",
                border,
                borderRadius: el.radius && fitted ? units(el.radius) : rad,
              }}
            >
              {hooks.before?.(el)}
              {hooks.after?.(el)}
            </div>
          );
        }

        if (el.type === "table" && el.rows) {
          return (
            <div
              key={el.id}
              {...view.props}
              className={`slide-element slide-table${extra}`}
              style={{
                ...posStyle,
                ...(fitted && el.fontSize ? { fontSize: units(el.fontSize) } : {}),
              }}
            >
              {hooks.before?.(el)}
              <table>
                <tbody>
                  {el.rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => {
                        const cellProps = hooks.cell?.(el, rIdx, cIdx) ?? {};
                        return (
                          <td
                            key={cIdx}
                            {...cellProps}
                            style={{
                              ...cellProps.style,
                              fontWeight: el.cellMarks?.[rIdx]?.[cIdx]?.bold ? 700 : undefined,
                              fontStyle: el.cellMarks?.[rIdx]?.[cIdx]?.italic ? "italic" : undefined,
                            }}
                          >
                            {cellText(cell)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {hooks.after?.(el)}
            </div>
          );
        }

        if ((el.type === "audio" || el.type === "video") && el.src) {
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
          transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
          backgroundColor: slideBackground(deck, slide),
        }}
      >
        {drawn && near ? (
          <MarpBackdrop pages={pages} index={index} live={null} plain onPainted={setPainted} />
        ) : null}
        <SlideFace deck={deck} slide={slide} index={index} hooks={hooks} />
        {children}
      </div>
    </div>
  );
}, sameStill);
