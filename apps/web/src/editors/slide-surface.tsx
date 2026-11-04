import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { slidePointScale, type Presentation, type Slide } from "@suiteleaf/core";
import { MarpBackdrop, type MarpPages } from "./slide-marp-backdrop";
import { loadEmbeddedFonts } from "./slide-fonts";
import { SlideFace, type SlideFaceHooks } from "./slide-face";
import { isFittedDeck, slideBackground, slideBackgroundPaint } from "./slide-surface-paint";

/** The editor's canvas at its widest. Every other view draws the slide at this size and scales it. */
export const SLIDE_DRAW_WIDTH = 960;

export { SlideFace, SlideNumber, type SlideBoxProps, type SlideFaceHooks } from "./slide-face";
export {
  intersectsSlide,
  isFittedDeck,
  slideBackground,
  slideBackgroundPaint,
  softEdgeMask,
} from "./slide-surface-paint";
export { croppedPictureStyle, pictureCropBox } from "./slide-picture-crop";

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
