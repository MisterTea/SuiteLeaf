import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { sameJson, type Presentation } from "@suiteleaf/core";
import { prepareMarpDocument } from "./slide-marp-runtime";
import { renderMarpPages } from "./slide-marp-render";
import { SlideStill, slideBackground, slideBackgroundPaint } from "./slide-surface";

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
}: {
  active: boolean;
  deck: Presentation;
}) {
  // An equal deck keeps its pages: each render makes new documents, which reload every frame.
  const [shown, setShown] = useState(deck);
  if (shown !== deck && !sameJson(shown, deck)) setShown(deck);
  const marpRender = useMemo(
    () => (active ? renderMarpPages(shown) : null),
    [active, shown],
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
              // A new document gets a new frame, so no frame says it loaded one it has not prepared.
              key={page.document}
              title={`Print slide ${index + 1}`}
              sandbox="allow-same-origin allow-scripts"
              srcDoc={page.document}
              onLoad={(event) => {
                const frame = event.currentTarget;
                const doc = frame.contentDocument;
                if (!doc) return;
                // A frame moved in the page reloads its document: what was prepared is gone with it.
                doc.defaultView?.addEventListener("pagehide", () => {
                  delete frame.dataset.loaded;
                  delete frame.dataset.renderError;
                });
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
  const drawW = deck.width || 960,
    drawH = deck.height || 540;
  const width = deck.pointWidth || drawW,
    height = deck.pointHeight || drawH;
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
      @media print {
        .slides-print-page { width: ${cssWidth}px !important; height: ${cssHeight}px !important; }
        /* Transform scale leaves a blank margin when the drawing is larger than the page. */
        .slides-print-deck .slide-still > .slide-surface {
          zoom: var(--slide-fit, 1);
          transform: translate(var(--slide-fit-x, 0px), var(--slide-fit-y, 0px)) !important;
        }
      }`}</style>
      {deck.slideOrder.filter((id) => deck.slides[id] && !deck.slides[id].hidden).map((id, index) => {
        const slide = deck.slides[id];
        if (!slide) return null;
        return (
          <div
            key={id}
            className="slides-print-page"
            data-print-slide={index + 1}
            style={{
              width: cssWidth,
              height: cssHeight,
              ...slideBackgroundPaint(slideBackground(deck, slide)),
            }}
          >
            <SlideStill deck={deck} slide={slide} index={index} />
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
