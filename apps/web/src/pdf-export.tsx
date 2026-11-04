import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseFile, type Presentation, type Slide } from "@suiteleaf/core";
import { prepareMarpDocument } from "./editors/slide-marp-runtime";
import { loadEmbeddedFonts } from "./editors/slide-fonts";
import { renderMarpPages } from "./editors/slide-marp-render";
import { SlidePrintDeck } from "./editors/slide-print";
import { SlideStill } from "./editors/slide-surface";
import "./style.css";

/** The main process hands over one presentation at a time. It is not stored. */
declare global {
  interface Window {
    suiteleafPdf?: {
      listen(callback: (json: string) => void): void;
      listenPng(callback: (json: string) => void): void;
      onPngNext(callback: () => void): void;
      ready(): void;
      fail(message: string): void;
      pngFail(message: string): void;
      slide(bounds: {
        index: number;
        x: number;
        y: number;
        width: number;
        height: number;
        count: number;
      }): void;
    };
  }
}

function fail(message: string) {
  window.suiteleafPdf?.fail(message);
}

function pngFail(message: string) {
  window.suiteleafPdf?.pngFail(message);
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitUntil(check: () => boolean, label: string) {
  const deadline = performance.now() + 90_000;
  while (performance.now() < deadline) {
    if (check()) return;
    await nextFrame();
  }
  if (!check()) throw new Error(label);
}

/** Match the on-screen print command: draw every slide, then let the host print. */
async function settle(
  expectedPages: number,
  fonts: Parameters<typeof loadEmbeddedFonts>[0],
) {
  await loadEmbeddedFonts(fonts);
  await waitUntil(
    () =>
      document.querySelectorAll(".slides-print-page").length >= expectedPages,
    "The presentation did not finish drawing.",
  );
  await document.fonts?.ready;
  const frames = [
    ...document.querySelectorAll<HTMLIFrameElement>(".marp-print-deck iframe"),
  ];
  await Promise.all(
    frames.map(async (frame) => {
      await waitUntil(
        () => frame.dataset.loaded === "true" || !!frame.dataset.renderError,
        "A slide did not finish drawing.",
      );
      if (frame.dataset.renderError) throw new Error(frame.dataset.renderError);
      const doc = frame.contentDocument;
      if (doc) await prepareMarpDocument(doc);
      await doc?.fonts?.ready;
      await Promise.all(
        [...(doc?.images ?? [])].map((image) => image.decode().catch(() => {})),
      );
    }),
  );
  await Promise.all(
    [
      ...document.querySelectorAll<HTMLImageElement>(".slides-print-deck img"),
    ].map((image) => image.decode().catch(() => {})),
  );
  await nextFrame();
  await nextFrame();
}

function orderedSlides(deck: Presentation) {
  return deck.slideOrder.filter((id) => deck.slides[id]);
}

/** One slide at the top left, at its own pixel size, for the host to capture. */
function PngSlide({ deck, index }: { deck: Presentation; index: number }) {
  const ids = orderedSlides(deck);
  const id = ids[index];
  const slide = id ? deck.slides[id] : undefined;
  const orderIndex = id ? deck.slideOrder.indexOf(id) : index;
  const marp = useMemo(() => renderMarpPages(deck), [deck]);
  useEffect(() => () => marp?.dispose(), [marp]);
  const page = marp?.pages[index];
  const width = page?.width || deck.width || 960;
  const height = page?.height || deck.height || 540;
  useEffect(() => {
    if (!slide) {
      pngFail(
        index === 0
          ? "This presentation has no slides."
          : "A slide disappeared during export.",
      );
      return;
    }
    let cancel = false;
    void (async () => {
      try {
        await loadEmbeddedFonts(deck.fonts);
        await document.fonts?.ready;
        const frame = document.querySelector(".slides-png-frame");
        const embedded = frame?.querySelector("iframe");
        if (embedded instanceof HTMLIFrameElement) {
          await waitUntil(
            () =>
              embedded.dataset.loaded === "true" ||
              !!embedded.dataset.renderError,
            "A slide did not finish drawing.",
          );
          if (embedded.dataset.renderError)
            throw new Error(embedded.dataset.renderError);
          const doc = embedded.contentDocument;
          if (doc) await prepareMarpDocument(doc);
          await doc?.fonts?.ready;
        }
        await Promise.all(
          [
            ...(frame?.querySelectorAll("img") ?? []),
            ...(frame?.querySelector("iframe")?.contentDocument?.images ?? []),
          ].map((image) => image.decode().catch(() => {})),
        );
        await nextFrame();
        await nextFrame();
        if (cancel) return;
        const box = document
          .querySelector(".slides-png-frame")
          ?.getBoundingClientRect();
        if (!box || box.width < 1 || box.height < 1)
          throw new Error("The slide did not finish drawing.");
        window.suiteleafPdf?.slide({
          index,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          count: ids.length,
        });
      } catch (error) {
        if (!cancel)
          pngFail(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancel = true;
    };
  }, [deck.fonts, height, id, ids.length, index, slide, width]);
  if (!slide) return null;
  return (
    <div
      className="slides-png-frame"
      data-export-index={index}
      style={{ width, height }}
    >
      {page ? (
        <iframe
          key={page.document}
          title={`Slide ${index + 1}`}
          sandbox="allow-same-origin allow-scripts"
          srcDoc={page.document}
          onLoad={(event) => {
            const frame = event.currentTarget;
            const doc = frame.contentDocument;
            if (!doc) return;
            void prepareMarpDocument(doc).then(
              () => {
                if (frame.contentDocument === doc) frame.dataset.loaded = "true";
              },
              (error: unknown) => {
                frame.dataset.renderError =
                  error instanceof Error ? error.message : String(error);
                frame.dataset.loaded = "true";
              },
            );
          }}
          style={{ display: "block", border: 0, width, height }}
        />
      ) : (
        <SlideStill
          deck={deck}
          slide={slide as Slide}
          index={orderIndex}
        />
      )}
    </div>
  );
}

function PdfExport() {
  const [job, setJob] = useState<{ id: number; deck: Presentation } | null>(
    null,
  );
  const [png, setPng] = useState<{
    id: number;
    deck: Presentation;
    index: number;
  } | null>(null);
  useEffect(() => {
    let generation = 0;
    let pngDeck: Presentation | null = null;
    let pngIndex = 0;
    const showPng = (deck: Presentation, index: number) => {
      pngDeck = deck;
      pngIndex = index;
      setPng({ id: ++generation, deck, index });
    };
    window.suiteleafPdf?.listenPng((json) => {
      try {
        const file = parseFile(json);
        if (file.kind !== "slide")
          throw new Error("Only a presentation can be exported as PNG.");
        setJob(null);
        showPng(file.content, 0);
      } catch (error) {
        setPng(null);
        pngFail(error instanceof Error ? error.message : String(error));
      }
    });
    window.suiteleafPdf?.onPngNext(() => {
      if (!pngDeck) return;
      const count = orderedSlides(pngDeck).length;
      if (pngIndex + 1 >= count) return;
      showPng(pngDeck, pngIndex + 1);
    });
    window.suiteleafPdf?.listen((json) => {
      const id = ++generation;
      try {
        const file = parseFile(json);
        if (file.kind !== "slide")
          throw new Error("Only a presentation can be exported as PDF.");
        setPng(null);
        setJob({ id, deck: file.content });
      } catch (error) {
        setJob(null);
        fail(error instanceof Error ? error.message : String(error));
      }
    });
  }, []);
  useEffect(() => {
    if (!job) return;
    const id = job.id;
    let cancel = false;
    void (async () => {
      try {
        await settle(
          job.deck.slideOrder.filter((id) => !job.deck.slides[id]?.hidden)
            .length,
          job.deck.fonts,
        );
        if (!cancel && id === job.id) window.suiteleafPdf?.ready();
      } catch (error) {
        if (!cancel)
          fail(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancel = true;
    };
  }, [job]);
  if (png) return <PngSlide key={png.id} deck={png.deck} index={png.index} />;
  if (!job) return null;
  return <SlidePrintDeck key={job.id} active deck={job.deck} />;
}

createRoot(document.getElementById("root")!).render(<PdfExport />);
