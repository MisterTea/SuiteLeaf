import { Extension, Node, type Extensions } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type EditorState } from "@tiptap/pm/state";
import {
  bibliographyPlain,
  bibliographyRuns,
  bibliographyTitle,
  citationLibrary,
  inText,
  type CitationLibrary,
  type CitationSource,
} from "@suiteleaf/core/citations";

function libraryOf(doc: ProseNode): CitationLibrary {
  return citationLibrary({ attrs: doc.attrs });
}

function blocked(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === "note" || $from.node(depth).type.spec.tableRole) return true;
  }
  return false;
}

function paintCitation(dom: HTMLElement, source: CitationSource | undefined, style: CitationLibrary["style"]) {
  const label = source ? inText(source, style) : "(missing source)";
  dom.textContent = label;
  dom.dataset.sourceId = source?.id ?? "";
  dom.setAttribute(
    "aria-label",
    source ? `Citation ${source.author}, ${source.year}` : "Missing citation",
  );
}

const CitationLibraryAttrs = Extension.create({
  name: "citationLibrary",
  addStorage() {
    return { openPanel: () => {} };
  },
  addGlobalAttributes() {
    return [
      {
        types: ["doc"],
        attributes: {
          citationStyle: { default: null, rendered: false },
          citationSources: { default: null, rendered: false },
        },
      },
    ];
  },
});

const Citation = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { sourceId: { default: "" } };
  },
  parseHTML: () => [
    {
      tag: "span[data-citation]",
      getAttrs: (element) => ({
        sourceId: (element as HTMLElement).getAttribute("data-citation"),
      }),
    },
  ],
  renderHTML: ({ node }) => [
    "span",
    { "data-citation": node.attrs.sourceId, class: "doc-citation" },
    "",
  ],
  addCommands() {
    return {
      insertCitation:
        (sourceId: string) =>
        ({ state, dispatch }) => {
          if (!sourceId || blocked(state)) return false;
          const node = state.schema.nodes.citation.create({ sourceId });
          const { from, to, empty } = state.selection;
          const previous = empty && from > 0 ? state.doc.textBetween(from - 1, from) : "";
          const needsSpace = empty && previous.length > 0 && !/\s/.test(previous);
          if (!dispatch) return true;
          const content = needsSpace
            ? [state.schema.text(" "), node]
            : [node];
          let tr = state.tr.replaceWith(from, to, content);
          const after = tr.mapping.map(to) + (needsSpace ? 2 : 1);
          const pos = Math.min(after, tr.doc.content.size);
          tr = tr.setSelection(TextSelection.create(tr.doc, pos)).scrollIntoView();
          dispatch(tr);
          return true;
        },
    };
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement("span");
      dom.className = "doc-citation";
      dom.setAttribute("role", "button");
      dom.tabIndex = 0;
      const paint = () => {
        const library = libraryOf(editor.state.doc);
        const source = library.sources.find(
          (item) => item.id === String(current.attrs.sourceId ?? ""),
        );
        paintCitation(dom, source, library.style);
        const selected = editor.state.selection;
        dom.classList.toggle(
          "is-selected",
          selected instanceof NodeSelection && selected.from === getPos(),
        );
      };
      const select = () => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        editor.chain().focus().setNodeSelection(pos).run();
        editor.storage.citationLibrary.openPanel();
      };
      dom.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        select();
      });
      dom.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        select();
      });
      const onTransaction = () => paint();
      editor.on("transaction", onTransaction);
      paint();
      return {
        dom,
        update: (next) => {
          if (next.type.name !== "citation") return false;
          current = next;
          paint();
          return true;
        },
        ignoreMutation: () => true,
        stopEvent: (event) =>
          event.type === "mousedown" || event.type === "click" || event.type === "keydown",
        destroy: () => editor.off("transaction", onTransaction),
      };
    };
  },
});

const Bibliography = Node.create({
  name: "bibliography",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: "section[data-bibliography]" }],
  renderHTML: () => [
    "section",
    { "data-bibliography": "true", class: "doc-bibliography" },
  ],
  addCommands() {
    return {
      insertBibliography:
        () =>
        ({ state, dispatch }) => {
          let existing = -1;
          state.doc.descendants((node, pos) => {
            if (node.type.name === "bibliography" && existing < 0) existing = pos;
          });
          if (existing >= 0) {
            if (dispatch)
              dispatch(
                state.tr
                  .setSelection(NodeSelection.create(state.doc, existing))
                  .scrollIntoView(),
              );
            return true;
          }
          if (blocked(state)) return false;
          const { $from } = state.selection;
          const after = $from.depth > 0 ? $from.after(1) : state.doc.content.size;
          if (!dispatch) return true;
          const node = state.schema.nodes.bibliography.create();
          const tr = state.tr.insert(after, node);
          dispatch(
            tr
              .setSelection(NodeSelection.create(tr.doc, after))
              .scrollIntoView(),
          );
          return true;
        },
    };
  },
  addNodeView() {
    return ({ editor }) => {
      const dom = document.createElement("section");
      dom.className = "doc-bibliography";
      dom.setAttribute("data-bibliography", "true");
      const title = document.createElement("h2");
      title.className = "doc-bib-title";
      const list = document.createElement("div");
      list.className = "doc-bib-list";
      dom.append(title, list);
      const paint = () => {
        const library = libraryOf(editor.state.doc);
        const heading = bibliographyTitle(library.style);
        dom.setAttribute("aria-label", heading);
        title.textContent = heading;
        title.id = "doc-bibliography-title";
        const used = new Set<string>();
        editor.state.doc.descendants((node) => {
          if (node.type.name === "citation")
            used.add(String(node.attrs.sourceId ?? ""));
        });
        const entries = library.sources
          .filter((source) => used.has(source.id))
          .slice()
          .sort(
            (a, b) =>
              a.author.localeCompare(b.author, undefined, { sensitivity: "base" }) ||
              a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
          );
        list.replaceChildren();
        if (!entries.length) {
          const empty = document.createElement("p");
          empty.className = "doc-bib-empty";
          empty.textContent = "Cite a source and it will be listed here.";
          list.append(empty);
          return;
        }
        for (const source of entries) {
          const row = document.createElement("p");
          row.className = "doc-bib-entry";
          for (const run of bibliographyRuns(source, library.style)) {
            const el = document.createElement(run.italic ? "em" : "span");
            el.textContent = run.text;
            row.append(el);
          }
          row.dataset.plain = bibliographyPlain(source, library.style);
          list.append(row);
        }
      };
      const onTransaction = () => paint();
      editor.on("transaction", onTransaction);
      paint();
      return {
        dom,
        update: () => {
          paint();
          return true;
        },
        ignoreMutation: () => true,
        destroy: () => editor.off("transaction", onTransaction),
      };
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    citation: {
      insertCitation: (sourceId: string) => ReturnType;
    };
    bibliography: {
      insertBibliography: () => ReturnType;
    };
  }
  interface Storage {
    citationLibrary: { openPanel: () => void };
  }
}

export const documentCitations: Extensions = [
  CitationLibraryAttrs,
  Citation,
  Bibliography,
];
