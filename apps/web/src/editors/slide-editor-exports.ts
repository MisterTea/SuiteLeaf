import { useCallback, useRef, type RefObject } from "react";
import { filename, serializeFile, type SlideFile } from "@suiteleaf/core";
import { exportBinary, exportText, printDocument } from "../storage";
import { useSlidePrint } from "./slide-print";
import { slidePlainText } from "./slide-plain-text";
import { deckToHtml } from "./slide-html";
import { deckToMarp } from "./slide-marp";
import type { MarpDraft } from "./slide-marp-textarea";
import type { SlidesEditorState } from "./slide-editor-state";

/** Printing, and saving the deck as text, HTML, markdown, PowerPoint, or pictures. */
export function useSlideExports(
  state: SlidesEditorState,
  { file, marpDraft }: { file: SlideFile; marpDraft: RefObject<MarpDraft | null> },
) {
  const { deckRef } = state;

  // Export handlers
  const { printing, print: printDeck } = useSlidePrint(file.title, printDocument);
  const printSlides = useCallback(() => {
    marpDraft.current?.flush();
    return printDeck();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor state's refs and setters are stable
  }, [printDeck]);

  const exportTxt = async () => {
    const current = deckRef.current;
    await exportText(filename(file.title, "txt"), slidePlainText(file.title, current.slideOrder, current.slides));
  };

  const exportHtml = async () => {
    await exportText(filename(file.title, "html"), deckToHtml(deckRef.current, file.title));
  };

  const exportMarp = async () => {
    const current = deckRef.current;
    await exportText(
      filename(file.title, "md"),
      current.marp && current.marpSource !== undefined ? current.marpSource : deckToMarp(current),
    );
  };

  const exportPptx = async () => {
    const { exportPptx: writePptx } = await import("@suiteleaf/core/pptx-export");
    await exportBinary(
      filename(file.title, "pptx"),
      await writePptx({ ...file, title: file.title, content: deckRef.current }),
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  };

  const exportPng = async () => {
    const save = window.suiteleaf?.exportSlidesPng;
    if (!save)
      throw new Error("PNG export is available in the SuiteLeaf desktop app.");
    await save(
      serializeFile({ ...file, title: file.title, content: deckRef.current }),
    );
  };

  const exportTxtRef = useRef(exportTxt);
  exportTxtRef.current = exportTxt;
  const exportHtmlRef = useRef(exportHtml);
  exportHtmlRef.current = exportHtml;
  const exportMarpRef = useRef(exportMarp);
  exportMarpRef.current = exportMarp;
  const exportPptxRef = useRef(exportPptx);
  exportPptxRef.current = exportPptx;
  const exportPngRef = useRef(exportPng);
  exportPngRef.current = exportPng;

  return {
    printing,
    printSlides,
    exportTxtRef,
    exportHtmlRef,
    exportMarpRef,
    exportPptxRef,
    exportPngRef,
  };
}

export type SlideExports = ReturnType<typeof useSlideExports>;
