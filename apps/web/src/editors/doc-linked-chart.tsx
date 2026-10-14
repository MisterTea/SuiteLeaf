import { Node, type Editor } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { storage } from "../storage";
import {
  applyChartUpdate,
  barWidthPercent,
  chartCaption,
  linkedChartAttrs,
  linkedChartDom,
  missingSpreadsheetText,
  sheetFromLibrary,
  updateChartName,
  type LinkedChartAttrs,
} from "./doc-chart";
import "./doc-chart.css";

function widthStyle(value: number, values: readonly number[]): string {
  const width = barWidthPercent(value, values);
  const shown = Math.round(width * 1000) / 1000;
  return `${shown}%`;
}

function paintChart(
  dom: HTMLElement,
  attrs: LinkedChartAttrs,
  editable: boolean,
  onUpdate: (button: HTMLButtonElement) => void,
) {
  dom.className = "linked-chart";
  dom.setAttribute("contenteditable", "false");
  dom.dataset.linkedChart = "true";
  dom.dataset.sourceId = attrs.sourceId;
  dom.dataset.sourceTitle = attrs.sourceTitle;
  dom.dataset.labels = JSON.stringify(attrs.labels);
  dom.dataset.values = JSON.stringify(attrs.values);
  dom.dataset.missing = attrs.missing ? "true" : "false";
  dom.setAttribute("role", "group");
  dom.setAttribute(
    "aria-label",
    `Chart from ${attrs.sourceTitle.trim() || "spreadsheet"}`,
  );

  const rows = document.createElement("div");
  rows.className = "linked-chart-rows";
  attrs.labels.forEach((label, index) => {
    const value = attrs.values[index] ?? 0;
    const row = document.createElement("div");
    row.className = "linked-chart-row";
    const name = document.createElement("span");
    name.className = "linked-chart-label";
    name.textContent = label;
    const track = document.createElement("span");
    track.className = "linked-chart-track";
    track.setAttribute("aria-hidden", "true");
    const bar = document.createElement("span");
    bar.className = "linked-chart-bar";
    bar.style.width = widthStyle(value, attrs.values);
    track.append(bar);
    const amount = document.createElement("span");
    amount.className = "linked-chart-value";
    amount.textContent = String(value);
    row.append(name, track, amount);
    rows.append(row);
  });

  const source = document.createElement("p");
  source.className = "linked-chart-source";
  source.textContent = chartCaption(attrs.sourceTitle);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "linked-chart-update";
  button.textContent = "Update";
  button.setAttribute("aria-label", updateChartName(attrs.sourceTitle));
  button.disabled = !editable;
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!(event.currentTarget instanceof HTMLButtonElement)) return;
    if (event.currentTarget.disabled) return;
    onUpdate(event.currentTarget);
  });

  dom.replaceChildren(rows, source);
  if (attrs.missing) {
    const missing = document.createElement("p");
    missing.className = "linked-chart-missing";
    missing.textContent = missingSpreadsheetText;
    dom.append(missing);
  }
  dom.append(button);
}

/** Put the chart at the caret. An empty paragraph is replaced; other text stays. */
export function insertLinkedChart(
  editor: Editor,
  attrs: Record<string, unknown>,
): boolean {
  return editor
    .chain()
    .focus()
    .command(({ state, tr, dispatch }) => {
      const type = state.schema.nodes.linkedChart;
      if (!type) return false;
      const { $from } = state.selection;
      for (let depth = $from.depth; depth > 0; depth--)
        if ($from.node(depth).type.spec.tableRole) return false;
      const node = type.create(attrs);
      if ($from.parent.isTextblock) {
        const from = $from.before();
        const to = $from.after();
        if ($from.parent.content.size === 0) tr.replaceWith(from, to, node);
        else tr.insert(to, node);
      } else tr.replaceSelectionWith(node);
      if (!tr.docChanged) return false;
      if (dispatch) dispatch(tr.scrollIntoView());
      return true;
    })
    .run();
}

/** A document chart drawn from a library spreadsheet's cells. */
export const LinkedChart = Node.create({
  name: "linkedChart",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      sourceId: { default: "" },
      sourceTitle: { default: "" },
      labels: { default: null, rendered: false },
      values: { default: null, rendered: false },
      missing: { default: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-linked-chart]",
        getAttrs(element) {
          if (!(element instanceof HTMLElement)) return false;
          let labels: unknown = [];
          let values: unknown = [];
          try {
            labels = JSON.parse(element.dataset.labels || "[]");
            values = JSON.parse(element.dataset.values || "[]");
          } catch {
            labels = [];
            values = [];
          }
          return {
            sourceId: element.dataset.sourceId ?? "",
            sourceTitle: element.dataset.sourceTitle ?? "",
            labels,
            values,
            missing: element.dataset.missing === "true",
          };
        },
      },
    ];
  },

  renderHTML({ node }) {
    return linkedChartDom(node.attrs);
  },

  addNodeView() {
    return ({ node, view, getPos }) => {
      let current: ProseNode = node;
      let token = 0;
      const dom = document.createElement("div");

      const refresh = (button: HTMLButtonElement) => {
        if (!view.editable) return;
        const started = ++token;
        const pos = getPos();
        if (typeof pos !== "number") return;
        const before = view.state.doc.nodeAt(pos);
        if (!before || before.type.name !== "linkedChart") return;
        const attrs = linkedChartAttrs(before.attrs);
        button.disabled = true;
        void (async () => {
          let record: Awaited<ReturnType<typeof storage.get>>;
          try {
            record = attrs.sourceId ? await storage.get(attrs.sourceId) : undefined;
          } catch {
            if (started !== token || !button.isConnected) return;
            button.disabled = !view.editable;
            const notice = document.createElement("p");
            notice.className = "linked-chart-notice";
            notice.setAttribute("role", "alert");
            notice.textContent = "Could not read that spreadsheet.";
            button.before(notice);
            return;
          }
          if (started !== token) return;
          const posNow = getPos();
          if (typeof posNow !== "number") return;
          const nodeNow = view.state.doc.nodeAt(posNow);
          if (!nodeNow || nodeNow.type.name !== "linkedChart") return;
          const latest = linkedChartAttrs(nodeNow.attrs);
          const result = applyChartUpdate(latest, sheetFromLibrary(record));
          if (JSON.stringify(result.attrs) === JSON.stringify(latest)) {
            if (button.isConnected) button.disabled = !view.editable;
            if (result.error && button.isConnected) {
              const notice = document.createElement("p");
              notice.className = "linked-chart-notice";
              notice.setAttribute("role", "alert");
              notice.textContent = result.error;
              button.before(notice);
            }
            return;
          }
          view.dispatch(
            view.state.tr.setNodeMarkup(posNow, undefined, result.attrs),
          );
        })();
      };

      const render = () => {
        paintChart(dom, linkedChartAttrs(current.attrs), view.editable, refresh);
      };
      render();

      return {
        dom,
        update(next) {
          if (next.type.name !== "linkedChart") return false;
          current = next;
          render();
          return true;
        },
        selectNode() {
          dom.classList.add("ProseMirror-selectednode");
        },
        deselectNode() {
          dom.classList.remove("ProseMirror-selectednode");
        },
        stopEvent(event) {
          const target = event.target;
          return (
            target instanceof Element &&
            Boolean(target.closest(".linked-chart-update"))
          );
        },
        ignoreMutation() {
          return true;
        },
        destroy() {
          token += 1;
        },
      };
    };
  },
});
