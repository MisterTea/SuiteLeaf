import { Extension, Node, type Editor, type Extensions } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { Plugin, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const focusNote = "suiteleaf-focus-note";
/** Footnotes taller than this continue on the next page, under a rule. */
const NOTE_BAND = 72;

type Ref = { id: string; kind: string; label: string; pos: number };

function toRoman(n: number): string {
  const romans: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"],
    [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"],
    [4, "iv"], [1, "i"],
  ];
  let rest = Math.max(1, n);
  let out = "";
  for (const [val, sym] of romans)
    while (rest >= val) {
      out += sym;
      rest -= val;
    }
  return out;
}

function noteId(): string {
  return `n${Math.random().toString(36).slice(2, 10)}`;
}

export function noteRefs(doc: ProseNode): Ref[] {
  const refs: Ref[] = [];
  let footnotes = 0;
  let endnotes = 0;
  doc.descendants((node, pos) => {
    if (node.type.name === "note") return false;
    if (node.type.name !== "noteReference") return;
    const kind = node.attrs.kind === "endnote" ? "endnote" : "footnote";
    const label = kind === "endnote" ? toRoman(++endnotes) : String(++footnotes);
    refs.push({ id: String(node.attrs.id ?? ""), kind, label, pos });
  });
  return refs;
}

function inTable(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--)
    if ($from.node(depth).type.spec.tableRole) return true;
  return false;
}

function insideNote(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--)
    if ($from.node(depth).type.name === "note") return true;
  return false;
}

function reconcile(state: EditorState, focus?: string): Transaction | null {
  const refs = noteRefs(state.doc);
  const notes: { id: string; pos: number; node: ProseNode }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === "note") {
      notes.push({ id: String(node.attrs.id ?? ""), pos, node });
      return false;
    }
  });
  const wanted = refs.map((ref) => ref.id);
  const have = notes.map((note) => note.id);
  const tr = state.tr;
  const orderOk =
    have.length === wanted.length && wanted.every((id, i) => have[i] === id);
  if (orderOk) {
    let changed = false;
    state.doc.descendants((node, pos) => {
      if (node.type.name !== "noteReference" && node.type.name !== "note") return;
      const ref = refs.find((item) => item.id === node.attrs.id);
      if (!ref || (node.attrs.label === ref.label && node.attrs.kind === ref.kind))
        return;
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        label: ref.label,
        kind: ref.kind,
      });
      changed = true;
    });
    if (focus) changed = placeCaret(tr, focus) || changed;
    return changed ? tr : null;
  }
  for (let i = notes.length - 1; i >= 0; i--)
    tr.delete(notes[i].pos, notes[i].pos + notes[i].node.nodeSize);
  for (const ref of refs) {
    const existing = notes.find((note) => note.id === ref.id);
    const body = existing
      ? state.schema.nodes.note.create(
          { ...existing.node.attrs, id: ref.id, kind: ref.kind, label: ref.label },
          existing.node.content,
        )
      : state.schema.nodes.note.create(
          { id: ref.id, kind: ref.kind, label: ref.label },
          state.schema.nodes.paragraph.create(),
        );
    const at = tr.doc.content.size;
    tr.insert(at, body);
    if (focus === ref.id) tr.setSelection(TextSelection.create(tr.doc, at + 2));
  }
  if (focus) tr.scrollIntoView();
  return tr;
}

function placeCaret(tr: Transaction, id: string): boolean {
  let pos = -1;
  tr.doc.descendants((node, at) => {
    if (node.type.name === "note" && node.attrs.id === id) pos = at;
  });
  if (pos < 0) return false;
  const inside = tr.selection.$from;
  for (let depth = inside.depth; depth > 0; depth--)
    if (inside.node(depth).type.name === "note" && inside.node(depth).attrs.id === id)
      return false;
  tr.setSelection(TextSelection.create(tr.doc, pos + 2)).scrollIntoView();
  return true;
}

type HeadingSpot = { pos: number; page: number };
let headingSpots: HeadingSpot[] = [];
const tocRefreshers = new Set<() => void>();
const placedNotes = new Map<string, { page: number; top: number }>();

function jump(editor: Editor, type: string, id: string) {
  let pos = -1;
  editor.state.doc.descendants((node, at) => {
    if (node.type.name === type && node.attrs.id === id) pos = at;
  });
  if (pos < 0) return;
  const chain = editor.chain().focus();
  if (type === "note") chain.setTextSelection(pos + 2);
  else chain.setNodeSelection(pos);
  chain.scrollIntoView().run();
  const dom = editor.view.nodeDOM(pos);
  if (dom instanceof HTMLElement) revealInStage(dom);
}

function revealInStage(el: HTMLElement) {
  const stage = el.closest(".document-stage") as HTMLElement | null;
  if (!stage) return;
  const rect = el.getBoundingClientRect();
  const frame = stage.getBoundingClientRect();
  if (rect.height > 0 && (rect.top < frame.top + 40 || rect.bottom > frame.bottom - 16))
    stage.scrollTop += rect.top - frame.top - 120;
}

const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      pageNumbers: { default: true },
      maxLevel: { default: 3 },
    };
  },
  parseHTML: () => [
    {
      tag: "nav[data-toc]",
      getAttrs: (element) => ({
        pageNumbers: (element as HTMLElement).getAttribute("data-page-numbers") !== "false",
        maxLevel: Number((element as HTMLElement).getAttribute("data-max-level")) === 1 ? 1 : 3,
      }),
    },
  ],
  renderHTML: ({ node }) => [
    "nav",
    {
      "data-toc": "true",
      "data-page-numbers": String(node.attrs.pageNumbers !== false),
      "data-max-level": String(node.attrs.maxLevel === 1 ? 1 : 3),
      class: "doc-toc",
    },
    "Contents",
  ],
  addCommands() {
    return {
      insertTableOfContents:
        (pageNumbers = true) =>
        ({ state, chain }) => {
          if (inTable(state)) return false;
          return chain()
            .focus()
            .insertContent({
              type: this.name,
              attrs: { pageNumbers: pageNumbers !== false, maxLevel: 3 },
            })
            .run();
        },
    };
  },
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      let open = false;
      const dom = document.createElement("nav");
      dom.className = "doc-toc";
      dom.setAttribute("data-toc", "true");
      dom.setAttribute("aria-label", "Table of contents");
      const bar = document.createElement("div");
      bar.className = "doc-toc-bar";
      const title = document.createElement("span");
      title.className = "doc-toc-title";
      title.textContent = "Contents";
      const options = document.createElement("button");
      options.type = "button";
      options.className = "doc-toc-options-btn";
      options.textContent = "Options";
      options.setAttribute("aria-label", "Contents options");
      options.setAttribute("aria-haspopup", "menu");
      const menu = document.createElement("div");
      menu.className = "doc-toc-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "Contents options");
      menu.hidden = true;
      const list = document.createElement("div");
      list.className = "doc-toc-list";
      bar.append(title, options);
      dom.append(bar, menu, list);

      const choose = (attrs: { pageNumbers?: boolean; maxLevel?: number }) => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        editor
          .chain()
          .setNodeSelection(pos)
          .updateAttributes("tableOfContents", attrs)
          .run();
        open = false;
        menu.hidden = true;
        options.setAttribute("aria-expanded", "false");
      };
      const item = (
        label: string,
        checked: boolean,
        attrs: { pageNumbers?: boolean; maxLevel?: number },
      ) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "doc-toc-option";
        button.setAttribute("role", "menuitemradio");
        button.setAttribute("aria-checked", String(checked));
        button.textContent = label;
        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          choose(attrs);
        });
        return button;
      };
      const render = () => {
        const pageNumbers = current.attrs.pageNumbers !== false;
        const maxLevel = current.attrs.maxLevel === 1 ? 1 : 3;
        dom.classList.toggle("doc-toc-pages", pageNumbers);
        dom.dataset.pageNumbers = String(pageNumbers);
        dom.dataset.maxLevel = String(maxLevel);
        menu.replaceChildren(
          item("With page numbers", pageNumbers, { pageNumbers: true }),
          item("Plain links", !pageNumbers, { pageNumbers: false }),
          item("Heading 1 only", maxLevel === 1, { maxLevel: 1 }),
          item("Levels 1 to 3", maxLevel === 3, { maxLevel: 3 }),
        );
        list.replaceChildren();
        const headings: { text: string; level: number; pos: number }[] = [];
        editor.state.doc.descendants((child, pos) => {
          if (child.type.name === "note" || child.type.name === "tableOfContents")
            return false;
          if (child.type.name === "heading" && child.textContent.trim())
            headings.push({
              text: child.textContent,
              level: child.attrs.level,
              pos,
            });
        });
        const shown = headings.filter((heading) => heading.level <= maxLevel);
        if (!shown.length) {
          const empty = document.createElement("p");
          empty.className = "doc-toc-empty";
          empty.textContent = "Headings you add will appear here.";
          list.append(empty);
          return;
        }
        for (const heading of shown) {
          const row = document.createElement("div");
          row.className = `doc-toc-entry level-${heading.level}`;
          const link = document.createElement("button");
          link.type = "button";
          link.className = "doc-toc-link";
          link.textContent = heading.text;
          link.addEventListener("mousedown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            editor
              .chain()
              .focus()
              .setTextSelection(heading.pos + 1)
              .scrollIntoView()
              .run();
          });
          const leader = document.createElement("span");
          leader.className = "doc-toc-leader";
          leader.setAttribute("aria-hidden", "true");
          const page = document.createElement("span");
          page.className = "doc-toc-page";
          const spot = headingSpots.find((item) => item.pos === heading.pos);
          page.textContent = spot ? String(spot.page) : "";
          row.append(link, leader, page);
          list.append(row);
        }
      };
      options.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        open = !open;
        menu.hidden = !open;
        options.setAttribute("aria-expanded", String(open));
      });
      const close = (event: Event) => {
        if (!dom.contains(event.target as globalThis.Node)) {
          open = false;
          menu.hidden = true;
          options.setAttribute("aria-expanded", "false");
        }
      };
      document.addEventListener("pointerdown", close, true);
      tocRefreshers.add(render);
      render();
      return {
        dom,
        update: (next) => {
          current = next;
          render();
          return true;
        },
        ignoreMutation: () => true,
        stopEvent: () => true,
        destroy: () => {
          tocRefreshers.delete(render);
          document.removeEventListener("pointerdown", close, true);
        },
      };
    };
  },
});

const NoteReference = Node.create({
  name: "noteReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: "" },
      kind: { default: "footnote" },
      label: { default: "" },
    };
  },
  parseHTML: () => [
    {
      tag: "sup[data-note-id]",
      getAttrs: (element) => {
        const el = element as HTMLElement;
        return {
          id: el.getAttribute("data-note-id"),
          kind: el.getAttribute("data-note-kind") === "endnote" ? "endnote" : "footnote",
          label: el.textContent ?? "",
        };
      },
    },
  ],
  renderHTML: ({ node }) => [
    "sup",
    {
      "data-note-id": node.attrs.id,
      "data-note-kind": node.attrs.kind,
      class: "doc-note-ref",
    },
    String(node.attrs.label ?? ""),
  ],
  addCommands() {
    return {
      insertFootnote: () => ({ state, dispatch }) => insertNote(state, dispatch, "footnote"),
      insertEndnote: () => ({ state, dispatch }) => insertNote(state, dispatch, "endnote"),
    };
  },
  addKeyboardShortcuts() {
    return { "Mod-Alt-f": () => this.editor.commands.insertFootnote() };
  },
  addNodeView() {
    return ({ node, editor }) => {
      let current = node;
      const dom = document.createElement("sup");
      dom.className = "doc-note-ref";
      dom.setAttribute("role", "button");
      dom.tabIndex = 0;
      const paint = () => {
        dom.dataset.noteId = String(current.attrs.id ?? "");
        dom.dataset.noteKind = String(current.attrs.kind ?? "footnote");
        const ref = noteRefs(editor.state.doc).find((item) => item.id === current.attrs.id);
        const label = ref?.label || String(current.attrs.label ?? "");
        dom.textContent = label;
        const name = current.attrs.kind === "endnote" ? "Endnote" : "Footnote";
        dom.setAttribute("aria-label", label ? `${name} ${label}` : name);
      };
      dom.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        jump(editor, "note", String(current.attrs.id));
      });
      dom.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        jump(editor, "note", String(current.attrs.id));
      });
      paint();
      return {
        dom,
        update: (next) => {
          current = next;
          paint();
          return true;
        },
        ignoreMutation: () => true,
        stopEvent: (event) =>
          event.type === "mousedown" || event.type === "click" || event.type === "keydown",
      };
    };
  },
});

function insertNote(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  kind: "footnote" | "endnote",
) {
  if (insideNote(state)) return false;
  const id = noteId();
  const ref = state.schema.nodes.noteReference.create({ id, kind, label: "" });
  const tr = state.tr.replaceSelectionWith(ref, false);
  tr.setMeta(focusNote, id);
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
}

const Note = Node.create({
  name: "note",
  group: "block",
  content: "paragraph+",
  isolating: true,
  defining: true,
  addAttributes() {
    return {
      id: { default: "" },
      kind: { default: "footnote" },
      label: { default: "" },
    };
  },
  parseHTML: () => [{ tag: "section[data-note-id]" }],
  renderHTML: ({ node }) => [
    "section",
    {
      "data-note-id": node.attrs.id,
      "data-note-kind": node.attrs.kind,
      class: "doc-note",
    },
    ["span", { class: "doc-note-label" }, String(node.attrs.label ?? "")],
    ["div", { class: "doc-note-body" }, 0],
  ],
  addNodeView() {
    return ({ node, editor }) => {
      let current = node;
      const dom = document.createElement("section");
      dom.className = "doc-note";
      const title = document.createElement("div");
      title.className = "doc-endnotes-title";
      title.textContent = "Endnotes";
      title.contentEditable = "false";
      const row = document.createElement("div");
      row.className = "doc-note-row";
      const label = document.createElement("button");
      label.type = "button";
      label.className = "doc-note-label";
      label.contentEditable = "false";
      const content = document.createElement("div");
      content.className = "doc-note-body";
      row.append(label, content);
      dom.append(title, row);
      const paint = () => {
        const id = String(current.attrs.id ?? "");
        const kind = current.attrs.kind === "endnote" ? "endnote" : "footnote";
        dom.dataset.noteId = id;
        dom.dataset.kind = kind;
        dom.dataset.noteKind = kind;
        const refs = noteRefs(editor.state.doc);
        const ref = refs.find((item) => item.id === id);
        const text = ref?.label || String(current.attrs.label ?? "");
        label.textContent = text;
        const name = kind === "endnote" ? "Endnote" : "Footnote";
        label.setAttribute("aria-label", text ? `Back to ${name.toLowerCase()} ${text}` : name);
        const endnotes = refs.filter((item) => item.kind === "endnote");
        const showTitle = kind === "endnote" && endnotes[0]?.id === id;
        title.hidden = !showTitle;
        title.textContent = showTitle ? "Endnotes" : "";
        const place = kind === "footnote" ? placedNotes.get(id) : undefined;
        if (place) {
          dom.classList.add("doc-note-placed", "doc-note-rule");
          dom.style.setProperty("--page-index", String(place.page));
          dom.style.setProperty("--note-top", `${place.top}px`);
        }
      };
      label.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        jump(editor, "noteReference", String(current.attrs.id));
      });
      paint();
      return {
        dom,
        contentDOM: content,
        update: (next) => {
          current = next;
          paint();
          return true;
        },
        ignoreMutation: (mutation) => !content.contains(mutation.target),
        stopEvent: (event) => event.target === label || event.target === title,
      };
    };
  },
});

type Piece = {
  id: string;
  page: number;
  skip: number;
  height: number;
  rule: boolean;
};

function pageOf(el: HTMLElement, paper: HTMLElement): number {
  const zoom = Number(paper.style.zoom) || 1;
  const stride = parseFloat(paper.style.getPropertyValue("--page-stride")) || 1;
  const top =
    (el.getBoundingClientRect().top - paper.getBoundingClientRect().top) / zoom;
  return Math.max(0, Math.floor((top + 2) / stride));
}

function layoutNotes(view: EditorView) {
  tocRefreshers.forEach((refresh) => refresh());
  const paper = view.dom.closest(".paginated-paper") as HTMLElement | null;
  if (!paper) return;
  const pageHeight = parseFloat(paper.style.getPropertyValue("--page-height")) || 0;
  const margin =
    parseFloat(paper.style.getPropertyValue("--page-margin-bottom")) ||
    parseFloat(paper.style.getPropertyValue("--page-margin")) ||
    0;
  if (!pageHeight) return;
  const spots: HeadingSpot[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === "note" || node.type.name === "tableOfContents") return false;
    if (node.type.name !== "heading" || !node.textContent.trim()) return;
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement)
      spots.push({ pos, page: pageOf(dom, paper) + 1 });
  });
  headingSpots = spots;
  tocRefreshers.forEach((refresh) => refresh());

  const refs = noteRefs(view.state.doc).filter((ref) => ref.kind === "footnote");
  const notes = new Map<string, HTMLElement>();
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== "note" || node.attrs.kind === "endnote") return;
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) notes.set(String(node.attrs.id ?? ""), dom);
  });
  for (const el of notes.values()) {
    el.style.maxHeight = "none";
    el.style.overflow = "visible";
  }
  const heights = new Map<string, number>();
  for (const ref of refs) {
    const el = notes.get(ref.id);
    if (el) heights.set(ref.id, Math.max(24, el.offsetHeight));
  }
  const pending = refs.flatMap((ref) => {
    const dom = view.nodeDOM(ref.pos);
    if (!(dom instanceof HTMLElement) || !heights.has(ref.id)) return [];
    return [{ id: ref.id, page: pageOf(dom, paper), left: heights.get(ref.id) ?? 0, skip: 0 }];
  });
  const maxPage = Math.min(
    30,
    pending.reduce((max, item) => Math.max(max, item.page), 0),
  );
  const pieces: Piece[] = [];
  const reserve: number[] = [];
  for (let page = 0; page <= maxPage + pending.length + 1; page++) {
    const mine = pending.filter((item) => item.page === page && item.left > 8);
    if (!mine.length && page > maxPage) break;
    let used = 0;
    let rule = false;
    for (const item of mine) {
      const room = NOTE_BAND - used;
      if (room < 28 && used > 0) {
        item.page = page + 1;
        continue;
      }
      const take = Math.min(item.left, Math.max(room, 28));
      pieces.push({
        id: item.id,
        page,
        skip: item.skip,
        height: take,
        rule: !rule,
      });
      rule = true;
      item.skip += take;
      item.left -= take;
      used += take;
      if (item.left > 8) item.page = page + 1;
    }
    reserve[page] = used ? used + 4 : 0;
  }
  const host = paper;
  let layers = host.querySelector<HTMLElement>(".doc-note-layers");
  if (!layers) {
    layers = document.createElement("div");
    layers.className = "doc-note-layers";
    layers.setAttribute("aria-hidden", "true");
    host.append(layers);
  }
  layers.replaceChildren();
  const first = new Map<string, Piece>();
  for (const piece of pieces) if (!first.has(piece.id)) first.set(piece.id, piece);
  const byPage = new Map<number, Piece[]>();
  for (const piece of pieces) {
    const list = byPage.get(piece.page) ?? [];
    list.push(piece);
    byPage.set(piece.page, list);
  }
  for (const [page, list] of byPage) {
    const stack = list.reduce((sum, piece) => sum + piece.height, 0);
    let y = pageHeight - margin - stack;
    for (const piece of list) {
      const el = notes.get(piece.id);
      const primary = first.get(piece.id);
      if (piece === primary && el) {
        el.classList.add("doc-note-placed");
        el.classList.toggle("doc-note-rule", piece.rule);
        el.style.setProperty("--page-index", String(page));
        el.style.setProperty("--note-top", `${y}px`);
        if (piece.height + 6 < (heights.get(piece.id) ?? 0)) {
          el.style.maxHeight = `${piece.height}px`;
          el.style.overflow = "hidden";
        }
      } else if (el) {
        const copy = document.createElement("div");
        copy.className = `doc-note-continued${piece.rule ? " doc-note-rule" : ""}`;
        copy.style.setProperty("--page-index", String(page));
        copy.style.setProperty("--note-top", `${y}px`);
        copy.style.height = `${piece.height}px`;
        const inner = document.createElement("div");
        inner.className = "doc-note-continued-inner";
        inner.style.marginTop = `-${piece.skip}px`;
        const mark = document.createElement("span");
        mark.className = "doc-note-label";
        mark.textContent = el.querySelector(".doc-note-label")?.textContent ?? "";
        const body = document.createElement("div");
        body.className = "doc-note-body";
        body.textContent = el.querySelector(".doc-note-body")?.textContent ?? "";
        inner.append(mark, body);
        copy.append(inner);
        layers.append(copy);
      }
      y += piece.height;
    }
  }
  layers.replaceChildren();
  type StackItem = {
    id: string;
    el?: HTMLElement;
    page: number;
    full: number;
    label: string;
    text: string;
    skip: number;
  };
  const stacked: StackItem[] = refs.map((ref) => {
    const el = notes.get(ref.id);
    const marker = view.nodeDOM(ref.pos);
    const text = el?.querySelector(".doc-note-body")?.textContent ?? "";
    return {
      id: ref.id,
      el,
      page: marker instanceof HTMLElement ? pageOf(marker, paper) : 0,
      full: heights.get(ref.id) ?? el?.offsetHeight ?? 28,
      label: el?.querySelector(".doc-note-label")?.textContent ?? "",
      text,
      skip: 0,
    };
  });
  const stackedPages = new Map<number, StackItem[]>();
  for (const item of stacked) {
    const band = Math.min(item.full, NOTE_BAND);
    const spill = item.full > band + 6;
    const list = stackedPages.get(item.page) ?? [];
    list.push(item);
    stackedPages.set(item.page, list);
    if (spill) {
      const next = stackedPages.get(item.page + 1) ?? [];
      next.push({
        ...item,
        el: undefined,
        full: item.full - band,
        page: item.page + 1,
        skip: band,
      });
      stackedPages.set(item.page + 1, next);
    }
  }
  for (const [page, list] of stackedPages) {
    let cursor =
      pageHeight -
      margin -
      list.reduce((sum, item) => sum + Math.min(item.full, NOTE_BAND), 0);
    const seen = new Set<string>();
    for (const item of list) {
      const band = Math.min(item.full, NOTE_BAND);
      const primary = item.el && !seen.has(item.id);
      if (primary && item.el) {
        seen.add(item.id);
        placedNotes.set(item.id, { page, top: cursor });
        item.el.classList.add("doc-note-placed");
        item.el.classList.toggle("doc-note-rule", list[0] === item);
        item.el.style.setProperty("--page-index", String(page));
        item.el.style.setProperty("--note-top", `${cursor}px`);
        if (item.full > band + 6) {
          item.el.style.maxHeight = `${band}px`;
          item.el.style.overflow = "hidden";
        } else {
          item.el.style.maxHeight = "none";
          item.el.style.overflow = "visible";
        }
      } else {
        const copy = document.createElement("div");
        copy.className = "doc-note-continued doc-note-rule";
        copy.style.height = `${band}px`;
        copy.style.setProperty("--page-index", String(page));
        copy.style.setProperty("--note-top", `${cursor}px`);
        const inner = document.createElement("div");
        inner.className = "doc-note-continued-inner";
        if (item.skip) inner.style.marginTop = `-${item.skip}px`;
        const mark = document.createElement("span");
        mark.className = "doc-note-label";
        mark.textContent = item.label;
        const body = document.createElement("div");
        body.className = "doc-note-body";
        body.textContent = item.text;
        inner.append(mark, body);
        copy.append(inner);
        layers.append(copy);
      }
      cursor += band;
    }
  }
  let focused = "";
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "note" && node.attrs.kind === "footnote")
      focused = String(node.attrs.id ?? "");
  }
  const focusedNote = focused ? notes.get(focused) : undefined;
  if (focusedNote) revealInStage(focusedNote);
  const next = reserve.map((n) => String(Math.round(n))).join(",");
  const root = view.dom as HTMLElement;
  const sig = refs.map((ref) => ref.id).join(".");
  if (root.dataset.noteSig !== sig) {
    root.dataset.noteSig = sig;
    root.dataset.notePasses = "0";
  }
  const passes = Number(root.dataset.notePasses || "0");
  if ((root.dataset.noteReserve ?? "") !== next && passes < 4) {
    root.dataset.notePasses = String(passes + 1);
    root.dataset.noteReserve = next;
    root.dataset.noteReserveGen = String(Number(root.dataset.noteReserveGen || "0") + 1);
    requestAnimationFrame(() => {
      if (view.isDestroyed) return;
      view.dispatch(view.state.tr.setMeta("addToHistory", false));
    });
  }
}

const NotesBehavior = Extension.create({
  name: "notesBehavior",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // On macOS, Option changes event.key (F becomes ƒ), so the shortcut
          // has to look at the physical key.
          handleKeyDown: (_view, event) => {
            if (
              event.code !== "KeyF" ||
              !event.altKey ||
              event.shiftKey ||
              !(event.metaKey || event.ctrlKey)
            )
              return false;
            event.preventDefault();
            return this.editor.commands.insertFootnote();
          },
        },
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const focus = transactions
            .map((tr) => tr.getMeta(focusNote) as string | undefined)
            .find(Boolean);
          return reconcile(state, focus);
        },
        view(view) {
          let frame = 0;
          const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
              if (!view.isDestroyed) layoutNotes(view);
            });
          };
          view.dom.addEventListener("suiteleaf-pages", schedule);
          schedule();
          return {
            update: schedule,
            destroy() {
              cancelAnimationFrame(frame);
              view.dom.removeEventListener("suiteleaf-pages", schedule);
            },
          };
        },
      }),
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableOfContents: {
      insertTableOfContents: (pageNumbers?: boolean) => ReturnType;
    };
    noteReference: {
      insertFootnote: () => ReturnType;
      insertEndnote: () => ReturnType;
    };
  }
}

export const documentNotes: Extensions = [
  TableOfContents,
  NoteReference,
  Note,
  NotesBehavior,
];
