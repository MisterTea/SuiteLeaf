import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Presentation, Slide, SlideElement } from "@suiteleaf/core";
import { boxFont, RunSpans } from "./slide-text";
import { wordArtProps } from "./slide-word-art";

const CHOICES = [2, 4, 6] as const;
type PerPage = (typeof CHOICES)[number];

function columnsFor(perPage: PerPage) {
  return perPage === 6 ? 3 : 2;
}

function pagesOf(slides: Slide[], perPage: PerPage): Slide[][] {
  const pages: Slide[][] = [];
  for (let i = 0; i < slides.length; i += perPage) {
    pages.push(slides.slice(i, i + perPage));
  }
  return pages;
}

function HandoutElement({
  el,
  width,
  height,
}: {
  el: SlideElement;
  width: number;
  height: number;
}) {
  const units = (n: number) => `calc(${n} / ${width} * 100cqw)`;
  const box: CSSProperties = {
    position: "absolute",
    left: `${(el.x / width) * 100}%`,
    top: `${(el.y / height) * 100}%`,
    width: `${(el.width / width) * 100}%`,
    height: `${(el.height / height) * 100}%`,
  };
  if (el.type === "text") {
    if (!el.content?.trim()) return null;
    const art = wordArtProps(el);
    return (
      <div
        className={`handout-text${art.className}`}
        style={{
          ...box,
          ...art.style,
          fontSize: units((el.fontSize || 20) * 0.95),
          lineHeight: 1.15,
          ...boxFont(el),
          fontFamily: el.fontFamily || "Arial",
          color: el.color || "#1e293b",
          textAlign: el.align || "left",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflow: "hidden",
          backgroundColor: el.fill || "transparent",
        }}
      >
        <RunSpans
          content={el.content}
          runs={el.runs}
          bold={el.bold}
          italic={el.italic}
          underline={el.underline}
        />
      </div>
    );
  }
  if (el.type === "shape") {
    const radius =
      el.shapeType === "ellipse" ? "50%" : el.shapeType === "roundRect" ? units(12) : "0";
    return (
      <div
        className="handout-shape"
        style={{
          ...box,
          backgroundColor: el.fill || "#e2e8f0",
          border: el.stroke ? `${units(el.strokeWidth || 1)} solid ${el.stroke}` : "none",
          borderRadius: radius,
        }}
      />
    );
  }
  if (el.type === "image" && el.src) {
    return (
      <img
        src={el.src}
        alt={el.alt || ""}
        className="handout-image"
        style={{ ...box, objectFit: "contain" }}
      />
    );
  }
  if (el.type === "table" && el.rows) {
    return (
      <table className="handout-table" style={box}>
        <tbody>
          {el.rows.map((row, rIdx) => (
            <tr key={rIdx}>
              {row.map((cell, cIdx) => (
                <td
                  key={cIdx}
                  style={{
                    fontWeight: el.cellMarks?.[rIdx]?.[cIdx]?.bold ? 700 : undefined,
                    fontStyle: el.cellMarks?.[rIdx]?.[cIdx]?.italic ? "italic" : undefined,
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return null;
}

function HandoutSlide({ slide, deck }: { slide: Slide; deck: Presentation }) {
  const width = deck.width || 960;
  const height = deck.height || 540;
  return (
    <div
      className="handout-slide"
      style={{
        backgroundColor:
          slide.background?.color || deck.master?.background?.color || "#ffffff",
        aspectRatio: `${width} / ${height}`,
      }}
    >
      {slide.elements.map((el) => (
        <HandoutElement key={el.id} el={el} width={width} height={height} />
      ))}
    </div>
  );
}

/** On-screen handout: several slides from this deck on each page. */
export function SlideHandouts({
  deck,
  onClose,
}: {
  deck: Presentation;
  onClose: () => void;
}) {
  const [perPage, setPerPage] = useState<PerPage>(4);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const slides = deck.slideOrder
    .map((id) => deck.slides[id])
    .filter((slide): slide is Slide => !!slide);
  const pages = pagesOf(slides, perPage);

  return (
    <div
      ref={dialogRef}
      className="handouts-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="handouts-heading"
      tabIndex={-1}
    >
      <div className="handouts-dialog">
        <header className="handouts-header">
          <h2 id="handouts-heading">Handouts</h2>
          <div className="handouts-controls">
            <label className="handouts-per-page">
              Slides per page
              <select
                aria-label="Slides per page"
                value={perPage}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (next === 2 || next === 4 || next === 6) setPerPage(next);
                }}
              >
                {CHOICES.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="dialog-text-btn" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        <div className="handouts-pages">
          {pages.map((group, index) => (
            <section
              key={group.map((slide) => slide.id).join("-")}
              className="handout-page"
              aria-label={`Page ${index + 1}`}
            >
              <p className="handout-page-label">Page {index + 1}</p>
              <div
                className="handout-grid"
                style={{ gridTemplateColumns: `repeat(${columnsFor(perPage)}, minmax(0, 1fr))` }}
              >
                {group.map((slide) => (
                  <HandoutSlide key={slide.id} slide={slide} deck={deck} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
