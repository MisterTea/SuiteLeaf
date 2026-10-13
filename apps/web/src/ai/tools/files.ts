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

/** Where a file that isn't in the library is, and how to get it. */
const ON_COMPUTER =
  "A file that is not listed here is on the user's computer (saved, downloaded or attached to an email): call open_from_computer, which asks them to pick it. Don't ask them first.";

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
          : `No files match "${query}". ${ON_COMPUTER}`;
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
        let r: FileRecord;
        try {
          r = findRecord(ctx.records, name);
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
          throw new ToolError(`${e.message} ${ON_COMPUTER}`);
        }
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
        return r.path
          ? `Removed "${r.file.title}" from the library. Its saved file stays on disk at ${r.path}; open_from_computer opens it again.`
          : `Deleted "${r.file.title}" from ${window.suiteleaf ? "this computer" : "this browser"}; this can't be undone. A copy that was downloaded or saved elsewhere is not affected: open_from_computer opens it again.`;
      },
    }),
    tool({
      name: "open_from_computer",
      label: "Open / import",
      description:
        "Open or import a file that is not in the library: an email attachment, a download or any Word, Excel, PowerPoint, CSV, HTML or SuiteLeaf file on the user's computer. The user picks it in a file picker, so you don't need its name. The chosen file opens in an editor. A CSV or TSV file is imported through its preview, with the choices below (leave them out to keep what SuiteLeaf detects).",
      parameters: Type.Object({
        keep_codes_as_text: Type.Optional(
          Type.Boolean({ description: "CSV/TSV: keep columns of codes with leading zeros (IDs, ZIP codes) as text, e.g. 00412 stays 00412. Default true." }),
        ),
        first_row_is_header: Type.Optional(Type.Boolean({ description: "CSV/TSV: the first row holds column names. Default: detected." })),
        separator: Type.Optional(Type.String({ enum: ["comma", "semicolon", "tab", "pipe"], description: "CSV/TSV: default detected." })),
      }),
      target: () => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Open / import")),
      async execute(choices) {
        const file = await requestFile("Choose the file to open", IMPORT_ACCEPT);
        if (!file) return "The user did not choose a file.";
        const banner = () => document.querySelector('.error[role="alert"]')?.textContent?.replace(/×$/, "").trim();
        const earlier = banner();
        let settled = false;
        const importing = ctx.importFile(file).finally(() => (settled = true));
        let preview = "";
        for (let i = 0; i < 100 && !settled; i++) {
          const dialog = document.querySelector<HTMLElement>(".csv-import-dialog");
          if (dialog) {
            preview = await answerImportPreview(dialog, file.name, choices);
            break;
          }
          await wait(100);
        }
        await importing;
        for (let i = 0; i < 100 && !location.hash.startsWith("#/file/"); i++) {
          const same = document.querySelector(".same-file-dialog");
          if (same)
            return `${same.querySelector("h2")?.textContent?.trim()}, so SuiteLeaf is asking the user what to do with "${file.name}": Cancel, Replace (the one here is replaced by the file) or Keep both (the file opens as a copy).${same.querySelector(".same-file-warning") ? " The one here has newer changes; replacing it discards them." : ""} Only the user can make this choice: tell them, and do not open or change the file yourself.`;
          const failed = banner();
          if (failed && failed !== earlier) throw new ToolError(`"${file.name}" could not be opened: ${failed}`);
          await wait(100);
        }
        if (!location.hash.startsWith("#/file/"))
          return `"${file.name}" was not opened (the user cancelled the import).`;
        const kind = await Promise.race(
          (["doc", "sheet", "slide"] as const).map((k) => waitForHost(k, 120000).then(() => k)),
        );
        const notes = [...document.querySelectorAll(".import-notes li")].map((li) => li.textContent?.trim()).filter(Boolean);
        const converted = document.querySelector(".import-notes")
          ? ` It was converted into an editable SuiteLeaf copy; the original file is unchanged.${notes.length ? ` Import notes: ${notes.join(" ")}` : ""}`
          : "";
        return opened(kind, `${preview || `Opened "${file.name}".`}${converted}`);
      },
    }),
  ];
}

const SEPARATORS: Record<string, string> = { comma: ",", semicolon: ";", tab: "\t", pipe: "|" };

/** Answers a CSV/TSV import preview with the agent's choices, as a person would, and says what it showed. */
async function answerImportPreview(
  dialog: HTMLElement,
  name: string,
  choices: { keep_codes_as_text?: boolean; first_row_is_header?: boolean; separator?: string },
) {
  const box = (text: string) =>
    [...dialog.querySelectorAll("label.checkbox-row")]
      .find((l) => l.textContent?.includes(text))
      ?.querySelector<HTMLInputElement>("input");
  const setBox = async (text: string, want: boolean | undefined) => {
    const input = box(text);
    if (!input || want === undefined) return;
    await moveCursor(input, text);
    if (input.checked !== want) input.click();
    await wait(500);
  };
  await wait(300);
  await moveCursor(dialog.querySelector('[role="status"]'), "Import preview");
  await wait(500);
  const separator = SEPARATORS[choices.separator ?? ""];
  const select = dialog.querySelector("select");
  if (separator && select && select.value !== separator) {
    await moveCursor(select, "Separator");
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, separator);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(500);
  }
  await setBox("First row is a header", choices.first_row_is_header);
  await setBox("Keep code columns as text", choices.keep_codes_as_text ?? true);
  const summary = dialog.querySelector('[role="status"]')?.textContent?.trim() ?? "";
  const columns = [...dialog.querySelectorAll("thead th")].map(
    (th) => `${th.querySelector("span")?.textContent ?? ""} (${th.querySelector("small")?.textContent ?? ""})`,
  );
  const codes = box("Keep code columns as text");
  const codeNote = codes
    ? codes.checked
      ? ` ${codes.parentElement?.querySelector("small")?.textContent?.trim()}`
      : " Code columns with leading zeros were not kept as text."
    : "";
  const notes = [...dialog.querySelectorAll(".csv-import-note")].map((n) => ` ${n.textContent?.trim()}`).join("");
  const error = dialog.querySelector('[role="alert"]')?.textContent?.trim();
  const buttons = [...dialog.querySelectorAll("button")];
  if (error) {
    buttons.find((b) => b.textContent?.trim() === "Cancel")?.click();
    throw new ToolError(`The import preview of "${name}" says: ${error} (${summary}). It was not imported.`);
  }
  const ok = buttons.find((b) => b.textContent?.trim() === "Import");
  await moveCursor(ok, "Import");
  ok?.click();
  return `Imported "${name}" from its preview: ${summary}. Columns: ${columns.join(", ")}.${codeNote}${notes}`;
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
  /** Download (or, on desktop, Save As): the file's name, and where it went when known; null if cancelled. */
  download: () => Promise<{ name: string; path?: string } | null>;
  /** The desktop app saves through a Save As dialog instead of downloading. */
  saveAs?: boolean;
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
      label: ctx.saveAs ? "Save As" : "Download",
      description: `${ctx.saveAs ? "Save the open file to a file on the computer (Save As)" : "Download the open file"} as one SuiteLeaf file that keeps everything in it, to keep or move to another computer. Use this when the user asks to download or save the file.`,
      parameters: Type.Object({}),
      target: () => document.querySelector(".save-copy"),
      async execute() {
        const saved = await ctx.download();
        if (!saved) return "Nothing was saved: the save was cancelled.";
        return `${saved.path ? `Saved "${saved.name}" to ${saved.path}` : `Downloaded "${saved.name}"`}: one SuiteLeaf file with the whole ${NAMES[ctx.kind]}, to keep or move to another computer. open_from_computer opens it again, here or on another computer.`;
      },
    }),
    tool({
      name: "back_to_files",
      label: "Back to files",
      description:
        "Close the open file and go back to the file list. Files save automatically, so never close a file just to save it: only do this when the user asks to go back or the task needs another file.",
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
