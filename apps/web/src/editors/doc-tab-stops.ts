import { Extension, Node } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/** One left tab stop, in inches from the paragraph's left edge (the page margin). */
export const TAB_STOP_MIN = 0.25;
export const TAB_STOP_MAX = 6.5;
const PX_PER_INCH = 96;
const DEFAULT_STEP = 0.5 * PX_PER_INCH;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tabStops: {
      /**
       * Set or clear the left tab stop on every paragraph in the selection.
       * `range` is the selection to change when the caret has already moved.
       */
      setTabStop: (
        inches: number | null,
        range?: { from: number; to: number },
      ) => ReturnType;
      /** Insert a tab that advances to this paragraph's stop. */
      insertTab: () => ReturnType;
    };
  }
}

export function parseTabStop(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return null;
  const inches = Math.round(n * 100) / 100;
  if (inches < TAB_STOP_MIN || inches > TAB_STOP_MAX) return null;
  return inches;
}

/** Next default stop (every half inch) strictly after `atPx`. */
export function nextDefaultTabPx(atPx: number): number {
  return (Math.floor((atPx + 0.01) / DEFAULT_STEP) + 1) * DEFAULT_STEP;
}

/**
 * Width of a tab so the text after it starts at the stop.
 * `atPx` is the tab's left edge. Only the first tab uses the paragraph stop;
 * anything already past it, and later tabs, use half-inch defaults.
 */
export function tabGapPx(
  atPx: number,
  stopInches: number | null,
  index: number,
): number {
  const custom =
    stopInches != null && index === 0 ? stopInches * PX_PER_INCH : null;
  const target =
    custom != null && atPx < custom - 0.5 ? custom : nextDefaultTabPx(atPx);
  return Math.max(0, target - atPx);
}

export const TabCharacter = Node.create({
  name: "tab",
  inline: true,
  group: "inline",
  atom: true,
  selectable: false,
  parseHTML: () => [{ tag: "span[data-tab]" }],
  renderHTML: () => [
    "span",
    { "data-tab": "true", class: "doc-tab", "aria-hidden": "true" },
  ],
  // The gap is applied as a width after layout. ProseMirror would otherwise
  // treat that style change as an edit and put the width back to zero.
  addNodeView() {
    return () => {
      const dom = document.createElement("span");
      dom.className = "doc-tab";
      dom.dataset.tab = "true";
      dom.setAttribute("aria-hidden", "true");
      return {
        dom,
        update: () => true,
        ignoreMutation: () => true,
      };
    };
  },
});

function tabStartPx(tab: HTMLElement, block: HTMLElement): number | null {
  if (tab.offsetParent === block) return tab.offsetLeft;
  const width = block.offsetWidth;
  const visual = block.getBoundingClientRect().width;
  const scale = width ? visual / width : 1;
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return (
    (tab.getBoundingClientRect().left - block.getBoundingClientRect().left) /
    scale
  );
}

/** Pull each tab out to its stop. The left edge stays put, so the width is the gap. */
export function layoutTabStops(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("p").forEach((block) => {
    const tabs = [...block.querySelectorAll<HTMLElement>(".doc-tab")].filter(
      (tab) => tab.closest("p") === block,
    );
    const inches = parseTabStop(block.getAttribute("data-tab-stop"));
    tabs.forEach((tab, index) => {
      const at = tabStartPx(tab, block);
      if (at == null) return;
      const width = `${Math.round(tabGapPx(at, inches, index) * 100) / 100}px`;
      if (tab.style.width !== width) tab.style.width = width;
    });
  });
}

const guideKey = new PluginKey("tabStopGuide");

function tabStopGuides(state: EditorState) {
  const widgets: ReturnType<typeof Decoration.widget>[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return;
    const inches = parseTabStop(node.attrs.tabStop);
    if (inches == null) return;
    widgets.push(
      Decoration.widget(
        pos + 1,
        () => {
          const mark = document.createElement("span");
          mark.className = "doc-tab-guide";
          mark.style.left = `${inches}in`;
          mark.setAttribute("aria-hidden", "true");
          return mark;
        },
        { side: -1, ignoreSelection: true, key: `tab-guide-${pos}-${inches}` },
      ),
    );
    return false;
  });
  return DecorationSet.create(state.doc, widgets);
}

const layoutKey = new PluginKey("tabStopLayout");

export const TabStops = Extension.create({
  name: "tabStops",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          tabStop: {
            default: null,
            parseHTML: (element) =>
              parseTabStop(element.getAttribute("data-tab-stop")),
            renderHTML: (attributes) => {
              const inches = parseTabStop(attributes.tabStop);
              if (inches == null) return {};
              return { "data-tab-stop": String(inches) };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setTabStop:
        (inches, range) =>
        ({ state, tr, dispatch }) => {
          const next = inches == null ? null : parseTabStop(inches);
          if (inches != null && next == null) return false;
          const from = range?.from ?? state.selection.from;
          const to = range?.to ?? state.selection.to;
          if (from < 0 || to > state.doc.content.size) return false;
          const positions: number[] = [];
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name !== "paragraph") return;
            positions.push(pos);
            return false;
          });
          if (!positions.length) return false;
          let changed = false;
          for (const pos of positions) {
            const node = tr.doc.nodeAt(pos);
            if (!node || node.attrs.tabStop === next) continue;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, tabStop: next });
            changed = true;
          }
          if (changed && dispatch) dispatch(tr);
          return true;
        },
      insertTab:
        () =>
        ({ editor, state, dispatch }) => {
          if (!editor.isEditable) return false;
          const { $from } = state.selection;
          for (let depth = $from.depth; depth > 0; depth--) {
            const node = $from.node(depth);
            if (node.type.name === "listItem" || node.type.spec.tableRole)
              return false;
          }
          if ($from.parent.type.name !== "paragraph") return false;
          // Keep a dragged selection intact so Tab does not leave the page.
          if (!state.selection.empty) return true;
          if (!dispatch) return true;
          dispatch(
            state.tr
              .replaceSelectionWith(state.schema.nodes.tab.create(), false)
              .scrollIntoView(),
          );
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      // Lists and tables keep Tab for indent and the next cell.
      Tab: () => this.editor.commands.insertTab(),
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: guideKey,
        props: {
          decorations(state) {
            return tabStopGuides(state);
          },
        },
      }),
      new Plugin({
        key: layoutKey,
        view(editorView) {
          let frame = 0;
          const run = () => {
            frame = 0;
            layoutTabStops(editorView.dom);
          };
          const schedule = () => {
            if (!frame) frame = requestAnimationFrame(run);
          };
          schedule();
          const observer = new ResizeObserver(schedule);
          observer.observe(editorView.dom);
          const paper = editorView.dom.closest(".paper");
          const mutations = new MutationObserver(schedule);
          if (paper)
            mutations.observe(paper, {
              attributes: true,
              attributeFilter: ["style"],
            });
          return {
            update: schedule,
            destroy() {
              cancelAnimationFrame(frame);
              observer.disconnect();
              mutations.disconnect();
            },
          };
        },
      }),
    ];
  },
});
