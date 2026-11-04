import type { RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { generateHTML } from "@tiptap/core";
import { filename, type DocFile, type JsonNode } from "@suiteleaf/core";
import { listSuggestions, resolveSuggestions } from "@suiteleaf/core/suggestions";
import { documentHtml, documentPageSettings } from "@suiteleaf/core/document-layout";
import { exportBinary, exportText } from "../storage";
import { exportTabSections, exportTabsBodyHtml, exportTabsPlainText } from "./doc-export-tabs";
import { extensions } from "./doc-extensions";
import type { DocTabs } from "./doc-tabs";

export type DocSuggestionApi = {
  askPlainExport: () => Promise<"accepted" | "original" | null>;
  openReview: () => void;
};

/** Every tab of the document as PDF, Word, HTML, or plain text. */
export async function exportDocTabs(
  format: string,
  {
    editor,
    file,
    tabTitleRef,
    activeRef,
    firstBody,
    extrasRef,
    suggestionApi,
  }: {
    editor: Editor | null;
    file: DocFile;
    tabTitleRef: DocTabs["tabTitleRef"];
    activeRef: DocTabs["activeRef"];
    firstBody: RefObject<JsonNode>;
    extrasRef: DocTabs["extrasRef"];
    suggestionApi: RefObject<DocSuggestionApi | null>;
  },
) {
  if (!editor) return null;
  const activeJson = editor.getJSON() as JsonNode;
  const saved = exportTabSections(
    {
      title: tabTitleRef.current,
      content: activeRef.current === 0 ? activeJson : firstBody.current,
    },
    extrasRef.current.map((tab, index) => ({
      title: tab.title,
      content: activeRef.current === index + 1 ? activeJson : tab.content,
    })),
  );
  let choice: "accepted" | "original" | null = null;
  if (
    (format === "html" || format === "txt") &&
    saved.some((section) => listSuggestions(section.content).length)
  ) {
    choice = (await suggestionApi.current?.askPlainExport()) ?? null;
    if (!choice) return null;
  }
  const picked = choice;
  const sections = picked
    ? saved.map((section) => ({
        ...section,
        content: resolveSuggestions(section.content, picked),
      }))
    : saved;
  if (format === "pdf") {
    const { documentPdf } = await import("@suiteleaf/core/doc-pdf");
    return exportBinary(
      filename(file.title, "pdf"),
      documentPdf(sections[0].content),
      "application/pdf",
    );
  }
  if (format === "docx") {
    const { exportReviewedDocx } = await import("@suiteleaf/core/review-docx");
    const labeled = saved.length > 1 || saved.some((section) => section.label);
    return exportBinary(
      filename(file.title, "docx"),
      await exportReviewedDocx(
        labeled
          ? {
              title: file.title,
              content: saved[0].content,
              sections: saved.map((section) => ({
                title: section.label,
                content: section.content,
              })),
            }
          : { title: file.title, content: saved[0].content },
      ),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  }
  const pageSettings = documentPageSettings(sections[0].content);
  if (format === "html")
    return exportText(
      filename(file.title, "html"),
      documentHtml(
        file.title,
        exportTabsBodyHtml(sections, (content, index) =>
          !choice && index === activeRef.current
            ? editor.getHTML()
            : generateHTML(content, extensions),
        ),
        pageSettings,
      ),
      "text/html",
    );
  return exportText(filename(file.title, "txt"), exportTabsPlainText(sections));
}
