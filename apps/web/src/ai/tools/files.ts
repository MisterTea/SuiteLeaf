import { Type } from "@earendil-works/pi-ai";
import type { FileRecord } from "@suiteleaf/core";
import { ToolError, currentSuiteTools, tool, waitForHost, type SuiteTool } from "../host";
import { requestFile } from "../file-request";
import { moveCursor } from "../cursor";
import { requestApproval } from "../guard";
import { KINDS, REMOVE_INTENT, kindParam, opened, safe, scrolledTo, wait, type Kind } from "./file-tool-kit";
import { IMPORT_ACCEPT, answerImportPreview } from "./file-import";
import {
  ON_COMPUTER,
  describe,
  emptyTrashForever,
  findRecord,
  joinTitles,
  listed,
  namesFrom,
  revealRow,
  type HomeAgentContext,
} from "./file-library";
import { templateTools } from "./file-template-tools";

export { REMOVE_INTENT } from "./file-tool-kit";
export { IMPORT_ACCEPT } from "./file-import";
export { findRecord, type HomeAgentContext } from "./file-library";
export { formatVersionList, pickVersion, versionPreview, type ListedVersion, type VersionActions } from "./file-versions";
export { workspaceSnapshot, workspaceTools, type WorkspaceAgentContext } from "./file-workspace-tools";

const SHOW = {
  all: "all",
  documents: "doc",
  spreadsheets: "sheet",
  presentations: "slide",
  starred: "starred",
  trash: "trash",
} as const;

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
        [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Open / import")) ??
        [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Import")),
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
      target: () =>
        [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Open / import")) ??
        [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Import")),
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
