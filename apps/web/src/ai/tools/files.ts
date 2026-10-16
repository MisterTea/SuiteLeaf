import { Type } from "@earendil-works/pi-ai";
import { parseFile, type FileRecord, type SuiteFile } from "@suiteleaf/core";
import { versionWhen } from "../../editors/version-history-model";
import { ToolError, currentSnapshot, currentSuiteTools, tool, waitForHost, type SuiteTool } from "../host";
import { instantiate, loadTemplates, saveAsTemplate, type TemplateEntry } from "../../templates/model";
import { templateStore } from "../../templates/store";
import { requestFile } from "../file-request";
import { moveCursor } from "../cursor";
import { requestApproval } from "../guard";

/** Words that ask for a file, slide or text to go. */
export const REMOVE_INTENT = /\b(remove|delete|trash|get rid of|throw (it |them )?away|bin it|discard)\b/i;

const safe = <T>(f: () => T) => {
  try {
    return f();
  } catch {
    return undefined;
  }
};

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
const NAMES: Record<Kind, string> = {
  doc: "document",
  sheet: "spreadsheet",
  slide: "presentation",
  form: "form",
};
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
  /** Save a new file and open it. Used for a copy of a template. */
  openNew: (file: SuiteFile) => Promise<void>;
  open: (record: FileRecord) => void;
  openSample: (kind: Kind) => void;
  rename: (record: FileRecord, title: string) => Promise<void>;
  duplicate: (record: FileRecord) => Promise<FileRecord>;
  showRemove: (record: FileRecord) => void;
  remove: (record: FileRecord) => Promise<void>;
  /** Import a file the user chose, as Open / import does. */
  importFile: (file: File) => Promise<void>;
  /** Star or unstar without changing the file itself. */
  star: (record: FileRecord, starred: boolean) => Promise<void>;
  /** Bring a file back from Trash. Star and text stay as they were. */
  restore: (record: FileRecord) => Promise<void>;
  /** Library rows as stored now, including Trash. */
  fresh: () => Promise<FileRecord[]>;
  /** Permanently remove these library entries (they are already in Trash). */
  deleteForever: (ids: string[]) => Promise<void>;
  /** Where new files go, in cluster mode. */
  where?: string;
}

/** Where a file that isn't in the library is, and how to get it. */
const ON_COMPUTER =
  "A file that is not listed here is on the user's computer (saved, downloaded or attached to an email): call open_from_computer, which asks them to pick it. Don't ask them first.";

const describe = (r: FileRecord) => {
  const marks = [r.starred ? "starred" : "", r.trashedAt ? "in Trash" : ""].filter(Boolean);
  return `"${r.file.title}" (${NAMES[r.file.kind]}${marks.length ? `, ${marks.join(", ")}` : ""}, edited ${new Date(r.file.updatedAt).toLocaleString()})`;
};

/** File titles from one argument: a title, a comma-separated list, or a JSON list. */
function splitNames(value: unknown): string[] {
  if (Array.isArray(value)) return dedupe(value.flatMap((item) => splitNames(item)));
  const text = String(value ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return splitNames(parsed);
    } catch {
      try {
        const parsed = JSON.parse(text.replace(/'/g, '"'));
        if (Array.isArray(parsed)) return splitNames(parsed);
      } catch {
        // A title, not a list.
      }
    }
  }
  return dedupe(
    text
      .split(/,|\n|;|\band\b/i)
      .map((part) => part.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\.+$/g, "").trim())
      .filter((part) => part && !/^(and|or)$/i.test(part)),
  );
}

function dedupe(names: string[]) {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function namesFrom(args: { name?: unknown; names?: unknown }) {
  return dedupe([...splitNames(args.names), ...splitNames(args.name)]);
}

const joinTitles = (records: FileRecord[]) => records.map((r) => `"${r.file.title}"`).join(", ");

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
  const record = findRecord(ctx.records, name);
  const { title } = record.file;
  if (!row(title)) {
    ctx.setQuery("");
    ctx.setFilter(record.trashedAt ? "trash" : "all");
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

const kindParam = Type.String({ enum: ["document", "spreadsheet", "presentation"] });

/** After navigating to an editor, describe it for the model. */
async function opened(kind: Kind, what: string) {
  await waitForHost(kind);
  return `${what}\n${currentSnapshot()}`;
}

const SHOW = {
  all: "all",
  documents: "doc",
  spreadsheets: "sheet",
  presentations: "slide",
  starred: "starred",
  trash: "trash",
} as const;

async function poll<T>(read: () => T | undefined, ms = 3000): Promise<T | undefined> {
  const start = Date.now();
  for (;;) {
    const found = read();
    if (found) return found;
    if (Date.now() - start > ms) return undefined;
    await wait(50);
  }
}

/** Move the named files to Trash if needed, ask, then empty Trash through the dialog. */
async function emptyTrashForever(ctx: HomeAgentContext, targets: FileRecord[]) {
  for (const target of targets) {
    const latest = (await ctx.fresh()).find((r) => r.file.id === target.file.id) ?? target;
    if (!latest.trashedAt) await ctx.remove(latest);
  }
  ctx.setQuery("");
  ctx.setFilter("trash");
  const titles = targets.map((r) => r.file.title);
  const button = await poll(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Empty trash"),
  );
  if (button) {
    await moveCursor(button, "Empty trash");
    button.click();
    const dialog = await poll(() => document.querySelector<HTMLElement>('[role="dialog"]'));
    const text = dialog?.textContent ?? "";
    const cancel = [...(dialog?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === "Cancel");
    const items = [...(dialog?.querySelectorAll(".trash-name-list li") ?? [])].map((li) => li.textContent?.trim() ?? "");
    const named = titles.every((title) => text.includes(title));
    const extra = items.filter((item) => item && !titles.includes(item));
    if (dialog && named && !extra.length) {
      const submit = [...dialog.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Delete forever");
      await moveCursor(submit, "Delete forever");
      await wait(400);
      submit?.click();
    } else if (extra.length) {
      cancel?.click();
      throw new ToolError(
        `Trash also has ${extra.map((item) => `"${item}"`).join(", ")}. Restore that with restore_file before emptying Trash.`,
      );
    } else {
      cancel?.click();
      await ctx.deleteForever(targets.map((r) => r.file.id));
    }
  } else {
    await ctx.deleteForever(targets.map((r) => r.file.id));
  }
  let left: FileRecord[] = targets;
  for (let i = 0; i < 30; i++) {
    const now = await ctx.fresh();
    left = now.filter((r) => targets.some((t) => t.file.id === r.file.id));
    if (!left.length) break;
    await wait(100);
  }
  if (left.length)
    throw new ToolError(`Could not delete ${joinTitles(left)} forever.`);
  return `Deleted ${titles.join(", ")} forever. They are gone from Trash and from the library.`;
}

function templateQuery(name: string) {
  return name
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^the\s+/i, "")
    .replace(/\s+template$/i, "")
    .trim()
    .toLowerCase();
}

function findTemplate(entries: TemplateEntry[], name: string) {
  const n = templateQuery(name);
  const list = entries.map((e) => `"${e.info.name}"`).join(", ") || "none";
  if (!n) throw new ToolError(`Name the template. Templates: ${list}.`);
  const exact = entries.filter((e) => e.info.name.toLowerCase() === n);
  if (exact.length) return exact[0];
  const partial = entries.filter((e) => e.info.name.toLowerCase().includes(n) || n.includes(e.info.name.toLowerCase()));
  if (partial.length === 1) return partial[0];
  if (!partial.length) throw new ToolError(`No template is called "${name}". Templates: ${list}.`);
  throw new ToolError(
    `Several templates match "${name}": ${partial.map((e) => `"${e.info.name}"`).join(", ")}. Use the exact name.`,
  );
}

function templateHint(entry: TemplateEntry) {
  if (entry.info.kind === "sheet") {
    const file = entry.file;
    const sheet = file.kind === "sheet" ? file.content.workbook.sheets[file.content.workbook.sheetOrder[0]] : undefined;
    const header = sheet?.cellData?.[4]?.[0] as { v?: unknown } | undefined;
    if (header?.v === "Item")
      return " Line items are rows 6 to 8: A is the item, B the quantity, C the price. B2 is the From name. Column D and the Total are formulas; do not type over them.";
    return " Formulas already in the sheet update on their own; do not type over them.";
  }
  if (entry.info.kind === "doc")
    return ' To add a line under a heading, call write_text with after set to that heading. Do not set replace_document.';
  return " Change the slides only if the user asked for changes.";
}

const templateCard = (name: string) =>
  document.querySelector<HTMLElement>(`button[aria-label="${CSS.escape(name)}"]`);

/** List, copy, save, and remove templates. Saving needs the open file. */
function templateTools(ctx: {
  openNew: (file: SuiteFile) => Promise<void>;
  snapshotFile?: () => Promise<SuiteFile>;
}): SuiteTool[] {
  const listed = (entries: TemplateEntry[]) =>
    entries
      .map((e) => `- "${e.info.name}" (${NAMES[e.info.kind]}, ${e.info.source === "yours" ? "saved by you" : "built-in"}): ${e.info.description}`)
      .join("\n");
  const tools: SuiteTool[] = [
    tool({
      name: "list_templates",
      label: "List templates",
      description:
        "List templates a new file can be copied from. Built-in templates are Invoice, Budget, Project tracker, Meeting notes, Letter, Pitch deck, and Announcement. Templates saved with save_as_template are listed too.",
      parameters: Type.Object({}),
      repeatable: true,
      target: () => document.querySelector(".template-band") ?? document.querySelector(".template-gallery"),
      async execute() {
        const entries = await loadTemplates();
        return entries.length ? listed(entries) : "There are no templates.";
      },
    }),
    tool({
      name: "create_from_template",
      label: "Use template",
      description:
        "Copy a template into a new file and open it. Use this, not create_file, when the user wants a file from a template (Invoice, Meeting notes, Pitch deck, Budget, or a template they saved). Pass title to name the new file. The copy is separate: later edits do not change the template or other files. If a file is open, it is saved first.",
      parameters: Type.Object({
        name: Type.String({ description: "Template name, such as Invoice or Bakery invoice." }),
        title: Type.Optional(Type.String({ description: "Title of the new file. Leave out to use the template's name." })),
      }),
      prepare: (args) => {
        if (args.name == null && typeof args.template === "string") args.name = args.template;
        if (args.title == null && typeof args.file_title === "string") args.title = args.file_title;
        return args;
      },
      target: ({ name }) => templateCard(String(name ?? "")),
      async execute({ name, title }) {
        const entries = await loadTemplates();
        const entry = findTemplate(entries, name);
        const file = instantiate(entry);
        const named = title?.trim();
        if (named) file.title = named.slice(0, 200);
        const from = location.hash;
        try {
          await ctx.openNew(file);
        } catch (e) {
          throw new ToolError(e instanceof Error ? e.message : String(e));
        }
        for (let i = 0; i < 200 && location.hash === from; i++) await wait(100);
        for (let i = 0; i < 80; i++) {
          const input = document.querySelector<HTMLInputElement>('[aria-label="File title"]');
          if (location.hash !== from && input?.value === file.title) break;
          await wait(100);
        }
        await wait(300);
        return opened(
          file.kind,
          `Created a ${NAMES[file.kind]} from the "${entry.info.name}" template, called "${file.title}". Editing this file does not change the template or any other file.${templateHint(entry)}`,
        );
      },
    }),
    tool({
      name: "remove_template",
      label: "Remove template",
      description:
        "Remove a template the user saved with save_as_template. Built-in templates cannot be removed. Files already created from it stay in the library. Only when the user asked to remove that template.",
      parameters: Type.Object({
        name: Type.String({ description: "The saved template's name, such as Bakery invoice." }),
      }),
      prepare: (args) => {
        if (args.name == null && typeof args.template === "string") args.name = args.template;
        return args;
      },
      confirm: ({ name }) => `Remove the template "${String(name ?? "").trim()}"? Files made from it stay in the library.`,
      target: ({ name }) =>
        document.querySelector<HTMLElement>(`[aria-label="Actions for ${name}"]`) ?? templateCard(String(name ?? "")),
      async execute({ name }) {
        const entries = await loadTemplates();
        const n = templateQuery(name);
        const yours = entries.filter((e) => e.info.source === "yours" && e.info.name.toLowerCase() === n);
        if (!yours.length) {
          const builtin = entries.find((e) => e.info.source === "builtin" && e.info.name.toLowerCase() === n);
          const saved = entries.filter((e) => e.info.source === "yours").map((e) => `"${e.info.name}"`).join(", ") || "none";
          if (builtin) throw new ToolError(`"${builtin.info.name}" is a built-in template and can't be removed. Saved templates: ${saved}.`);
          throw new ToolError(`No saved template is called "${name}". Saved templates: ${saved}.`);
        }
        for (const entry of yours) await templateStore.remove(entry.info.id);
        const card = templateCard(yours[0].info.name);
        await scrolledTo(card ?? undefined);
        return `Removed the template "${yours[0].info.name}". Files already created from it are still in the library.`;
      },
    }),
  ];
  if (ctx.snapshotFile) {
    const snapshotFile = ctx.snapshotFile;
    tools.push(
      tool({
        name: "save_as_template",
        label: "Save as template",
        description:
          "Save the open file as a template on this computer, under name. The open file stays as it is. Later edits to this file do not change the template. Fill the file in first if the template should include those edits. Do not use a built-in template's name unless the user asked for that name.",
        parameters: Type.Object({
          name: Type.String({ description: "Name of the new template, such as Bakery invoice." }),
        }),
        prepare: (args) => {
          if (args.name == null && typeof args.title === "string") args.name = args.title;
          return args;
        },
        target: () => [...document.querySelectorAll(".file-menu button")].find((b) => b.textContent?.trim() === "File"),
        async execute({ name }) {
          const title = name.trim();
          if (!title) throw new ToolError("Name the template.");
          let file: SuiteFile;
          try {
            file = await snapshotFile();
          } catch (e) {
            throw new ToolError(e instanceof Error ? e.message : String(e));
          }
          const info = await saveAsTemplate(title, file);
          return `Saved "${file.title}" as a template called "${info.name}". This file is unchanged. Later edits to this file do not change the template. create_from_template copies it into a new file.`;
        },
      }),
    );
  }
  return tools;
}

export function homeTools(ctx: HomeAgentContext): SuiteTool[] {
  const mark = (title: string) => {
    const rec = ctx.records.find((r) => r.file.title === title);
    if (!rec) return "";
    const bits = [rec.starred ? "starred" : "", rec.trashedAt ? "in Trash" : ""].filter(Boolean);
    return bits.length ? ` (${bits.join(", ")})` : "";
  };
  const listing = () => listed().map((r) => `- "${r.title}"${mark(r.title)}${r.snippet ? `: …${r.snippet}…` : ""}`);
  const nameArgs = Type.Object({
    name: Type.Optional(Type.String({ description: "One file title." })),
    names: Type.Optional(Type.String({ description: "Several file titles, separated by commas." })),
  });
  const prepareNames = (args: Record<string, unknown>) => {
    if (Array.isArray(args.names)) args.names = args.names.join(", ");
    if (Array.isArray(args.name)) {
      args.names = (args.name as unknown[]).join(", ");
      delete args.name;
    }
    return args;
  };
  return [
    tool({
      name: "list_files",
      label: "List files",
      description:
        "List the files in the library, newest first, then anything in Trash. Says which files are starred. Optionally only one kind.",
      parameters: Type.Object({ kind: Type.Optional(kindParam) }),
      target: () => document.querySelector(".file-list") ?? document.querySelector(".file-section"),
      execute({ kind }) {
        const k = kind ? KINDS[kind] : undefined;
        const list = ctx.records
          .filter((r) => !k || r.file.kind === k)
          .sort((a, b) => b.file.updatedAt.localeCompare(a.file.updatedAt));
        if (!list.length) return "There are no files yet.";
        const live = list.filter((r) => !r.trashedAt);
        const binned = list.filter((r) => r.trashedAt);
        return [
          live.length ? live.map(describe).join("\n") : "No files outside Trash.",
          binned.length ? `In Trash:\n${binned.map(describe).join("\n")}` : "Trash is empty.",
        ].join("\n");
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
      description:
        "Show all files, one kind, starred files, or Trash (sidebar), and sort the list by name or by last edited. The list stays as this call left it, so don't follow it with show \"all\" unless the user asked to see every file.",
      parameters: Type.Object({
        show: Type.String({ enum: ["all", "documents", "spreadsheets", "presentations", "starred", "trash"] }),
        sort_by: Type.Optional(Type.String({ enum: ["name", "edited"] })),
      }),
      target: ({ show }) =>
        [...document.querySelectorAll(".sidebar-links button")].find((b) =>
          b.textContent?.toLowerCase().includes(show === "all" ? "all files" : show),
        ),
      async execute({ show, sort_by }) {
        ctx.setFilter(SHOW[show as keyof typeof SHOW] ?? "all");
        if (show === "starred" && !sort_by) ctx.setSort({ by: "edited", desc: true });
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
      description:
        "Open a file by its name. If it is not in the library, it is on the user's computer, so they are asked to pick it (as open_from_computer does).",
      parameters: Type.Object({ name: Type.String() }),
      target: async ({ name }) =>
        (await revealRow(ctx, name).catch(() => undefined))?.querySelector("a") ??
        [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Open / import")),
      async execute({ name }, signal) {
        let r: FileRecord;
        try {
          r = findRecord(ctx.records, name);
        } catch (e) {
          const fromComputer = currentSuiteTools().find((t) => t.name === "open_from_computer");
          if (!(e instanceof ToolError) || !fromComputer) throw e;
          const out = await fromComputer.execute({}, signal);
          const files = e.message.slice(e.message.indexOf("Files:")).replace(/\.$/, "");
          return `"${name}" is not in the library (${files}), so the user was asked to pick it from their computer. ${typeof out === "string" ? out : out.text}`;
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
      label: "Move to Trash",
      description:
        "Move a file to Trash. It is not deleted forever: restore_file brings it back with the same text and star, and empty_trash deletes Trash forever after the user confirms. Pass several titles in names, separated by commas. Only when the user asked to delete, remove, or trash that file.",
      parameters: Type.Object({
        name: Type.Optional(Type.String({ description: "One file title." })),
        names: Type.Optional(Type.String({ description: "Several file titles, separated by commas." })),
      }),
      prepare: prepareNames,
      intent: REMOVE_INTENT,
      confirm: ({ name }) => {
        const list = namesFrom({ name });
        if (list.length !== 1) return undefined;
        const r = ctx.records.find((x) => x.file.title === list[0]) ?? safe(() => findRecord(ctx.records, list[0]));
        return r && `Remove “${r.file.title}” from SuiteLeaf?${r.path ? " Its saved file stays on disk." : " This can't be undone."}`;
      },
      target: async (args) => {
        const first = namesFrom(args)[0];
        if (!first) return undefined;
        return (await revealRow(ctx, first).catch(() => undefined))?.querySelector('[aria-label^="Move "][aria-label$=" to Trash"]');
      },
      async execute(args) {
        const list = namesFrom(args);
        if (!list.length) throw new ToolError("Name the file to move to Trash.");
        const lines: string[] = [];
        for (const name of list) {
          const r = findRecord(ctx.records, name);
          if (r.trashedAt) {
            lines.push(`"${r.file.title}" is already in Trash. restore_file brings it back. empty_trash deletes it forever.`);
            continue;
          }
          const bin = (await revealRow(ctx, r.file.title).catch(() => undefined))?.querySelector(
            '[aria-label^="Move "][aria-label$=" to Trash"]',
          );
          await moveCursor(bin, "Move to Trash");
          ctx.showRemove(r);
          await wait(200);
          const submit = document.querySelector('[role="dialog"] button[type="submit"]');
          if (submit) {
            await moveCursor(submit, "Remove file");
            await wait(300);
          }
          await ctx.remove(r);
          lines.push(
            r.path
              ? `Moved "${r.file.title}" to Trash. Its saved file stays on disk at ${r.path}; open_from_computer opens it again.`
              : `Moved "${r.file.title}" to Trash. Empty Trash deletes it. A copy that was downloaded or saved elsewhere is not affected. restore_file brings it back with the same text and star.`,
          );
        }
        return lines.join("\n");
      },
    }),
    tool({
      name: "star_file",
      label: "Star file",
      description:
        "Star a file, or several files named in names separated by commas, so they show under Starred. Does not change the file's text. Star a file before moving it to Trash if it should be kept. Pass starred false only to remove a star.",
      parameters: Type.Object({
        name: Type.Optional(Type.String({ description: "One file title." })),
        names: Type.Optional(Type.String({ description: "Several file titles, separated by commas." })),
        starred: Type.Optional(Type.Boolean({ description: "True to star (the default), false to unstar." })),
      }),
      prepare: (args) => {
        prepareNames(args);
        if (args.starred === "true") args.starred = true;
        if (args.starred === "false") args.starred = false;
        return args;
      },
      target: async (args) => {
        const first = namesFrom(args)[0];
        if (!first) return undefined;
        const title = findRecord(ctx.records, first).file.title;
        return (await revealRow(ctx, title).catch(() => undefined))?.querySelector(
          `[aria-label="Star ${title}"], [aria-label="Unstar ${title}"]`,
        );
      },
      async execute(args) {
        const list = namesFrom(args);
        if (!list.length) throw new ToolError("Name the file to star.");
        const want = args.starred !== false;
        const done: string[] = [];
        for (const name of list) {
          const r = findRecord(ctx.records, name);
          const button = (await revealRow(ctx, r.file.title).catch(() => undefined))?.querySelector(
            `[aria-label="${want ? "Star" : "Unstar"} ${r.file.title}"]`,
          );
          await moveCursor(button, want ? "Star" : "Unstar");
          await ctx.star(r, want);
          done.push(`"${r.file.title}"`);
          await wait(200);
        }
        return `${want ? "Starred" : "Unstarred"} ${done.join(", ")}. The text is unchanged. A star stays on the file through Trash and restore.`;
      },
    }),
    tool({
      name: "restore_file",
      label: "Restore file",
      description:
        "Bring a file back from Trash. Title, text, last-edited time, and star stay as they were. Use this when the user wants a trashed file back. Pass several titles in names, separated by commas.",
      parameters: nameArgs,
      prepare: prepareNames,
      target: async (args) => {
        const first = namesFrom(args)[0];
        if (!first) return undefined;
        const title = findRecord(ctx.records, first).file.title;
        return (await revealRow(ctx, title).catch(() => undefined))?.querySelector(`[aria-label="Restore ${title}"]`);
      },
      async execute(args) {
        const list = namesFrom(args);
        if (!list.length) throw new ToolError("Name the file to restore.");
        const lines: string[] = [];
        for (const name of list) {
          const r = findRecord(ctx.records, name);
          if (!r.trashedAt) {
            lines.push(`"${r.file.title}" is not in Trash${r.starred ? " and is still starred" : ""}.`);
            continue;
          }
          const button = (await revealRow(ctx, r.file.title).catch(() => undefined))?.querySelector(
            `[aria-label="Restore ${r.file.title}"]`,
          );
          await moveCursor(button, "Restore");
          if (button) (button as HTMLButtonElement).click();
          else await ctx.restore(r);
          let back = r;
          for (let i = 0; i < 20; i++) {
            const cur = (await ctx.fresh()).find((item) => item.file.id === r.file.id);
            if (cur && !cur.trashedAt) {
              back = cur;
              break;
            }
            await wait(100);
          }
          if (back.trashedAt) await ctx.restore(r);
          lines.push(
            `Restored "${r.file.title}" from Trash. Same title and text. ${r.starred ? "It is still starred." : "It was not starred."}`,
          );
        }
        return lines.join("\n");
      },
    }),
    tool({
      name: "empty_trash",
      label: "Empty Trash",
      description:
        "Delete files forever. Pass every file that should go, comma-separated, in one call. Moves them to Trash if needed, asks the user to confirm by name, then empties Trash. Refuses while any other file, or a starred file, is in Trash: restore that file first. Never include a file the user still wants.",
      parameters: nameArgs,
      prepare: prepareNames,
      target: () =>
        [...document.querySelectorAll(".sidebar-links button")].find((b) => b.textContent?.toLowerCase().includes("trash")),
      async execute(args) {
        const records = await ctx.fresh();
        const named = namesFrom(args);
        const trashed = records.filter((r) => r.trashedAt);
        const targets = named.length ? named.map((name) => findRecord(records, name)) : trashed;
        if (!targets.length)
          throw new ToolError("Nothing to delete forever. Name the files, or move them to Trash first.");
        const starred = targets.filter((r) => r.starred);
        if (starred.length)
          throw new ToolError(
            `${joinTitles(starred)} ${starred.length === 1 ? "is" : "are"} starred. Starred files are not deleted forever. Leave them out of empty_trash. If one is in Trash, restore_file brings it back.`,
          );
        const ids = new Set(targets.map((r) => r.file.id));
        const extras = trashed.filter((r) => !ids.has(r.file.id));
        if (extras.length)
          throw new ToolError(
            `${joinTitles(extras)} ${extras.length === 1 ? "is" : "are"} also in Trash. Restore ${extras.length === 1 ? "it" : "them"} with restore_file before emptying Trash, or ${extras.length === 1 ? "it" : "they"} would be deleted forever too.`,
          );
        const n = targets.length;
        const question = `Delete ${n} ${n === 1 ? "file" : "files"} forever? ${targets.map((r) => r.file.title).join(", ")}. This can't be undone.`;
        if (!(await requestApproval(question)))
          throw new ToolError(
            `The user answered no to "${question}", so nothing was deleted. Don't try it another way; finish the rest of the request, then say what you left alone.`,
          );
        return emptyTrashForever(ctx, targets);
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
    ...templateTools({ openNew: ctx.openNew }),
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

const VIEW: Record<string, string> = {
  starred: "starred files",
  trash: "Trash",
  doc: "documents",
  sheet: "spreadsheets",
  slide: "presentations",
};

export function homeSnapshot(ctx: HomeAgentContext) {
  const recent = [...ctx.records]
    .sort((a, b) => b.file.updatedAt.localeCompare(a.file.updatedAt))
    .slice(0, 15)
    .map((r) => `- ${describe(r)}`);
  const trashed = ctx.records.filter((r) => r.trashedAt).length;
  const starred = ctx.records.filter((r) => r.starred && !r.trashedAt).length;
  const view = VIEW[ctx.filter] ?? "";
  return `Screen: the file list${ctx.where ? ` (${ctx.where})` : ""}. ${ctx.records.length - trashed} file(s) in the library, ${starred} starred, ${trashed} in Trash.${ctx.query ? ` Search: "${ctx.query}".` : ""}${view ? ` Showing ${view}.` : ""}\n${recent.join("\n")}`;
}

/** What an open file's window (title bar, File menu) lends the agent. */
export interface WorkspaceAgentContext {
  title: string;
  kind: Kind;
  status: string;
  rename: (title: string) => void;
  /** A copy of the open file: its name, and where it went when known; null if cancelled. */
  download: () => Promise<{ name: string; path?: string } | null>;
  back: () => Promise<void>;
  /** File > New: save this file, then create and open a new one. */
  create?: (kind: Kind, title?: string) => Promise<void>;
  /** Save the open file, then save and open `file`. */
  openNew: (file: SuiteFile) => Promise<void>;
  /** Flush the open file and return a copy to store as a template. */
  snapshotFile: () => Promise<SuiteFile>;
  /** Saved versions of the open file (SuiteDrive, or snapshots on this computer). */
  versions: VersionActions;
}

/** One saved version the assistant can restore or copy. */
export interface ListedVersion {
  id: string;
  author: string;
  createdAt: string;
  name: string | null;
  current: boolean;
  /** Paragraphs of that version, so two saves can be told apart. */
  preview: string;
}

export interface VersionActions {
  list: () => Promise<ListedVersion[]>;
  restore: (id: string) => Promise<void>;
  /** A new file in the same folder. Returns the name it was saved under. */
  copy: (version: ListedVersion) => Promise<string>;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The words of a version, for the model and for matching what it asked for. */
export function versionPreview(native: string): string {
  try {
    const file = parseFile(native);
    const lines: string[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const record = node as { text?: unknown; content?: unknown };
      if (typeof record.text === "string" && record.text.trim()) lines.push(record.text.trim());
      if (Array.isArray(record.content)) for (const child of record.content) walk(child);
    };
    if (file.kind === "doc") walk(file.content);
    else lines.push(file.title);
    return lines.slice(0, 8).join(" | ");
  } catch {
    return "";
  }
}

export function formatVersionList(versions: ListedVersion[]): string {
  if (!versions.length) return "This file has no saved versions.";
  return versions
    .map((version, index) => {
      const when = `${versionWhen(version.createdAt)} (${WEEKDAYS[new Date(version.createdAt).getDay()]}) · ${version.author}`;
      const named = version.name ? ` "${version.name}"` : "";
      const mark = version.current ? " [current]" : "";
      return `${index + 1}. ${when}${named}${mark}\n   id: ${version.id}\n   ${version.preview || "(no text)"}`;
    })
    .join("\n");
}

const VERSION_STOP = new Set([
  "the", "a", "an", "version", "versions", "from", "so", "rota", "watering", "agreed", "again",
  "keep", "rewrite", "history", "restore", "restored", "earlier", "evening", "morning", "document",
  "text", "one", "it", "is", "of", "and", "to", "back", "put", "this", "that", "her", "his", "my",
  "file", "open",
]);

/** The version `query` names: an id, or the author and time from list_versions. */
export function pickVersion(versions: ListedVersion[], query: string): ListedVersion {
  const raw = query.trim();
  const q = raw.toLowerCase();
  if (!q) throw new ToolError(`Say which version. ${formatVersionList(versions)}`);
  const byId = versions.find((version) => version.id === raw);
  if (byId) return byId;
  if (raw.length >= 8) {
    const byPrefix = versions.filter((version) => version.id.startsWith(raw));
    if (byPrefix.length === 1) return byPrefix[0];
  }
  if (/^(current|latest|the current version)$/.test(q)) {
    const current = versions.find((version) => version.current);
    if (current) return current;
  }
  const words = q.split(/[^a-z0-9:]+/).filter((word) => word.length > 1 && !VERSION_STOP.has(word));
  const ranked = versions
    .map((version) => {
      const when = `${versionWhen(version.createdAt)} ${WEEKDAYS[new Date(version.createdAt).getDay()]}`.toLowerCase();
      const author = version.author.toLowerCase();
      const name = (version.name ?? "").toLowerCase();
      const preview = version.preview.toLowerCase();
      const label = `${when} · ${author}`;
      let score = 0;
      if (name && q === name) score += 100;
      if (author && (q === author || author.includes(q))) score += 80;
      if (label.includes(q)) score += 70;
      for (const word of words) {
        if (author.includes(word)) score += 25;
        if (when.includes(word)) score += 20;
        if (name.includes(word)) score += 20;
        if (preview.includes(word)) score += 2;
      }
      return { version, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const next = ranked[1];
  if (!best || best.score < 20 || (next && next.score >= best.score))
    throw new ToolError(`No single version matches "${query}".\n${formatVersionList(versions)}`);
  return best.version;
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
      label: "Save a copy",
      description:
        "Save a copy of the open file as one SuiteLeaf file that keeps everything in it, to keep or move to another computer. Use this when the user asks to download or save the file. Export tools are only for a copy in another format, such as Word, Excel or CSV.",
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
    ...templateTools({ openNew: ctx.openNew, snapshotFile: ctx.snapshotFile }),
    ...versionTools(ctx),
  ];
}

const versionButton = () => document.querySelector('[aria-label="Version history"]');

function versionTools(ctx: WorkspaceAgentContext): SuiteTool[] {
  const history = () => ctx.versions.list();
  return [
    tool({
      name: "list_versions",
      label: "Version history",
      description:
        "List saved versions of the open file, newest first. Each line has when it was saved, who saved it, its id, and its text. The current version is marked [current]. Call this before restore_version.",
      parameters: Type.Object({}),
      target: () => versionButton(),
      async execute() {
        const versions = await history();
        return formatVersionList(versions);
      },
    }),
    tool({
      name: "restore_version",
      label: "Restore version",
      description:
        "Put a whole earlier saved version back as the open file. Pass version as the id from list_versions, or the author and time, such as \"Rosa Diaz\" or \"Yesterday 18:02\". The version you replace stays in the history, so it is not deleted. Do not retype the old text. This replaces every paragraph. To put one paragraph back and leave the rest, call restore_paragraph instead.",
      parameters: Type.Object({
        version: Type.String({ description: "Version id, or the author and time from list_versions." }),
      }),
      prepare: (args) => {
        const named = args.version ?? args.version_id ?? args.id ?? args.which ?? args.name;
        if (typeof named === "string" && named.trim()) return { version: named };
        const parts = [args.author, args.when, args.time].filter((part) => typeof part === "string");
        return { version: parts.join(" ") };
      },
      target: () => versionButton(),
      async execute({ version }) {
        const versions = await history();
        const picked = pickVersion(versions, version);
        if (picked.current)
          throw new ToolError(
            `${versionWhen(picked.createdAt)} · ${picked.author} is already the current version. Restore an earlier one.\n${formatVersionList(versions)}`,
          );
        await ctx.versions.restore(picked.id);
        const marker = picked.preview.split(" | ").find((line) => line && line !== ctx.title) ?? "";
        for (let i = 0; i < 30; i++) {
          const editor = document.querySelector('[aria-label="Document content"], [aria-label="Spreadsheet"], [aria-label="Slide canvas"]');
          if (!marker || editor?.textContent?.includes(marker.slice(0, 24))) break;
          await wait(100);
        }
        await moveCursor(document.querySelector('[aria-label="Document content"]') ?? versionButton(), "Restored");
        const when = `${versionWhen(picked.createdAt)} · ${picked.author}`;
        return `Restored ${when}. The document is that version now. The version you replaced is still in the history, so it was not lost. Do not type over the document.\n${picked.preview}`;
      },
    }),
    tool({
      name: "copy_version",
      label: "Copy a version",
      description:
        "Save one version as its own file in the same folder, named with the author and the time. The open file stays as it is. Restoring already keeps every version in the history, so only do this when the user asked for a separate file.",
      parameters: Type.Object({
        version: Type.String({ description: "Version id, or the author and time from list_versions." }),
      }),
      prepare: (args) => {
        const named = args.version ?? args.version_id ?? args.id ?? args.which ?? args.name;
        if (typeof named === "string" && named.trim()) return { version: named };
        const parts = [args.author, args.when, args.time].filter((part) => typeof part === "string");
        return { version: parts.join(" ") };
      },
      target: () => versionButton(),
      async execute({ version }) {
        const versions = await history();
        const picked = pickVersion(versions, version);
        const filename = await ctx.versions.copy(picked);
        return `Saved a copy of ${versionWhen(picked.createdAt)} · ${picked.author} as "${filename}" in this folder. The open file is unchanged.`;
      },
    }),
  ];
}

export const workspaceSnapshot = (ctx: WorkspaceAgentContext) =>
  `Open file: "${ctx.title}" (${NAMES[ctx.kind]}). Save status: ${ctx.status}. To put a whole earlier version back, call list_versions, then restore_version with that version's author and time. Restoring keeps every other version in the history. To put one paragraph back and leave the rest of the document, call restore_paragraph with the version's name.`;
