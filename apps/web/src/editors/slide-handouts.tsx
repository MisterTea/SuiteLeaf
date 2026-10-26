import { useEffect, useRef, useState } from "react";
import type { Presentation, Slide } from "@suiteleaf/core";
import { useMarpPages, type MarpPages } from "./slide-marp-backdrop";
import { SlideStill } from "./slide-surface";

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

function HandoutSlide({
  slide,
  index,
  deck,
  pages,
}: {
  slide: Slide;
  index: number;
  deck: Presentation;
  pages: MarpPages | null;
}) {
  return (
    <div
      className="handout-slide"
      style={{ aspectRatio: `${deck.width || 960} / ${deck.height || 540}` }}
    >
      <SlideStill deck={deck} slide={slide} index={index} pages={pages} />
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
  const marpPages = useMarpPages(deck);
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
                  <HandoutSlide
                    key={slide.id}
                    slide={slide}
                    index={deck.slideOrder.indexOf(slide.id)}
                    deck={deck}
                    pages={marpPages}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
