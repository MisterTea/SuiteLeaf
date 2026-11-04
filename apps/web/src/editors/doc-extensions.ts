import { Extension, generateJSON, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { croppableImage } from "./doc-image-crop";
import { inlineImage } from "./doc-image-inline";
import { TableKit } from "@tiptap/extension-table";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import CharacterCount from "@tiptap/extension-character-count";
import DOMPurify from "dompurify";
import { safeLink, type JsonNode } from "@suiteleaf/core";
import { DocumentSearchHighlight } from "./doc-search-plugin";
import { commentExtensions } from "./doc-comments";
import { Suggestions } from "./doc-suggestions";
import { DocumentPagination, PageBreak } from "./doc-pagination";
import { Grammar } from "./doc-grammar";
import { TabCharacter, TabStops } from "./doc-tab-stops";
import { Proofing } from "./doc-spelling";
import { documentNotes } from "./doc-notes";
import { IndexMark } from "./index-mark";
import { documentCitations } from "./doc-citations";
import { Equation } from "./doc-equations";
import { TextBox } from "./doc-text-box";
import { DocShape } from "./doc-shape";
import { ArabicNumberStart } from "./doc-arabic-start";
import { paragraphLineSpacing } from "./doc-line-spacing";
import { paragraphSpacing } from "./doc-paragraph-spacing";
import { paragraphIndent } from "./doc-paragraph-indent";
import { columnLayout } from "./doc-columns";
import { KeepWithNext } from "./doc-keep-next";
import { WidowControl } from "./doc-widow-control";
import { KeepLines } from "./doc-keep-lines";
import { normalText } from "./doc-normal-text";
import { LinkedChart } from "./doc-linked-chart";
import { SectionBreak } from "./doc-section-break";
import { acceptUndoExtension } from "../ai/accept-undo";

export const extensions: Extensions = [
  DocumentPagination,
  PageBreak,
  SectionBreak,
  columnLayout,
  ArabicNumberStart,
  ...documentNotes,
  ...documentCitations,
  StarterKit.configure({
    undoRedo: false,
    link: { openOnClick: false, isAllowedUri: (url) => safeLink(url) },
  }),
  TextStyleKit,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  paragraphLineSpacing,
  paragraphSpacing,
  paragraphIndent,
  KeepWithNext,
  WidowControl,
  KeepLines,
  normalText,
  croppableImage,
  inlineImage,
  TableKit.configure({ table: { resizable: true } }),
  CharacterCount,
  DocumentSearchHighlight,
  ...commentExtensions,
  Suggestions,
  Proofing,
  IndexMark,
  Grammar,
  Superscript,
  Subscript,
  Equation,
  TextBox,
  DocShape,
  LinkedChart,
  TabCharacter,
  TabStops,
  Extension.create({
    name: "suiteleafStrikeShortcut",
    addKeyboardShortcuts() {
      return {
        "Mod-Shift-x": () => this.editor.commands.toggleStrike(),
      };
    },
  }),
  Extension.create({
    name: "importAttributes",
    addGlobalAttributes() {
      return [
        {
          types: [
            "paragraph",
            "heading",
            "listItem",
            "tableCell",
            "tableHeader",
          ],
          attributes: { id: { default: null }, dir: { default: null } },
        },
        // Named styles from Word or the styles panel. Without these the editor drops them on load.
        {
          types: ["doc"],
          attributes: {
            paragraphStyles: { default: null, rendered: false },
            characterStyles: { default: null, rendered: false },
          },
        },
        {
          types: ["paragraph", "heading"],
          attributes: {
            styleId: { default: null, rendered: false },
            direct: { default: null, rendered: false },
          },
        },
      ];
    },
  }),
  acceptUndoExtension,
];

export function importHTML(html: string): JsonNode {
  const clean = DOMPurify.sanitize(html, {
    ADD_DATA_URI_TAGS: ["img"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "style"],
  });
  const container = document.createElement("div");
  container.innerHTML = clean;
  container.querySelectorAll("img").forEach((img) => {
    if (!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(img.src))
      img.remove();
  });
  container.querySelectorAll("a").forEach((a) => {
    if (!safeLink(a.getAttribute("href") ?? "")) a.removeAttribute("href");
  });
  return generateJSON(container.innerHTML, extensions) as JsonNode;
}
