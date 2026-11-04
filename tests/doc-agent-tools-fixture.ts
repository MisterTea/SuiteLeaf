import { Editor, type JSONContent } from "@tiptap/core";
import { UndoRedo } from "@tiptap/extensions";
import { vi } from "vitest";
import type { JsonNode } from "@suiteleaf/core";
import { documentPageSettings, type PageSettings } from "@suiteleaf/core/document-layout";
import { extensions } from "../apps/web/src/editors/doc-extensions";
import { docTools, type DocsAgentContext } from "../apps/web/src/ai/tools/docs";
import type { SuiteTool } from "../apps/web/src/ai/host";

type Block = JSONContent;

class QuietResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") vi.stubGlobal("ResizeObserver", QuietResizeObserver);
// Node's own localStorage, absent without a storage file, hides jsdom's.
if (typeof globalThis.localStorage?.clear !== "function") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}
// Pagination measures laid-out lines; jsdom has no layout, so every range is empty.
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}

export const text = (value: string, marks?: string[]): Block => ({
  type: "text",
  text: value,
  ...(marks ? { marks: marks.map((type) => ({ type })) } : {}),
});
export const p = (...content: (string | Block)[]): Block => ({
  type: "paragraph",
  ...(content.length ? { content: content.map((c) => (typeof c === "string" ? text(c) : c)) } : {}),
});
export const h = (level: number, value: string): Block => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
export const bullets = (...items: string[]): Block => ({
  type: "bulletList",
  content: items.map((item) => ({ type: "listItem", content: [p(item)] })),
});
export const numbered = (...items: string[]): Block => ({
  type: "orderedList",
  content: items.map((item) => ({ type: "listItem", content: [p(item)] })),
});
export const table = (...rows: string[][]): Block => ({
  type: "table",
  content: rows.map((row) => ({
    type: "tableRow",
    content: row.map((cell) => ({ type: "tableCell", content: [p(cell)] })),
  })),
});
export const image = (attrs: Record<string, unknown>): Block => ({
  type: "image",
  attrs: { src: "data:image/png;base64,iVBORw0KGgo=", ...attrs },
});

export interface DocHarness {
  editor: Editor;
  ctx: DocsAgentContext;
  tools: SuiteTool[];
  tool: (name: string) => SuiteTool;
  /** prepare, then execute, as the agent loop does. */
  run: (name: string, args?: Record<string, unknown>) => Promise<string>;
  /** prepare only. */
  prep: (name: string, args?: Record<string, unknown>) => Record<string, unknown>;
  page: () => PageSettings;
  destroy: () => void;
}

/** A Docs editor with the app's extensions and a context whose dialogs are spies. */
export function docHarness(
  content: Block[] | Block,
  options: { title?: string; attrs?: Record<string, unknown>; ctx?: Partial<DocsAgentContext> } = {},
): DocHarness {
  const doc = Array.isArray(content) ? { type: "doc", ...(options.attrs ? { attrs: options.attrs } : {}), content } : content;
  const editor = new Editor({ extensions: [...extensions, UndoRedo], content: doc });
  const ctx: DocsAgentContext = {
    editor,
    title: options.title ?? "Notes",
    showFind: vi.fn(),
    showReplaced: vi.fn(),
    closeFind: vi.fn(),
    showPageSetup: vi.fn(),
    pageSettings: () => documentPageSettings(editor.getJSON() as JsonNode),
    closePageSetup: vi.fn(),
    showSpelling: vi.fn(),
    showWordCount: vi.fn(),
    showDictionary: vi.fn(),
    closeProofing: vi.fn(),
    jumpToHeading: vi.fn(),
    insertImage: vi.fn(async () => {}),
    exportAs: vi.fn(async () => undefined),
    pageCount: 1,
    ...options.ctx,
  };
  const tools = docTools(ctx);
  const tool = (name: string) => {
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`No tool ${name}`);
    return found;
  };
  const prep = (name: string, args: Record<string, unknown> = {}) => {
    const t = tool(name);
    return t.prepare ? t.prepare(args) : args;
  };
  const run = async (name: string, args: Record<string, unknown> = {}) => {
    const out = await tool(name).execute(prep(name, args) as never);
    return typeof out === "string" ? out : out.text;
  };
  return {
    editor,
    ctx,
    tools,
    tool,
    run,
    prep,
    page: () => ctx.pageSettings(),
    destroy: () => editor.destroy(),
  };
}

/** The document as plain JSON, without TipTap's narrowed node types. */
export const json = (editor: Editor) => editor.getJSON() as JSONContent;

/** Paragraph texts, in order, with their labels from read_document. */
export function lines(editor: Editor) {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (!node.isTextblock) return;
    out.push(`${node.type.name === "heading" ? `h${node.attrs.level}` : node.type.name}:${node.textContent}`);
    return false;
  });
  return out;
}
