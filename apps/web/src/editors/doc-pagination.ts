import { Extension, Node } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import {
  bodyEdgeInsets,
  documentPageSettings,
  pageDimensions,
} from "@suiteleaf/core/document-layout";
import type { JsonNode } from "@suiteleaf/core";
import { letterheadLiveEvent, readLiveEdges } from "./letterhead-live";
import { readLiveMargins } from "./margin-live";
import { readLiveOrientation } from "./landscape-live";
import { readLiveLetterhead } from "./letterhead-text-live";
import { readLivePaper } from "./paper-size-live";
import {
  breakPosBeforeList,
  keepWithNextBreak,
  keepsWithNext,
  markKeepNextLine,
  nextBlockType,
  staysWithFollowingBlock,
} from "./doc-keep-next";
import { annotateWidowLines, avoidSingleLine } from "./doc-widow-control";
import { keepParagraphTogether, keepsLines } from "./doc-keep-lines";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Start a new page at the caret and continue typing on it. */
      setPageBreak: () => ReturnType;
    };
  }
}

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  // The break has no height to click on; keyboard selection would leave the
  // caret on an invisible node where the next key replaces it.
  selectable: false,
  parseHTML: () => [{ tag: "div[data-page-break]" }],
  renderHTML: () => [
    "div",
    {
      "data-page-break": "true",
      class: "manual-page-break",
      "aria-label": "Page break",
    },
  ],
  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ state, chain }) => {
          const { $from } = state.selection;
          for (let depth = $from.depth; depth > 0; depth--)
            if ($from.node(depth).type.spec.tableRole) return false;
          return chain()
            .insertContent({ type: this.name })
            .command(({ tr, dispatch }) => {
              if (!dispatch) return true;
              let after = -1;
              tr.steps[tr.steps.length - 1]
                ?.getMap()
                .forEach((_oldStart, _oldEnd, start, end) =>
                  tr.doc.nodesBetween(start, end, (node, pos) => {
                    if (node.type.name === this.name)
                      after = pos + node.nodeSize;
                  }),
                );
              if (after < 0) return false;
              if (!tr.doc.resolve(after).nodeAfter?.isTextblock)
                tr.insert(after, state.schema.nodes.paragraph.create());
              tr.setSelection(TextSelection.create(tr.doc, after + 1));
              tr.scrollIntoView().setMeta(revealCaret, true);
              return true;
            })
            .run();
        },
    };
  },
});
export const paginationKey = new PluginKey<DecorationSet>(
  "suiteleaf-pagination",
);
/** Meta for an edit whose caret should stay in view once pages are laid out. */
const revealCaret = "suiteleaf-reveal-caret";
type Boundary = {
  pos: number;
  top: number;
  bottom: number;
  row?: boolean;
  columns?: number;
  manual?: boolean;
  /** The user asked this block to stay with the one after it. */
  keepNext?: boolean;
  /** This heading is where arabic page numbers restart at 1. */
  arabic?: boolean;
  /** 0-based page this block lands on, after breaks. */
  page?: number;
  /** Set on each visual line of a paragraph with widow/orphan control. */
  widowControl?: boolean;
  blockPos?: number;
  line?: number;
  lineCount?: number;
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
    let reveal = false;
    return [
      new Plugin({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, previous) {
            if (tr.getMeta(revealCaret)) reveal = true;
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
            // Removing the spacers to measure would let the browser's scroll
            // anchoring pull the view back toward the top.
            const scrolled: [HTMLElement, number][] = [];
            for (let el = view.dom.parentElement; el; el = el.parentElement)
              if (el.scrollTop) scrolled.push([el, el.scrollTop]);
            try {
              // Measure the natural flow once, then add all page spacers together.
              view.dispatch(
                view.state.tr
                  .setMeta(paginationKey, DecorationSet.empty)
                  .setMeta("addToHistory", false),
              );
              const saved = documentPageSettings(
                view.state.doc.toJSON() as JsonNode,
              );
              // Distances, margins, paper size, orientation, and header and
              // footer wording from the open Page setup dialog.
              const settings = {
                ...saved,
                ...readLiveEdges(view.dom as HTMLElement),
                ...readLiveMargins(view.dom as HTMLElement),
                ...readLivePaper(view.dom as HTMLElement),
                ...readLiveOrientation(view.dom as HTMLElement),
                ...readLiveLetterhead(view.dom as HTMLElement),
              };
              const { width, height } = pageDimensions(settings);
              const insets = bodyEdgeInsets(settings, width);
              const topMargin = insets.top,
                bottomMargin = insets.bottom,
                bodyHeight = height - topMargin - bottomMargin;
              const paper = view.dom.closest(".paginated-paper");
              if (paper instanceof HTMLElement) {
                paper.style.setProperty("--page-width", `${width}px`);
                paper.style.setProperty("--page-height", `${height}px`);
                paper.style.setProperty("--page-stride", `${height + 24}px`);
                paper.style.setProperty(
                  "--header-from-edge",
                  `${settings.headerFromEdge}px`,
                );
                paper.style.setProperty(
                  "--footer-from-edge",
                  `${settings.footerFromEdge}px`,
                );
                paper.style.setProperty("--body-inset-top", `${insets.top}px`);
                paper.style.setProperty(
                  "--body-inset-bottom",
                  `${insets.bottom}px`,
                );
              }
              const origin = view.dom.getBoundingClientRect().top;
              const scale =
                view.dom.getBoundingClientRect().width /
                  (view.dom as HTMLElement).offsetWidth || 1;
              const boundaries: Boundary[] = [];
              const reserves = noteReserves(view);
              view.state.doc.descendants((node, pos, parent) => {
                // Footnote bodies are positioned on the page that cites them.
                if (node.type.name === "note" && node.attrs.kind !== "endnote")
                  return false;
                const dom = view.nodeDOM(pos);
                if (!(dom instanceof HTMLElement)) return;
                const rect = dom.getBoundingClientRect();
                const top = (rect.top - origin) / scale - topMargin;
                const bottom = (rect.bottom - origin) / scale - topMargin;
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
                if (node.type.name === "columnLayout") {
                  // The two columns share one vertical band, so a page break
                  // belongs to the group rather than to each paragraph.
                  boundaries.push({ pos, top, bottom });
                  return false;
                }
                if (
                  !node.isTextblock ||
                  parent?.type.name === "tableCell" ||
                  parent?.type.name === "tableHeader"
                )
                  return;
                // A paragraph can break between lines, so widow control can
                // keep two of them together. Keep lines together, and
                // keep-with-next, each stay one block instead.
                const together = keepParagraphTogether(
                  keepsLines(node),
                  bottom - top,
                  bodyHeight,
                );
                if (
                  node.type.name === "paragraph" &&
                  node.textContent &&
                  !keepsWithNext(node) &&
                  !together
                ) {
                  const lines = textLines(
                    view,
                    dom,
                    pos,
                    origin,
                    scale,
                    topMargin,
                  );
                  lines.sort((a, b) => a.top - b.top || a.pos - b.pos);
                  if (lines.length > 1) {
                    const beforeList = breakPosBeforeList(view.state.doc, pos);
                    if (beforeList != null && lines[0]) lines[0].pos = beforeList;
                    boundaries.push(
                      ...(node.attrs.widowControl === true
                        ? annotateWidowLines(lines, pos, true)
                        : lines),
                    );
                    return false;
                  }
                }
                if (bottom - top <= bodyHeight) {
                  boundaries.push({
                    pos: breakPosBeforeList(view.state.doc, pos) ?? pos,
                    top,
                    bottom,
                    keepNext: staysWithFollowingBlock(
                      { type: node.type.name, keepNext: keepsWithNext(node) },
                      nextBlockType(parent, node),
                    ),
                    arabic:
                      node.type.name === "heading" &&
                      node.attrs.startArabic === true,
                  });
                  return false;
                }
                // A paragraph taller than a page is split at visual line boundaries.
                const lines = markKeepNextLine(
                  textLines(view, dom, pos, origin, scale, topMargin),
                  keepsWithNext(node),
                );
                boundaries.push(
                  ...(node.type.name === "paragraph" &&
                  node.attrs.widowControl === true
                    ? annotateWidowLines(lines, pos, true)
                    : lines),
                );
                return false;
              });
              boundaries.sort((a, b) => a.top - b.top || a.pos - b.pos);
              const decorations: Decoration[] = [];
              let added = 0,
                page = 0;
              for (const [i, next] of boundaries.entries()) {
                const start = page * (height + 24),
                  end = start + bodyHeight - (reserves[page] ?? 0);
                if (
                  (next.bottom + added > end + 0.5 &&
                    next.top + added > start + 0.5) ||
                  next.manual
                ) {
                  // Widow control keeps two lines of one paragraph together.
                  // Keep with next still carries a heading onto what follows.
                  const adjusted = next.manual
                    ? i
                    : avoidSingleLine(boundaries, i, start, added);
                  const first = keepWithNextBreak(
                    boundaries,
                    adjusted,
                    start,
                    added,
                  );
                  const b = boundaries[first];
                  for (let k = first; k <= i; k++) boundaries[k].page = page + 1;
                  const gap =
                    Math.max(0, end - (b.top + added)) +
                    topMargin +
                    bottomMargin +
                    24;
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
                } else if (next.page == null) next.page = page;
              }
              let arabicPage: number | null = null;
              for (const boundary of boundaries) {
                if (!boundary.arabic || boundary.page == null) continue;
                arabicPage =
                  arabicPage == null
                    ? boundary.page
                    : Math.min(arabicPage, boundary.page);
              }
              (view.dom as HTMLElement).dataset.arabicPage =
                arabicPage == null ? "" : String(arabicPage);
              const naturalBottom = Math.max(
                0,
                ...boundaries.map((b) => b.bottom),
              );
              const pages = Math.max(
                page + 1,
                Math.ceil(
                  (naturalBottom + added + topMargin + bottomMargin + 24) /
                    (height + 24),
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
              for (const [el, top] of scrolled) el.scrollTop = top;
              view.dom.dispatchEvent(
                new CustomEvent("suiteleaf-pages", {
                  bubbles: true,
                  detail: pages,
                }),
              );
              if (reveal) {
                reveal = false;
                // Wait a frame so the paper has grown to the new page count.
                requestAnimationFrame(() => {
                  if (destroyed) return;
                  const { node } = view.domAtPos(view.state.selection.head);
                  (node instanceof Element
                    ? node
                    : node.parentElement
                  )?.scrollIntoView({ block: "center" });
                });
              }
            } finally {
              measuring = false;
            }
          };
          let observedWidth = 0;
          let seenReserve = "";
          const observer = new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect.width ?? 0;
            if (Math.abs(width - observedWidth) > 0.5) {
              observedWidth = width;
              schedule();
            }
          });
          observer.observe(view.dom);
          view.dom.addEventListener("load", schedule, true);
          view.dom.addEventListener(letterheadLiveEvent, schedule);
          document.fonts?.ready.then(schedule);
          schedule();
          return {
            update(v, previous) {
              const reserve = (v.dom as HTMLElement).dataset.noteReserveGen ?? "";
              if (!v.state.doc.eq(previous.doc) || reserve !== seenReserve) {
                seenReserve = reserve;
                schedule();
              }
            },
            destroy() {
              destroyed = true;
              cancelAnimationFrame(frame);
              observer.disconnect();
              view.dom.removeEventListener("load", schedule, true);
              view.dom.removeEventListener(letterheadLiveEvent, schedule);
            },
          };
        },
      }),
    ];
  },
});
function noteReserves(view: EditorView): number[] {
  const raw = (view.dom as HTMLElement).dataset.noteReserve;
  if (!raw) return [];
  return raw.split(",").map((part) => {
    const n = Number(part);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  });
}

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
