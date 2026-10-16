import type { CSSProperties } from "react";
import type { Presentation, SlideElement } from "@suiteleaf/core";
import { readMaster } from "./slide-master";

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
}: {
  deck: Presentation;
  font: (size: number) => string;
}) {
  const master = readMaster(deck);
  if (!master.elements.length) return null;
  const deckW = deck.width || 960;
  const deckH = deck.height || 540;
  return (
    <div className="slide-master-layer" aria-hidden="true">
      {master.elements.map((el) => (
        <MasterElement key={el.id} el={el} deckW={deckW} deckH={deckH} font={font} />
      ))}
    </div>
  );
}
