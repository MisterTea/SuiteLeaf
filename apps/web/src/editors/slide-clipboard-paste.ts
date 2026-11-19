import { useEffect, useRef, type RefObject } from "react";
import { clipboardImageFromApi, pastedImageFiles, readImageFile } from "./clipboard-image";
import { rememberMarpImage } from "./slide-marp-diff";
import { replaceSourceText, sourceSelection, sourceValue } from "./slide-source-control";
import type { SlidesEditorState } from "./slide-editor-state";

/** Where a paste landed, so a picture can go on the slide without stealing a text field. */
export type SlidePasteWhere = "canvas" | "text" | "marp" | "ignore";

export function slidePasteWhere(target: EventTarget | null): SlidePasteWhere {
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (!element) return "canvas";
  if (element.closest("[role='dialog']")) return "ignore";
  if (element.closest("textarea.marp-textarea")) return "marp";
  if (element.closest("textarea.notes-textarea, .notes-textarea")) return "ignore";
  if (element.closest(".element-textarea, .element-editor")) return "text";
  if (element.closest("input, textarea, select, [contenteditable='true']")) return "ignore";
  return "canvas";
}

/** Newlines that keep a pasted picture on its own line in the markdown. */
export function marpInsertion(before: string, after: string, markdown: string): string {
  const gap = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const tail = !after || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  return `${gap}${markdown}${tail}`;
}

function pictureMarkdown(name: string, src: string, assets: Record<string, string>): string {
  const alt = name.replace(/\.[a-z0-9]+$/i, "").replace(/[[\]]/g, "").trim();
  const path = rememberMarpImage(src, alt || name, assets);
  return `![${alt}](${path.includes(" ") ? `<${path}>` : path})`;
}

/**
 * Paste of a system-clipboard picture.
 * A real Cmd/Ctrl+V is left for the paste event. The returned function reports
 * whether it took that shortcut, so the key handler does not eat the event.
 */
export function useSlideClipboardPaste(
  state: SlidesEditorState,
  {
    insertImageFile,
    pasteClipboard,
    marpDraft,
    onMarpChange,
    onError,
  }: {
    insertImageFile: (file: File) => Promise<void> | void;
    pasteClipboard: () => void;
    marpDraft: RefObject<{ flush: () => void } | null>;
    onMarpChange: (text: string) => void;
    onError: (message: string) => void;
  },
): RefObject<(event: KeyboardEvent) => boolean> {
  const { clipboard, deckRef, presentingRef, handoutsRef, readOnlyRef, marpAreaRef } = state;
  const insertRef = useRef(insertImageFile);
  insertRef.current = insertImageFile;
  const pasteRef = useRef(pasteClipboard);
  pasteRef.current = pasteClipboard;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const marpChangeRef = useRef(onMarpChange);
  marpChangeRef.current = onMarpChange;
  const stamp = useRef(0);
  const holdPaste = useRef<(event: KeyboardEvent) => boolean>(() => false);

  const takeImage = (files: File[]) => {
    const clip = clipboard.current;
    return files.length > 0 && (!clip || clip.system === true);
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (presentingRef.current || handoutsRef.current || readOnlyRef.current) return;
      const where = slidePasteWhere(event.target);
      if (where === "ignore") return;
      const images = pastedImageFiles(event.clipboardData);
      if (takeImage(images)) {
        event.preventDefault();
        event.stopPropagation();
        stamp.current++;
        if (where === "marp") void pasteMarp(images, event.target);
        else void pasteSlide(images);
        return;
      }
      if (where !== "canvas" || !event.isTrusted) return;
      event.preventDefault();
      stamp.current++;
      pasteRef.current();
    };

    const pasteSlide = async (files: File[]) => {
      for (const file of files) await insertRef.current(file);
    };

    const pasteMarp = async (files: File[], target: EventTarget | null) => {
      const area =
        target instanceof HTMLTextAreaElement ? target : marpAreaRef.current;
      if (!area) {
        await pasteSlide(files);
        return;
      }
      const assets = { ...(deckRef.current.marpAssets ?? {}) };
      const parts: string[] = [];
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) {
          errorRef.current("Please choose an image smaller than 5 MB.");
          continue;
        }
        try {
          parts.push(pictureMarkdown(file.name, await readImageFile(file), assets));
        } catch {
          errorRef.current("This image could not be read.");
        }
      }
      if (!parts.length) return;
      deckRef.current = { ...deckRef.current, marpAssets: assets };
      const source = sourceValue(area);
      const selection = sourceSelection(area);
      replaceSourceText(
        area,
        selection.start,
        selection.end,
        marpInsertion(source.slice(0, selection.start), source.slice(selection.end), parts.join("\n\n")),
      );
      // The markdown box records its own draft on a timer. Commit now, with the picture stored on the deck.
      marpChangeRef.current(sourceValue(area));
      marpDraft.current?.flush();
    };

    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
    // The editor state's refs, and the refs copied above, stay put.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  holdPaste.current = (event: KeyboardEvent) => {
    if (!event.isTrusted) return false;
    const id = ++stamp.current;
    window.setTimeout(() => {
      if (stamp.current !== id || readOnlyRef.current || presentingRef.current || handoutsRef.current) return;
      stamp.current++;
      pasteRef.current();
    }, 0);
    return true;
  };
  return holdPaste;
}

/** A picture from the system clipboard when this paste has no paste event. */
export async function slideClipboardImage(
  clip: { system?: boolean } | null,
): Promise<File | null> {
  if (clip && clip.system !== true) return null;
  return clipboardImageFromApi();
}
