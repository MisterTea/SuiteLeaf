import { startTransition, useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** How long typing must pause before the slides follow the markdown. */
export const MARP_TYPING_PAUSE_MS = 500;

export type MarpDraft = { flush: () => void };

/**
 * The deck's markdown. Typing changes only this box; the slides follow once
 * typing pauses, when the box loses focus, or when `draftRef` is flushed, and
 * they redraw as a low-priority update that more typing can interrupt.
 */
export function MarpTextarea({
  source,
  readOnly,
  invalid,
  onCommit,
  areaRef,
  draftRef,
}: {
  source: string;
  readOnly: boolean;
  invalid: boolean;
  onCommit: (text: string) => void;
  areaRef: RefObject<HTMLTextAreaElement | null>;
  draftRef: RefObject<MarpDraft | null>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const text = pending.current;
    if (text === null) return;
    pending.current = null;
    // Clearing the draft in the same update shows the deck's markdown as the slides change.
    startTransition(() => {
      commitRef.current(text);
      setDraft(null);
    });
  }, []);

  useEffect(() => {
    draftRef.current = { flush };
    return () => {
      flush();
      draftRef.current = null;
    };
  }, [draftRef, flush]);

  return (
    <textarea
      ref={areaRef}
      className="marp-textarea"
      aria-label="Presentation markdown"
      aria-invalid={invalid || undefined}
      readOnly={readOnly}
      spellCheck={false}
      value={draft ?? source}
      onChange={(e) => {
        pending.current = e.target.value;
        setDraft(e.target.value);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, MARP_TYPING_PAUSE_MS);
      }}
      onBlur={flush}
    />
  );
}
