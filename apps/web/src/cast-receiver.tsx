import { marpFragmentStep } from "./editors/slide-marp-fragments";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CAST_NAMESPACE, frameAssembler, type CastFrame } from "./editors/slide-cast-protocol";
import { showAudienceHooks } from "./editors/slide-show-audience";
import { SlideStill } from "./editors/slide-surface";
import "./style.css";
import "./editors/slide-fade-in.css";
import "./styles/cast-receiver.css";

type ReceiverContext = {
  addCustomMessageListener(namespace: string, listener: (event: { senderId: string; data: unknown }) => void): void;
  removeCustomMessageListener(namespace: string, listener: (event: { senderId: string; data: unknown }) => void): void;
  start(): void;
};

export function CastReceiver({ context }: { context?: ReceiverContext }) {
  const [frame, setFrame] = useState<CastFrame | null>(null);
  useEffect(() => {
    if (!context) return;
    let sender: string | undefined;
    let assemble = frameAssembler(setFrame);
    const receive = (event: { senderId: string; data: unknown }) => {
      if (sender !== event.senderId) { sender = event.senderId; assemble = frameAssembler(setFrame); }
      assemble(event.data);
    };
    context.addCustomMessageListener(CAST_NAMESPACE, receive);
    context.start();
    return () => context.removeCustomMessageListener(CAST_NAMESPACE, receive);
  }, [context]);
  if (!frame) return <main className="cast-waiting">{context ? "Ready to present with SuiteLeaf" : "Google Cast is unavailable."}</main>;
  const { deck, index, cursor, blank, page } = frame;
  const slide = deck.slides[deck.slideOrder[index]];
  const pages = page ? { pages: Array.from({ length: index + 1 }, () => page), dispose: () => {} } : null;
  return (
    <main className="cast-audience" aria-label="Audience slide">
      <div className="cast-slide" style={{ aspectRatio: `${deck.width || 960} / ${deck.height || 540}`, width: `min(100vw, calc(100vh * ${deck.width || 960} / ${deck.height || 540}))` }}>
        <SlideStill deck={deck} slide={slide} index={index} pages={pages} fragmentStep={marpFragmentStep(deck, index, cursor.revealed)} hooks={showAudienceHooks(slide, cursor)} />
        {blank ? <div className="cast-blank" style={{ backgroundColor: blank }} /> : null}
      </div>
    </main>
  );
}

const host = window as Window & { cast?: { framework: { CastReceiverContext: { getInstance(): ReceiverContext } } } };
const root = document.getElementById("root");
if (root) createRoot(root).render(<CastReceiver context={host.cast?.framework.CastReceiverContext.getInstance()} />);
