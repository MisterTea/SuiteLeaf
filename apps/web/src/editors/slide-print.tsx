import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal, flushSync } from "react-dom";
import type { Presentation, Slide } from "@suiteleaf/core";
import { prepareMarpDocument } from "./slide-marp-runtime";
import { renderMarpPages } from "./slide-marp-render";
import { SlideMasterLayer } from "./slide-master-ui";

/** Mount the full deck before both native browser printing and app print commands. */
export function useSlidePrint(
  title: string,
  send: (title?: string) => Promise<void>,
) {
  const [printing, setPrinting] = useState(false);
  const begin = useCallback(() => flushSync(() => setPrinting(true)), []);
  useEffect(() => {
    const end = () => setPrinting(false);
    window.addEventListener("beforeprint", begin);
    window.addEventListener("afterprint", end);
    return () => {
      window.removeEventListener("beforeprint", begin);
      window.removeEventListener("afterprint", end);
    };
  }, [begin]);
  const print = useCallback(async () => {
    begin();
    try {
      await document.fonts?.ready;
      await Promise.all(
        [
          ...document.querySelectorAll<HTMLIFrameElement>(
            ".marp-print-deck iframe",
          ),
        ].map(async (frame) => {
          if (
            frame.contentDocument?.URL !== "about:srcdoc" ||
            frame.contentDocument.readyState !== "complete"
          ) {
            await new Promise<void>((resolve) =>
              frame.addEventListener("load", () => resolve(), { once: true }),
            );
          }
          const doc = frame.contentDocument;
          if (doc) await prepareMarpDocument(doc);
          await doc?.fonts?.ready;
          await Promise.all(
            [...(doc?.images ?? [])].map((image) =>
              image.decode().catch(() => {}),
            ),
          );
        }),
      );
      await Promise.all(
        [
          ...document.querySelectorAll<HTMLImageElement>(
            ".slides-print-deck img",
          ),
        ].map((image) => image.decode().catch(() => {})),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      await send(title);
    } finally {
      setPrinting(false);
    }
  }, [begin, send, title]);
  return { printing, print };
}

/** A separate print surface leaves the selected slide and slideshow cursor untouched. */
export function SlidePrintDeck({
  active,
  deck,
  renderSlide,
}: {
  active: boolean;
  deck: Presentation;
  renderSlide: (slide: Slide) => ReactNode;
}) {
  const marpRender = useMemo(
    () => (active ? renderMarpPages(deck) : null),
    [active, deck],
  );
  useEffect(() => () => marpRender?.dispose(), [marpRender]);
  const marpPages = marpRender?.pages;
  if (!active) return null;
  if (marpPages) {
    const { width, height } = marpPages[0];
    return createPortal(
      <div
        className="slides-print-deck marp-print-deck"
        aria-hidden="true"
        style={{ width }}
      >
        <style>{`@page { size: ${width}px ${height}px; margin: 0; }
          @media print { .marp-print-deck .slides-print-page { width: ${width}px !important; height: ${height}px !important; } }`}</style>
        {marpPages.map((page, index) => (
          <div
            key={index}
            className="slides-print-page"
            data-print-slide={index + 1}
            style={{ width: page.width, height: page.height }}
          >
            <iframe
              title={`Print slide ${index + 1}`}
              sandbox="allow-same-origin allow-scripts"
              srcDoc={page.document}
              onLoad={(event) => {
                const frame = event.currentTarget;
                const doc = frame.contentDocument;
                if (!doc) return;
                void prepareMarpDocument(doc).then(
                  () => {
                    if (frame.contentDocument === doc)
                      frame.dataset.loaded = "true";
                  },
                  (error: unknown) => {
                    frame.dataset.renderError =
                      error instanceof Error ? error.message : String(error);
                    frame.dataset.loaded = "true";
                  },
                );
              }}
              style={{
                display: "block",
                border: 0,
                width: page.width,
                height: page.height,
              }}
            />
          </div>
        ))}
      </div>,
      document.body,
    );
  }
  const width = deck.width || 960,
    height = deck.height || 540;
  // Presentation dimensions become PDF points; container units scale all slide content.
  const cssWidth = (width * 4) / 3,
    cssHeight = (height * 4) / 3;
  return createPortal(
    <div
      className="slides-print-deck"
      aria-hidden="true"
      style={{ width: cssWidth }}
    >
      <style>{`@page { size: ${width}pt ${height}pt; margin: 0; }
      @media print { .slides-print-page { width: ${cssWidth}px !important; height: ${cssHeight}px !important; } }`}</style>
      {deck.slideOrder.map((id, index) => {
        const slide = deck.slides[id];
        if (!slide) return null;
        return (
          <div
            key={id}
            className={`slides-print-page show-slide slide-canvas${deck.marpFit ? " marp-fit" : ""}`}
            data-print-slide={index + 1}
            style={{
              width: cssWidth,
              height: cssHeight,
              backgroundColor:
                slide.background?.color ||
                deck.master?.background?.color ||
                "#ffffff",
            }}
          >
            <SlideMasterLayer
              deck={deck}
              font={(size) => `calc(${size} / ${width} * 100cqw)`}
            />
            {renderSlide(slide)}
            {deck.slideNumbers && (
              <div className="slide-number">{index + 1}</div>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
