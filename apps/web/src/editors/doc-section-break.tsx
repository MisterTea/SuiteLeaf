import { useState } from "react";
import { Node } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  pageNumberText,
  restartedSectionTotal,
  type PageNumberFormat,
  type PageFace,
} from "@suiteleaf/core/document-layout";

export type DocSection = {
  /** 0-based page where this section starts. */
  page: number;
  header: string;
  footer: string;
  /** When set, this page is that number and the next pages count up from it. */
  restartAt: number | null;
};

export type SectionAttrs = {
  header: string;
  footer: string;
  restartAt: number | null;
};

const text = (value: unknown) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 200) : "";

export function sectionAttrs(attrs: Record<string, unknown> | undefined): SectionAttrs {
  const restart = attrs?.restartAt;
  const restartAt =
    typeof restart === "number" && Number.isInteger(restart) && restart >= 1 && restart <= 9999
      ? restart
      : null;
  return { header: text(attrs?.header), footer: text(attrs?.footer), restartAt };
}

/** The section that owns a page. Pages before the first mark use the document. */
export function sectionAt(sections: readonly DocSection[], pageIndex: number): DocSection | null {
  let current: DocSection | null = null;
  for (const section of sections) {
    if (section.page <= pageIndex) current = section;
    else break;
  }
  return current;
}

/**
 * A section can replace the header and footer and restart the printed number.
 * An empty header or footer keeps the document's letterhead for that edge.
 */
export function applySection(
  face: PageFace,
  sections: readonly DocSection[],
  pageIndex: number,
  pageCount: number,
  format: PageNumberFormat,
): PageFace {
  const section = sectionAt(sections, pageIndex);
  if (!section) return face;
  const header = section.header || face.header;
  const footer = section.footer || face.footer;
  if (section.restartAt == null || face.numberSide === "none")
    return { ...face, header, footer };
  const page = section.restartAt + pageIndex - section.page;
  let end = pageCount;
  for (const later of sections) {
    if (later.page > section.page && later.page < end) end = later.page;
  }
  const total = restartedSectionTotal(section.restartAt, section.page, end);
  return {
    ...face,
    header,
    footer,
    pageNumber: pageNumberText(format, page, Math.max(page, total)),
  };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sectionBreak: {
      /** Start a new section on the next page. */
      setSectionBreak: (attrs: SectionAttrs) => ReturnType;
    };
  }
}

export const SectionBreak = Node.create({
  name: "sectionBreak",
  group: "block",
  atom: true,
  selectable: false,
  addAttributes() {
    return {
      header: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-header") ?? "",
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.header ? { "data-header": attributes.header } : {},
      },
      footer: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-footer") ?? "",
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.footer ? { "data-footer": attributes.footer } : {},
      },
      restartAt: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute("data-restart-at");
          if (raw == null || raw === "") return null;
          return sectionAttrs({ restartAt: Number(raw) }).restartAt;
        },
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.restartAt == null ? {} : { "data-restart-at": attributes.restartAt },
      },
    };
  },
  parseHTML: () => [{ tag: "div[data-section-break]" }],
  renderHTML({ HTMLAttributes }) {
    const header = HTMLAttributes["data-header"];
    const label = header ? `Section break · ${header}` : "Section break";
    return [
      "div",
      {
        ...HTMLAttributes,
        "data-section-break": "true",
        class: "section-break",
        "aria-label": label,
      },
      label,
    ];
  },
  addCommands() {
    return {
      setSectionBreak:
        (attrs) =>
        ({ state, chain }) => {
          const { $from } = state.selection;
          for (let depth = $from.depth; depth > 0; depth--) {
            const parent = $from.node(depth);
            // A section break inside a table or a column layout would not
            // start a page. Page breaks stay where they are; a section has
            // to be refused here and honored later if one was already stored.
            if (parent.type.spec.tableRole || parent.type.name === "columnLayout") return false;
          }
          const stored = sectionAttrs(attrs);
          return chain()
            .insertContent({ type: this.name, attrs: stored })
            .command(({ tr, dispatch }) => {
              if (!dispatch) return true;
              let after = -1;
              tr.steps[tr.steps.length - 1]
                ?.getMap()
                .forEach((_oldStart, _oldEnd, start, end) =>
                  tr.doc.nodesBetween(start, end, (node, pos) => {
                    if (node.type.name === this.name) after = pos + node.nodeSize;
                  }),
                );
              if (after < 0) return false;
              if (!tr.doc.resolve(after).nodeAfter?.isTextblock)
                tr.insert(after, state.schema.nodes.paragraph.create());
              tr.setSelection(TextSelection.create(tr.doc, after + 1));
              tr.scrollIntoView();
              return true;
            })
            .run();
        },
    };
  },
});

export function SectionBreakDialog({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert: (attrs: SectionAttrs) => void;
}) {
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [restart, setRestart] = useState(true);
  const [start, setStart] = useState("1");
  const restartAt = restart ? Math.min(9999, Math.max(1, Number(start) || 1)) : null;
  return (
    <div className="gdocs-modal-overlay" onClick={onClose}>
      <form
        className="gdocs-dialog feature-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Section break"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onInsert(sectionAttrs({ header, footer, restartAt }));
          onClose();
        }}
      >
        <div className="dialog-header">
          <h2>Section break</h2>
          <button type="button" className="dialog-close-btn" aria-label="Close section break" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="dialog-body">
          <p className="page-setup-hint">
            The next page starts a new section. Leave a header or footer blank to keep the one from Page setup.
          </p>
          <label>
            Header
            <input
              aria-label="Section header"
              value={header}
              maxLength={200}
              onChange={(event) => setHeader(event.target.value)}
            />
          </label>
          <label>
            Footer
            <input
              aria-label="Section footer"
              value={footer}
              maxLength={200}
              onChange={(event) => setFooter(event.target.value)}
            />
          </label>
          <label className="page-setup-check">
            <input
              type="checkbox"
              checked={restart}
              onChange={(event) => setRestart(event.target.checked)}
            />
            Restart page numbers
          </label>
          {restart ? (
            <label>
              Start at
              <input
                aria-label="Section page start"
                inputMode="numeric"
                value={start}
                onChange={(event) => setStart(event.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </label>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="dialog-primary-btn">
            Insert section break
          </button>
        </div>
      </form>
    </div>
  );
}
