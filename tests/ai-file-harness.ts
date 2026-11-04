import { vi } from "vitest";
import { createFile, type FileRecord, type SuiteFile } from "@suiteleaf/core";
import { registerAgentHost, type AppKind, type SuiteTool } from "../apps/web/src/ai/host";
import type { HomeAgentContext } from "../apps/web/src/ai/tools/file-library";
import { homeTools } from "../apps/web/src/ai/tools/files";

export const useFileTimers = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });

export async function settle<T>(work: () => T | Promise<T>): Promise<T> {
  let done = false;
  const p = Promise.resolve().then(work);
  p.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 50 && !done; i++) {
    await vi.runAllTimersAsync();
    await new Promise((r) => setImmediate(r));
  }
  return p;
}

export const outText = (out: string | { text: string }) => (typeof out === "string" ? out : out.text);

export function record(kind: SuiteFile["kind"], title: string, extra: Partial<FileRecord> = {}, updatedAt = "2026-10-01T10:00:00.000Z"): FileRecord {
  const file = createFile(kind, title);
  file.updatedAt = updatedAt;
  return { file, ...extra };
}

let editorOff: (() => void) | undefined;
/** Navigate to an editor screen whose snapshot names it. */
export function openEditor(kind: AppKind, snapshot = `Open ${kind} editor.`) {
  editorOff?.();
  const tool: SuiteTool = { name: `${kind}_tool`, label: kind, description: "", parameters: {} as never, execute: () => "" };
  editorOff = registerAgentHost(kind === "home" ? "home" : "editor", { kind, snapshot: () => snapshot, tools: [tool] });
  location.hash = kind === "home" ? "#/" : `#/file/${kind}-1`;
}
export function closeEditor() {
  editorOff?.();
  editorOff = undefined;
}

/** A file list on screen and the home context the tools act through. */
export function homeHarness(records: FileRecord[], extra: Partial<HomeAgentContext> = {}) {
  const state = {
    records,
    query: "",
    filter: "all",
    sort: undefined as undefined | { by: string; desc: boolean },
    created: [] as { kind: string; title?: string }[],
    opened: [] as string[],
    imported: [] as string[],
    deleted: [] as string[],
    shownRemove: [] as string[],
  };
  /** Replace a record, as the library does when it saves one. */
  const update = (r: FileRecord, change: (r: FileRecord) => FileRecord) => {
    state.records = state.records.map((x) => (x.file.id === r.file.id ? change(x) : x));
    render();
  };
  const visible = () =>
    state.records.filter((r) => {
      if (state.query && !r.file.title.toLowerCase().includes(state.query.toLowerCase())) return false;
      if (state.filter === "trash") return !!r.trashedAt;
      if (r.trashedAt) return false;
      if (state.filter === "starred") return !!r.starred;
      if (state.filter === "all") return true;
      return r.file.kind === state.filter;
    });
  const render = () => {
    const list = document.querySelector(".file-list") ?? document.body.appendChild(Object.assign(document.createElement("div"), { className: "file-list" }));
    list.innerHTML = visible()
      .map((r) => {
        const t = r.file.title;
        return `<div class="file-row"><a href="#/file/${r.file.id}"><span>i</span><span>${t}<small> edited</small></span></a>${
          state.query ? `<span class="file-snippet">${state.query} here</span>` : ""
        }<button aria-label="Rename ${t}"></button><button aria-label="Duplicate ${t}"></button><button aria-label="Move ${t} to Trash"></button><button aria-label="${r.starred ? "Unstar" : "Star"} ${t}"></button>${
          r.trashedAt ? `<button aria-label="Restore ${t}"></button>` : ""
        }</div>`;
      })
      .join("");
  };
  const ctx: HomeAgentContext = {
    get records() {
      return state.records;
    },
    get shown() {
      return visible();
    },
    get query() {
      return state.query;
    },
    get filter() {
      return state.filter;
    },
    setQuery: (q) => {
      state.query = q;
      render();
    },
    setFilter: (f) => {
      state.filter = f;
      render();
    },
    setSort: (s) => {
      state.sort = s;
    },
    create: async (kind, title) => {
      state.created.push({ kind, title });
      openEditor(kind);
    },
    openNew: async (file) => {
      state.opened.push(file.title);
      openEditor(file.kind);
    },
    open: (r) => {
      state.opened.push(r.file.title);
      openEditor(r.file.kind);
    },
    openSample: (kind) => {
      state.opened.push(`sample ${kind}`);
      openEditor(kind);
    },
    rename: async (r, title) => update(r, (x) => ({ ...x, file: { ...x.file, title } })),
    duplicate: async (r) => {
      const copy = record(r.file.kind, `${r.file.title} (copy)`);
      state.records = [...state.records, copy];
      render();
      return copy;
    },
    showRemove: (r) => {
      state.shownRemove.push(r.file.title);
    },
    remove: async (r) => update(r, (x) => ({ ...x, trashedAt: "2026-10-02T00:00:00.000Z" })),
    importFile: async (file) => {
      state.imported.push(file.name);
    },
    star: async (r, starred) => update(r, (x) => ({ ...x, starred })),
    restore: async (r) =>
      update(r, (x) => {
        const next = { ...x };
        delete next.trashedAt;
        return next;
      }),
    fresh: async () => state.records,
    deleteForever: async (ids) => {
      state.deleted.push(...ids);
      state.records = state.records.filter((r) => !ids.includes(r.file.id));
      render();
    },
    ...extra,
  };
  render();
  const tools = Object.fromEntries(homeTools(ctx).map((t) => [t.name, t])) as Record<string, SuiteTool>;
  const prepared = (name: string, args: Record<string, unknown>) => (tools[name].prepare ? tools[name].prepare!({ ...args }) : args) as never;
  const call = async (name: string, args: Record<string, unknown> = {}) => outText(await settle(() => tools[name].execute(prepared(name, args))));
  /** Where the agent's pointer goes for this call (these tools point at elements). */
  const target = (name: string, args: Record<string, unknown> = {}) =>
    settle(() => tools[name].target?.(prepared(name, args))) as Promise<Element | null | undefined>;
  const confirm = (name: string, args: Record<string, unknown> = {}) => tools[name].confirm?.(prepared(name, args));
  return { state, ctx, tools, call, target, confirm, prepared, render, update };
}
