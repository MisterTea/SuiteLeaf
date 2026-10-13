import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { X } from "lucide-react";
import { Node, type Editor } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import {
  asEquation,
  plainOf,
  parseLinear,
  replaceSlot,
  speakEquation,
  type EqNode,
} from "@suiteleaf/core/equations";

type PaintOptions = {
  interactive: boolean;
  editing: number | null;
  onEdit: (id: number) => void;
  onCommit: (id: number, text: string) => void;
  onCancel: () => void;
};

let slotCursor = 0;

function slot(text: string, options: PaintOptions): HTMLElement {
  const id = slotCursor++;
  if (!options.interactive) {
    const span = document.createElement("span");
    span.className = "eq-slot";
    span.textContent = text;
    return span;
  }
  if (options.editing === id) {
    const input = document.createElement("input");
    input.className = "eq-slot-input";
    input.setAttribute("aria-label", `Symbol ${text}`);
    input.value = text;
    input.spellcheck = false;
    const size = () => {
      input.style.width = `${Math.max(1, input.value.length)}ch`;
    };
    size();
    input.addEventListener("input", size);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        options.onCommit(id, input.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        options.onCancel();
      }
    });
    input.addEventListener("blur", () => options.onCommit(id, input.value));
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return input;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "eq-slot";
  button.textContent = text;
  button.setAttribute("aria-label", `Edit symbol ${text}`);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    options.onEdit(id);
  });
  return button;
}

function paintInto(parent: HTMLElement, node: EqNode, options: PaintOptions) {
  if (node.kind === "text") {
    parent.append(slot(node.text, options));
    return;
  }
  if (node.kind === "sup" || node.kind === "sub") {
    const wrap = document.createElement("span");
    wrap.className = node.kind === "sup" ? "eq-sup" : "eq-sub";
    const base = document.createElement("span");
    base.className = "eq-base";
    paintInto(base, node.kind === "sup" ? node.base : node.base, options);
    const script = document.createElement("span");
    script.className = node.kind === "sup" ? "eq-exp" : "eq-subexp";
    paintInto(script, node.kind === "sup" ? node.exp : node.sub, options);
    wrap.append(base, script);
    parent.append(wrap);
    return;
  }
  if (node.kind === "frac") {
    const wrap = document.createElement("span");
    wrap.className = "eq-frac";
    const num = document.createElement("span");
    num.className = "eq-num";
    paintInto(num, node.num, options);
    const bar = document.createElement("span");
    bar.className = "eq-bar";
    bar.setAttribute("aria-hidden", "true");
    const den = document.createElement("span");
    den.className = "eq-den";
    paintInto(den, node.den, options);
    wrap.append(num, bar, den);
    parent.append(wrap);
    return;
  }
  const wrap = document.createElement("span");
  wrap.className = "eq-row";
  for (const item of node.items) paintInto(wrap, item, options);
  parent.append(wrap);
}

export function paintEquation(
  host: HTMLElement,
  node: EqNode,
  options: PaintOptions,
) {
  slotCursor = 0;
  host.replaceChildren();
  host.classList.add("eq");
  host.dataset.structure = node.kind;
  host.setAttribute("role", "math");
  host.setAttribute("aria-label", `Equation, ${speakEquation(node)}`);
  paintInto(host, node, options);
}

function exprOf(node: ProseNode) {
  return asEquation(node.attrs.expr);
}

export const Equation = Node.create({
  name: "equation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      expr: { default: { kind: "text", text: "" } },
      plain: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-equation]",
        getAttrs(element) {
          if (!(element instanceof HTMLElement)) return false;
          const expr = asEquation(element.getAttribute("data-equation"));
          return { expr, plain: plainOf(expr) };
        },
      },
    ];
  },

  renderHTML({ node }) {
    const expr = exprOf(node);
    return [
      "span",
      {
        class: "eq",
        "data-equation": JSON.stringify(expr),
        "data-structure": expr.kind,
      },
      String(node.attrs.plain ?? plainOf(expr)),
    ];
  },

  addNodeView() {
    return ({ node, view, getPos }) => {
      let current = node;
      let editing: number | null = null;
      let suppress = false;
      const dom = document.createElement("span");

      const render = () => {
        paintEquation(dom, exprOf(current), {
          interactive: view.editable,
          editing,
          onEdit(id) {
            editing = id;
            render();
          },
          onCommit(id, text) {
            if (suppress || editing !== id) return;
            const nextText = text.trim();
            const previous = exprOf(current);
            const next = nextText ? replaceSlot(previous, id, nextText) : null;
            editing = null;
            if (!next || JSON.stringify(next) === JSON.stringify(previous)) {
              render();
              return;
            }
            const pos = getPos();
            if (!next || pos == null) {
              render();
              return;
            }
            suppress = true;
            view.dispatch(
              view.state.tr.setNodeMarkup(pos, undefined, {
                expr: next,
                plain: plainOf(next),
              }),
            );
            suppress = false;
          },
          onCancel() {
            editing = null;
            render();
          },
        });
      };

      render();
      return {
        dom,
        update(next) {
          if (next.type.name !== "equation") return false;
          const same =
            JSON.stringify(next.attrs.expr) === JSON.stringify(current.attrs.expr);
          current = next;
          if (!same || editing === null) render();
          return true;
        },
        stopEvent(event) {
          const target = event.target;
          return target instanceof globalThis.Node && dom.contains(target);
        },
        ignoreMutation: () => true,
        selectNode() {
          dom.classList.add("eq-selected");
        },
        deselectNode() {
          dom.classList.remove("eq-selected");
        },
      };
    };
  },
});

export function EquationDialog({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const parsed = parseLinear(value);
  const preview = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const host = preview.current;
    if (!host) return;
    host.replaceChildren();
    const tree = parseLinear(value);
    if (!tree) {
      const span = document.createElement("span");
      span.className = "equation-placeholder";
      span.textContent = "Preview";
      host.append(span);
      return;
    }
    const shown = document.createElement("span");
    paintEquation(shown, tree, {
      interactive: false,
      editing: null,
      onEdit() {},
      onCommit() {},
      onCancel() {},
    });
    host.append(shown);
  }, [value]);

  const insert = () => {
    if (!parsed) return;
    editor
      .chain()
      .insertContent({
        type: "equation",
        attrs: { expr: parsed, plain: plainOf(parsed) },
      })
      .run();
    // The dialog is aria-modal. Closing it moves focus to the page, and the
    // browser does that after this click, so a plain focus() here does not
    // stick. Catch the next typed character if it would otherwise land nowhere.
    const place = () => {
      if (editor.isDestroyed) return;
      editor.commands.focus();
      editor.view.dom.focus();
    };
    flushSync(() => onClose());
    place();
    const forward = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (event.key.length !== 1) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(".ProseMirror, input, textarea, [contenteditable='true']")
      ) {
        window.removeEventListener("keydown", forward, true);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      window.removeEventListener("keydown", forward, true);
      editor.chain().focus().insertContent(event.key).run();
    };
    window.addEventListener("keydown", forward, true);
    window.setTimeout(() => window.removeEventListener("keydown", forward, true), 1500);
  };
  const trimmed = value.trim();
  const unfinished =
    /[\^/+\-(]$/.test(trimmed) ||
    trimmed.split("(").length !== trimmed.split(")").length ||
    trimmed.split("{").length !== trimmed.split("}").length;
  const hint = !trimmed
    ? "A power or a fraction will show here."
    : parsed
      ? "Click any symbol after inserting to change just that one."
      : unfinished
        ? "Keep going. x^2 is a power, and (a+b)/c is a fraction."
        : "Use a power like x^2, or a fraction like (a+b)/c.";

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
  };

  return (
    <div className="gdocs-modal-overlay" onClick={onClose} onKeyDown={onKeyDown}>
      <div
        className="gdocs-dialog equation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Equation"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>Equation</h2>
          <button
            type="button"
            className="dialog-close-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="dialog-body">
          <p className="equation-help">
            Type <span className="equation-sample">x^2</span> for a power, or{" "}
            <span className="equation-sample">(a+b)/c</span> for a fraction.
            Afterwards, click one symbol to change it.
          </p>
          <label className="equation-field">
            Equation
            <input
              ref={input}
              aria-label="Equation"
              placeholder="x^2"
              value={value}
              spellCheck={false}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  insert();
                }
              }}
            />
          </label>
          <div className="equation-preview" ref={preview} aria-label="Equation preview" />
          <p className="equation-status" data-invalid={trimmed !== "" && !parsed && !unfinished}>
            {hint}
          </p>
        </div>
        <div className="dialog-footer">
          <button type="button" className="dialog-text-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="dialog-primary-btn"
            disabled={!parsed}
            onClick={insert}
          >
            Insert equation
          </button>
        </div>
      </div>
    </div>
  );
}
