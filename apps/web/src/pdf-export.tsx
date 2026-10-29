import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { parseFile, type Presentation } from "@suiteleaf/core";
import { prepareMarpDocument } from "./editors/slide-marp-runtime";
import { loadEmbeddedFonts } from "./editors/slide-fonts";
import { SlidePrintDeck } from "./editors/slide-print";
import "./style.css";

/** The main process hands over one presentation at a time. It is not stored. */
declare global {
  interface Window {
    suiteleafPdf?: {
      listen(callback: (json: string) => void): void;
      ready(): void;
      fail(message: string): void;
    };
  }
}

function fail(message: string) {
  window.suiteleafPdf?.fail(message);
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

function PdfExport() {
  const [job, setJob] = useState<{ id: number; deck: Presentation } | null>(
    null,
  );
  useEffect(() => {
    let generation = 0;
    window.suiteleafPdf?.listen((json) => {
      const id = ++generation;
      try {
        const file = parseFile(json);
        if (file.kind !== "slide")
          throw new Error("Only a presentation can be exported as PDF.");
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
  if (!job) return null;
  return <SlidePrintDeck key={job.id} active deck={job.deck} />;
}

createRoot(document.getElementById("root")!).render(<PdfExport />);
