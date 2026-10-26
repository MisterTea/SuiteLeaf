import { useEffect, useMemo, useRef, useState } from "react";
import type { Presentation } from "@suiteleaf/core";
import { SOURCE_LINES } from "./slide-marp-engine";
import { renderMarpPages, type MarpPages } from "./slide-marp-render";
import { prepareMarpDocument } from "./slide-marp-runtime";
import type { LineRange } from "./slide-marp-source";

export type { MarpPages };
/** A page's size and the document a frame shows for it. */
type FramePage = { width: number; height: number; document: string };

/** Hide the rendered blocks drawn from `lines`, so the box being edited is not shown twice. */
export function hideRenderedLines(doc: Document, lines: LineRange | null): boolean {
  let found = false;
  for (const node of doc.querySelectorAll<HTMLElement>(`[${SOURCE_LINES}]`)) {
    const match = /^(\d+),(\d+)$/.exec(node.getAttribute(SOURCE_LINES) ?? "");
    const inside =
      !!lines && !!match && Number(match[1]) >= lines[0] && Number(match[1]) < lines[1];
    node.style.visibility = inside ? "hidden" : "";
    found ||= inside;
  }
  return found;
}

/**
 * The deck as MARP draws it, with source lines, redrawn shortly after the
 * markdown changes unless paused. Unchanged pages carry over from the last
 * drawing, so the frames showing them do not reload.
 */
export function useMarpPages(deck: Presentation, { paused = false }: { paused?: boolean } = {}) {
  const [pages, setPages] = useState<MarpPages | null>(null);
  const deckRef = useRef(deck);
  deckRef.current = deck;
  const latest = useRef<MarpPages | null>(null);
  useEffect(() => {
    if (paused) return;
    const handle = window.setTimeout(() => {
      let next: MarpPages | null = null;
      try {
        next = renderMarpPages(deckRef.current, { sourceLines: true, previous: latest.current });
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
      }
      latest.current = next;
      setPages(next);
    }, 150);
    return () => window.clearTimeout(handle);
  }, [deck.marp, deck.marpSource, deck.marpAssets, deck.marpSourceDirty, paused]);
  useEffect(() => () => pages?.dispose(), [pages]);
  return pages;
}

/**
 * One MARP page in a sandboxed frame, scaled to fit its holder. A new drawing
 * loads out of sight and takes over once its pictures and diagrams are ready,
 * so the old one stays on screen meanwhile. `onCurrent` gets the shown
 * document while it draws `pageKey`, and null while it still shows another.
 */
export function MarpFrame({
  page,
  pageKey,
  className = "",
  frameClassName = "",
  onCurrent,
}: {
  page: FramePage | null;
  pageKey: number;
  className?: string;
  frameClassName?: string;
  onCurrent?: (doc: Document | null) => void;
}) {
  const [shown, setShown] = useState<{ document: string; key: number } | null>(null);
  const [fit, setFit] = useState({ scale: 1, x: 0, y: 0 });
  const shownRef = useRef<HTMLIFrameElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const onCurrentRef = useRef(onCurrent);
  onCurrentRef.current = onCurrent;
  const incoming = page && page.document !== shown?.document ? page.document : null;
  const current = !!page && shown?.key === pageKey;
  const width = page?.width ?? 1280;
  const height = page?.height ?? 720;

  useEffect(() => {
    if (page && shown && page.document === shown.document && shown.key !== pageKey)
      setShown({ document: shown.document, key: pageKey });
  }, [page, shown, pageKey]);

  useEffect(() => {
    onCurrentRef.current?.(current ? (shownRef.current?.contentDocument ?? null) : null);
  }, [current, shown]);
  useEffect(() => () => onCurrentRef.current?.(null), []);

  const mounted = !!page || !!shown;
  useEffect(() => {
    const box = holder.current;
    if (!box) return;
    const measure = () => {
      const w = box.clientWidth || width;
      const h = box.clientHeight || height;
      const scale = Math.min(w / width, h / height);
      setFit({ scale, x: (w - width * scale) / 2, y: (h - height * scale) / 2 });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [mounted, width, height]);

  if (!mounted) return null;
  const frame = (document: string, role: "shown" | "incoming") => (
    <iframe
      key={document}
      ref={role === "shown" ? shownRef : undefined}
      className={`marp-frame ${frameClassName}`}
      data-state={role}
      title="Slide as MARP draws it"
      aria-hidden="true"
      tabIndex={-1}
      sandbox="allow-same-origin allow-scripts"
      srcDoc={document}
      style={{
        width,
        height,
        transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
      }}
      onLoad={(event) => {
        if (role !== "incoming") return;
        const doc = event.currentTarget.contentDocument;
        const done = () => setShown({ document, key: pageKey });
        if (!doc) return done();
        void prepareMarpDocument(doc).then(done, done);
      }}
    />
  );
  return (
    <div ref={holder} className={`marp-frame-layer ${className}`} aria-hidden="true">
      {shown ? frame(shown.document, "shown") : null}
      {incoming ? frame(incoming, "incoming") : null}
    </div>
  );
}

/**
 * The slide as MARP draws it, behind the editable boxes. Authored HTML, CSS,
 * diagrams, and charts look exactly as they will in the slideshow. While a box
 * is being edited the picture stays as it was and that box's blocks are hidden.
 */
export function MarpBackdrop({
  pages,
  index,
  live,
  plain = false,
  onPainted,
}: {
  pages: MarpPages | null;
  index: number;
  live: LineRange | null;
  /** Show the page without source lines, which nothing here hides. */
  plain?: boolean;
  onPainted: (painted: boolean) => void;
}) {
  const [doc, setDoc] = useState<Document | null>(null);
  const source = pages?.pages[index] ?? null;
  const page = useMemo(
    () =>
      source && {
        width: source.width,
        height: source.height,
        document: plain ? source.plain : source.document,
      },
    [source, plain],
  );
  useEffect(() => {
    if (!doc) return onPainted(false);
    const hidden = hideRenderedLines(doc, live);
    onPainted(!live || hidden);
  }, [doc, live, onPainted]);
  return (
    <MarpFrame
      page={page}
      pageKey={index}
      className="marp-backdrop-layer"
      frameClassName="marp-backdrop"
      onCurrent={setDoc}
    />
  );
}
