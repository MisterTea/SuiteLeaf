import { Type } from "@earendil-works/pi-ai";
import type { FileRecord, SuiteFile } from "@suiteleaf/core";
import { ToolError, currentSnapshot, tool, waitForHost, type SuiteTool } from "../host";
import { requestFile } from "../file-request";
import { moveCursor } from "../cursor";

export const IMPORT_ACCEPT =
  ".sldoc,.slsheet,.slslides,.suiteleaf,.docx,.xlsx,.xls,.xlsm,.xlsb,.xltx,.pptx,.ppt,.ppsx,.pptm,.potx,.ppsm,.html,.htm,.txt,.csv,.tsv";

type Kind = SuiteFile["kind"];
const KINDS: Record<string, Kind> = {
  document: "doc",
  doc: "doc",
  spreadsheet: "sheet",
  sheet: "sheet",
  presentation: "slide",
  slides: "slide",
  slide: "slide",
};
const NAMES: Record<Kind, string> = { doc: "document", sheet: "spreadsheet", slide: "presentation" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What the file list (home screen) lends the agent. */
export interface HomeAgentContext {
  records: FileRecord[];
  /** Files currently shown (after search and filters). */
  shown: FileRecord[];
  query: string;
  filter: string;
  setQuery: (q: string) => void;
  setFilter: (f: string) => void;
  setSort: (s: { by: "name" | "edited"; desc: boolean }) => void;
  create: (kind: Kind, title?: string) => Promise<void>;
  open: (record: FileRecord) => void;
  openSample: (kind: Kind) => void;
  rename: (record: FileRecord, title: string) => Promise<void>;
  duplicate: (record: FileRecord) => Promise<FileRecord>;
  showRemove: (record: FileRecord) => void;
  remove: (record: FileRecord) => Promise<void>;
  /** Import a file the user chose, as Open / import does. */
  importFile: (file: File) => Promise<void>;
  /** Where new files go, in cluster mode. */
  where?: string;
}

const describe = (r: FileRecord) =>
  `"${r.file.title}" (${NAMES[r.file.kind]}, edited ${new Date(r.file.updatedAt).toLocaleString()})`;

export function findRecord(records: FileRecord[], name: string, kind?: Kind) {
  const pool = kind ? records.filter((r) => r.file.kind === kind) : records;
  const n = name.trim().toLowerCase().replace(/\.(sldoc|slsheet|slslides)$/, "");
  const match =
    pool.find((r) => r.file.title.toLowerCase() === n) ??
    pool.find((r) => r.file.title.toLowerCase().includes(n)) ??
    pool.find((r) => n.includes(r.file.title.toLowerCase()));
  if (!match)
    throw new ToolError(
      `No file is called "${name}". Files: ${pool.map((r) => `"${r.file.title}"`).join(", ") || "none"}.`,
    );
  return match;
}

/** The listed rows: each file's title and, while searching, the quoted match. */
const listed = () =>
  [...document.querySelectorAll(".file-row")].map((el) => ({
    el,
    title: el.querySelector("a > span:last-child")?.firstChild?.textContent?.trim() ?? "",
    snippet: el.querySelector(".file-snippet")?.textContent?.trim(),
  }));

const row = (title: string) => listed().find((r) => r.title === title)?.el;

/** The file's row, clearing a search or type filter that hides it (as a person would). */
async function revealRow(ctx: HomeAgentContext, name: string) {
  const { title } = findRecord(ctx.records, name).file;
  if (!row(title)) {
    ctx.setQuery("");
    ctx.setFilter("all");
    await wait(400);
  }
  return scrolledTo(row(title));
}

/** Bring part of the file list into view, so the user sees what the agent acts on. */
async function scrolledTo<T extends Element>(el: T | undefined, block: ScrollLogicalPosition = "center") {
  const r = el?.getBoundingClientRect();
  if (el && r && (r.top < 0 || r.bottom > innerHeight)) {
    el.scrollIntoView({ behavior: "smooth", block });
    let last = NaN;
    for (let i = 0; i < 40; i++) {
      await wait(60);
      const top = el.getBoundingClientRect().top;
      if (top === last) break;
      last = top;
    }
  }
  return el;
}

const listing = () => listed().map((r) => `- "${r.title}"${r.snippet ? `: …${r.snippet}…` : ""}`);

const kindParam = Type.String({ enum: ["document", "spreadsheet", "presentation"] });

/** After navigating to an editor, describe it for the model. */
async function opened(kind: Kind, what: string) {
  await waitForHost(kind);
  return `${what}\n${currentSnapshot()}`;
}

export function homeTools(ctx: HomeAgentContext): SuiteTool[] {
  return [
    tool({
      name: "list_files",
      label: "List files",
      description: "List the files in the library, newest first. Optionally only one kind.",
      parameters: Type.Object({ kind: Type.Optional(kindParam) }),
      target: () => document.querySelector(".file-list") ?? document.querySelector(".file-section"),
      execute({ kind }) {
        const k = kind ? KINDS[kind] : undefined;
        const list = ctx.records
          .filter((r) => !k || r.file.kind === k)
          .sort((a, b) => b.file.updatedAt.localeCompare(a.file.updatedAt));
        return list.length ? list.map(describe).join("\n") : "There are no files yet.";
      },
    }),
    tool({
      name: "search_files",
      label: "Search files",
      description: "Search file names and the words inside files. Shows the results on screen. Use an empty query to clear the search.",
      parameters: Type.Object({ query: Type.String() }),
      target: () => document.querySelector('[aria-label="Search files"]'),
      async execute({ query }) {
        const box = document.querySelector<HTMLInputElement>('[aria-label="Search files"]');
        box?.focus();
        let typed = "";
        ctx.setQuery("");
        for (const ch of query) {
          typed += ch;
          ctx.setQuery(typed);
          await wait(35);
        }
        await wait(300);
        const hits = listing();
        if (!query) return "Cleared the search.";
        return hits.length
          ? `${hits.length} file(s) match "${query}" (in the name or the text):\n${hits.join("\n")}`
          : `No files match "${query}".`;
      },
    }),
    tool({
      name: "show_files",
      label: "Filter files",
      description: "Show all files or one kind (sidebar), and sort the list by name or by last edited.",
      parameters: Type.Object({
        show: Type.String({ enum: ["all", "documents", "spreadsheets", "presentations"] }),
        sort_by: Type.Optional(Type.String({ enum: ["name", "edited"] })),
      }),
      target: ({ show }) =>
        [...document.querySelectorAll(".sidebar-links button")].find((b) =>
          b.textContent?.toLowerCase().includes(show === "all" ? "all files" : show),
        ),
      async execute({ show, sort_by }) {
        ctx.setFilter({ all: "all", documents: "doc", spreadsheets: "sheet", presentations: "slide" }[show] ?? "all");
        if (sort_by) ctx.setSort({ by: sort_by as "name", desc: sort_by === "edited" });
        await wait(300);
        await scrolledTo(document.querySelector(".file-section") ?? undefined, "start");
        const search = ctx.query.trim()
          ? ` Only files matching the search "${ctx.query.trim()}" are listed; call search_files with an empty query to list them all.`
          : "";
        return `Showing ${show}${sort_by ? `, sorted by ${sort_by}` : ""}.${search}\n${listing().join("\n") || "No files listed."}`;
      },
    }),
    tool({
      name: "create_file",
      label: "New file",
      description: `Create a new document, spreadsheet or presentation${ctx.where ? ` in ${ctx.where}` : ""} and open it. Give a title if the user named it.`,
      parameters: Type.Object({ kind: kindParam, title: Type.Optional(Type.String()) }),
      target: ({ kind }) =>
        [...document.querySelectorAll(".new-card")].find((b) => b.textContent?.toLowerCase().includes(`new ${kind}`)),
      async execute({ kind, title }) {
        const k = KINDS[kind];
        if (!k) throw new ToolError(`Unknown kind "${kind}".`);
        await ctx.create(k, title);
        return opened(k, `Created a new ${kind}${title ? ` called "${title}"` : ""} and opened it.`);
      },
    }),
    tool({
      name: "open_file",
      label: "Open file",
      description: "Open a file from the library by its name.",
      parameters: Type.Object({ name: Type.String() }),
      target: async ({ name }) => (await revealRow(ctx, name))?.querySelector("a"),
      async execute({ name }) {
        const r = findRecord(ctx.records, name);
        ctx.open(r);
        return opened(r.file.kind, `Opened "${r.file.title}".`);
      },
    }),
    tool({
      name: "open_sample",
      label: "Open a sample",
      description: "Open a fresh copy of a sample: the sample document, the sample budget (spreadsheet) or the sample presentation.",
      parameters: Type.Object({ sample: Type.String({ enum: ["document", "budget", "presentation"] }) }),
      target: ({ sample }) =>
        [...document.querySelectorAll("button")].find((b) => b.textContent === `Sample ${sample}`),
      async execute({ sample }) {
        const k: Kind = sample === "document" ? "doc" : sample === "budget" ? "sheet" : "slide";
        ctx.openSample(k);
        return opened(k, `Opened the sample ${sample}.`);
      },
    }),
    tool({
      name: "rename_file",
      label: "Rename file",
      description: "Rename a file in the library.",
      parameters: Type.Object({ name: Type.String(), new_name: Type.String() }),
      target: async ({ name }) => (await revealRow(ctx, name))?.querySelector('[aria-label^="Rename"]'),
      async execute({ name, new_name }) {
        const r = findRecord(ctx.records, name);
        await ctx.rename(r, new_name);
        return `Renamed "${r.file.title}" to "${new_name}".`;
      },
    }),
    tool({
      name: "duplicate_file",
      label: "Make a copy",
      description: "Make a copy of a file in the library.",
      parameters: Type.Object({ name: Type.String() }),
      target: async ({ name }) => (await revealRow(ctx, name))?.querySelector('[aria-label^="Duplicate"]'),
      async execute({ name }) {
        const r = findRecord(ctx.records, name);
        const copy = await ctx.duplicate(r);
        return `Made a copy of "${r.file.title}" called "${copy.file.title}".`;
      },
    }),
    tool({
      name: "remove_file",
      label: "Remove file",
      description: "Delete a file from the library. Only do this when the user asked to delete or remove that file.",
      parameters: Type.Object({ name: Type.String() }),
      target: async ({ name }) => (await revealRow(ctx, name))?.querySelector('[aria-label^="Remove"]'),
      async execute({ name }) {
        const r = findRecord(ctx.records, name);
        ctx.showRemove(r);
        await wait(500);
        await moveCursor(document.querySelector('[role="dialog"] button[type="submit"]'), "Remove file");
        await wait(400);
        await ctx.remove(r);
        return `Removed "${r.file.title}".`;
      },
    }),
    tool({
      name: "open_from_computer",
      label: "Open / import",
      description:
        "Open or import a file that is not in the library: an email attachment, a download or any Word, Excel, PowerPoint, CSV, HTML or SuiteLeaf file on the user's computer. The user picks it in a file picker, so you don't need its name. The chosen file opens in an editor.",
      parameters: Type.Object({}),
      target: () => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Open / import")),
      async execute() {
        const file = await requestFile("Choose the file to open", IMPORT_ACCEPT);
        if (!file) return "The user did not choose a file.";
        await ctx.importFile(file);
        for (let i = 0; i < 1200 && !location.hash.startsWith("#/file/"); i++) await wait(100);
        if (!location.hash.startsWith("#/file/"))
          return `"${file.name}" was not opened (the import may be waiting for the user's choices).`;
        const kind = await Promise.race(
          (["doc", "sheet", "slide"] as const).map((k) => waitForHost(k, 120000).then(() => k)),
        );
        return opened(kind, `Opened "${file.name}".`);
      },
    }),
  ];
}

export function homeSnapshot(ctx: HomeAgentContext) {
  const recent = [...ctx.records]
    .sort((a, b) => b.file.updatedAt.localeCompare(a.file.updatedAt))
    .slice(0, 15)
    .map((r) => `- ${describe(r)}`);
  return `Screen: the file list${ctx.where ? ` (${ctx.where})` : ""}. ${ctx.records.length} file(s).${ctx.query ? ` Search: "${ctx.query}".` : ""}${ctx.filter !== "all" ? ` Showing only ${NAMES[ctx.filter as Kind]}s.` : ""}\n${recent.join("\n")}`;
}

/** What an open file's window (title bar, File menu) lends the agent. */
export interface WorkspaceAgentContext {
  title: string;
  kind: Kind;
  status: string;
  rename: (title: string) => void;
  download: () => void;
  back: () => Promise<void>;
  /** File > New: save this file, then create and open a new one. */
  create?: (kind: Kind, title?: string) => Promise<void>;
}

export function workspaceTools(ctx: WorkspaceAgentContext): SuiteTool[] {
  return [
    tool({
      name: "rename_this_file",
      label: "Rename",
      description: "Change the title of the open file.",
      parameters: Type.Object({ title: Type.String() }),
      target: () => document.querySelector(".workspace-header input"),
      async execute({ title }) {
        const input = document.querySelector<HTMLInputElement>(".workspace-header input");
        input?.focus();
        for (let i = 1; i <= title.length; i++) {
          ctx.rename(title.slice(0, i));
          await wait(30);
        }
        input?.blur();
        return `The file is now called "${title}".`;
      },
    }),
    tool({
      name: "download_file",
      label: "Download",
      description: "Download a SuiteLeaf copy of the open file to the computer, to keep or move to another computer.",
      parameters: Type.Object({}),
      target: () => document.querySelector(".save-copy"),
      execute() {
        ctx.download();
        return `Downloading "${ctx.title}".`;
      },
    }),
    tool({
      name: "back_to_files",
      label: "Back to files",
      description:
        "Close the open file and go back to the file list. Only when the user asks to go back, or to work on another file. Files save automatically, so never close a file just to save it.",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Back to files"]'),
      async execute() {
        await ctx.back();
        await waitForHost("home");
        return `Back on the file list.\n${currentSnapshot()}`;
      },
    }),
    ...(ctx.create
      ? [
          tool({
            name: "create_file",
            label: "New file",
            description: "Create a new document, spreadsheet or presentation (File > New) and open it. This file is saved first. Give a title if the user named it.",
            parameters: Type.Object({ kind: kindParam, title: Type.Optional(Type.String()) }),
            target: () => [...document.querySelectorAll(".file-menu button")].find((b) => b.textContent?.trim() === "File"),
            async execute({ kind, title }) {
              const k = KINDS[kind];
              if (!k) throw new ToolError(`Unknown kind "${kind}".`);
              const from = location.hash;
              await ctx.create!(k, title);
              for (let i = 0; i < 200 && location.hash === from; i++) await wait(100);
              // The old file's editor leaves once the new one's route renders.
              await wait(300);
              return opened(k, `Created a new ${kind}${title ? ` called "${title}"` : ""} and opened it.`);
            },
          }),
        ]
      : []),
  ];
}

export const workspaceSnapshot = (ctx: WorkspaceAgentContext) =>
  `Open file: "${ctx.title}" (${NAMES[ctx.kind]}). Save status: ${ctx.status}.`;
