import type { CSSProperties, ReactNode } from "react";
import type { Presentation, Slide, SlideElement } from "@suiteleaf/core";
import { masterForSlide } from "./slide-master";
import { MASTER_PAGE_ID, isMasterPage } from "./slide-master-view";

function MasterElement({
  el,
  deckW,
  deckH,
  font,
}: {
  el: SlideElement;
  deckW: number;
  deckH: number;
  font: (size: number) => string;
}) {
  const style: CSSProperties = {
    position: "absolute",
    left: `${(el.x / deckW) * 100}%`,
    top: `${(el.y / deckH) * 100}%`,
    width: `${(el.width / deckW) * 100}%`,
    height: `${(el.height / deckH) * 100}%`,
    pointerEvents: "none",
  };
  if (el.type === "image" && el.src) {
    return <img src={el.src} alt="" style={{ ...style, objectFit: "contain" }} />;
  }
  return (
    <div
      style={{
        ...style,
        fontSize: font(el.fontSize || 14),
        color: el.color || "#475569",
        fontFamily: el.fontFamily || "Arial",
        whiteSpace: "pre-wrap",
        background: el.fill || "transparent",
      }}
    >
      {el.content}
    </div>
  );
}

/** Master objects drawn behind a slide. They are not part of that slide's selection. */
export function SlideMasterLayer({
  deck,
  font,
  slide,
}: {
  deck: Presentation;
  font: (size: number) => string;
  /** The page being drawn. The master page draws its own objects, so the layer stays out of the way. */
  slide?: Slide;
}) {
  if (slide?.id === MASTER_PAGE_ID) return null;
  const source = isMasterPage(slide?.id)
    ? deck.slides[MASTER_PAGE_ID]?.elements ?? []
    : masterForSlide(deck, slide).elements;
  // Empty placeholders are styles for the layouts, not a second copy on every slide.
  const elements = source.filter(
    (el) => !(el.type === "text" && el.placeholder && !el.content?.trim()),
  );
  if (!elements.length) return null;
  const deckW = deck.width || 960;
  const deckH = deck.height || 540;
  return (
    <div className="slide-master-layer" aria-hidden="true">
      {elements.map((el) => (
        <MasterElement key={el.id} el={el} deckW={deckW} deckH={deckH} font={font} />
      ))}
    </div>
  );
}

/** The frame for the speaker's preview of the following slide. */
export function PresenterNextSlide({
  deck,
  children,
}: {
  deck: Presentation;
  children?: ReactNode;
}) {
  return (
    <div
      className="presenter-next-slide show-slide"
      style={{ aspectRatio: `${deck.width || 960} / ${deck.height || 540}` }}
    >
      {children}
    </div>
  );
}
