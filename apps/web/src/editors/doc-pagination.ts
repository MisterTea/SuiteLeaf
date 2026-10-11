import { Extension, Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import {
  documentPageSettings,
  pageDimensions,
} from "@suiteleaf/core/document-layout";
import type { JsonNode } from "@suiteleaf/core";

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  parseHTML: () => [{ tag: "div[data-page-break]" }],
  renderHTML: () => [
    "div",
    {
      "data-page-break": "true",
      class: "manual-page-break",
      "aria-label": "Page break",
    },
  ],
});
export const paginationKey = new PluginKey<DecorationSet>(
  "suiteleaf-pagination",
);
type Boundary = {
  pos: number;
  top: number;
  bottom: number;
  row?: boolean;
  columns?: number;
  manual?: boolean;
};

/** Layout decorations never alter document content or enter undo history. */
export const DocumentPagination = Extension.create({
  name: "documentPagination",
  addGlobalAttributes() {
    return [
      {
        types: ["doc"],
        attributes: { pageSettings: { default: null, rendered: false } },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, previous) {
            return (
              tr.getMeta(paginationKey) ?? previous.map(tr.mapping, tr.doc)
            );
          },
        },
        props: { decorations: (state) => paginationKey.getState(state) },
        view(view) {
          let frame = 0,
            destroyed = false,
            measuring = false;
          const schedule = () => {
            if (destroyed || measuring) return;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => paginate());
          };
          const paginate = () => {
            if (destroyed) return;
            measuring = true;
            try {
              // Measure the natural flow once, then add all page spacers together.
              view.dispatch(
                view.state.tr
                  .setMeta(paginationKey, DecorationSet.empty)
                  .setMeta("addToHistory", false),
              );
              const settings = documentPageSettings(
                view.state.doc.toJSON() as JsonNode,
              );
              const { height } = pageDimensions(settings);
              const margin = settings.margin,
                bodyHeight = height - margin * 2;
              const origin = view.dom.getBoundingClientRect().top;
              const scale =
                view.dom.getBoundingClientRect().width /
                  (view.dom as HTMLElement).offsetWidth || 1;
              const boundaries: Boundary[] = [];
              view.state.doc.descendants((node, pos, parent) => {
                const dom = view.nodeDOM(pos);
                if (!(dom instanceof HTMLElement)) return;
                const rect = dom.getBoundingClientRect();
                const top = (rect.top - origin) / scale - margin;
                const bottom = (rect.bottom - origin) / scale - margin;
                if (node.type.name === "pageBreak") {
                  boundaries.push({ pos, top, bottom, manual: true });
                  return false;
                }
                if (node.type.name === "tableRow") {
                  boundaries.push({
                    pos,
                    top,
                    bottom,
                    row: true,
                    columns: Array.from(
                      dom.querySelectorAll<HTMLTableCellElement>(
                        ":scope > td, :scope > th",
                      ),
                    ).reduce((count, cell) => count + cell.colSpan, 0),
                  });
                  return false;
                }
                if (
                  node.type.name === "image" ||
                  node.type.name === "horizontalRule"
                ) {
                  boundaries.push({ pos, top, bottom });
                  return false;
                }
                if (
                  !node.isTextblock ||
                  parent?.type.name === "tableCell" ||
                  parent?.type.name === "tableHeader"
                )
                  return;
                if (bottom - top <= bodyHeight) {
                  boundaries.push({ pos, top, bottom });
                  return false;
                }
                // A paragraph taller than a page is split at visual line boundaries.
                boundaries.push(
                  ...textLines(view, dom, pos, origin, scale, margin),
                );
                return false;
              });
              boundaries.sort((a, b) => a.top - b.top || a.pos - b.pos);
              const decorations: Decoration[] = [];
              let added = 0,
                page = 0;
              for (const b of boundaries) {
                const top = b.top + added,
                  bottom = b.bottom + added;
                const end = page * (height + 24) + bodyHeight;
                if (
                  (bottom > end + 0.5 && top > page * (height + 24) + 0.5) ||
                  b.manual
                ) {
                  const gap = Math.max(0, end - top) + 2 * margin + 24;
                  decorations.push(
                    Decoration.widget(
                      b.pos,
                      () => {
                        const spacer = document.createElement(
                          b.row ? "tr" : "span",
                        );
                        spacer.className = "doc-page-spacer";
                        spacer.setAttribute("aria-hidden", "true");
                        spacer.contentEditable = "false";
                        spacer.style.setProperty("--spacer-height", `${gap}px`);
                        if (b.row) {
                          const cell = document.createElement("td");
                          cell.colSpan = b.columns || 1;
                          spacer.append(cell);
                        }
                        return spacer;
                      },
                      {
                        side: -1,
                        key: `page-${page}-${b.pos}`,
                        ignoreSelection: true,
                      },
                    ),
                  );
                  added += gap;
                  page++;
                }
              }
              const naturalBottom = Math.max(
                0,
                ...boundaries.map((b) => b.bottom),
              );
              const pages = Math.max(
                page + 1,
                Math.ceil(
                  (naturalBottom + added + margin * 2 + 24) / (height + 24),
                ),
              );
              view.dispatch(
                view.state.tr
                  .setMeta(
                    paginationKey,
                    DecorationSet.create(view.state.doc, decorations),
                  )
                  .setMeta("addToHistory", false),
              );
              view.dom.dispatchEvent(
                new CustomEvent("suiteleaf-pages", {
                  bubbles: true,
                  detail: pages,
                }),
              );
            } finally {
              measuring = false;
            }
          };
          let observedWidth = 0;
          const observer = new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect.width ?? 0;
            if (Math.abs(width - observedWidth) > 0.5) {
              observedWidth = width;
              schedule();
            }
          });
          observer.observe(view.dom);
          view.dom.addEventListener("load", schedule, true);
          document.fonts?.ready.then(schedule);
          schedule();
          return {
            update(v, previous) {
              if (!v.state.doc.eq(previous.doc)) schedule();
            },
            destroy() {
              destroyed = true;
              cancelAnimationFrame(frame);
              observer.disconnect();
              view.dom.removeEventListener("load", schedule, true);
            },
          };
        },
      }),
    ];
  },
});
function textLines(
  view: EditorView,
  dom: HTMLElement,
  pos: number,
  origin: number,
  scale: number,
  margin: number,
): Boundary[] {
  const lines = new Map<number, Boundary>();
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
  let text: globalThis.Node | null;
  while ((text = walker.nextNode())) {
    if (!text.textContent?.length) continue;
    const range = document.createRange();
    range.selectNodeContents(text);
    const rects = Array.from(range.getClientRects());
    for (const rect of rects) {
      const top = (rect.top - origin) / scale - margin;
      let lo = 0,
        hi = text.textContent.length - 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        range.setStart(text, mid);
        range.setEnd(text, mid + 1);
        if (range.getBoundingClientRect().top < rect.top - 0.5) lo = mid + 1;
        else hi = mid;
      }
      const key = Math.round(top);
      if (!lines.has(key))
        lines.set(key, {
          pos: view.posAtDOM(text, lo),
          top,
          bottom: (rect.bottom - origin) / scale - margin,
        });
    }
  }
  return lines.size ? [...lines.values()] : [{ pos, top: 0, bottom: 0 }];
}
