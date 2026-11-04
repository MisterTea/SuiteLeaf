import type { FileRecord, SuiteFile } from "@suiteleaf/core";
import { ToolError } from "../host";
import { moveCursor } from "../cursor";
import { NAMES, scrolledTo, wait, type Kind } from "./file-tool-kit";

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
export const ON_COMPUTER =
  "A file that is not listed here is on the user's computer (saved, downloaded or attached to an email): call open_from_computer, which asks them to pick it. Don't ask them first.";

export const describe = (r: FileRecord) => {
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

export function namesFrom(args: { name?: unknown; names?: unknown }) {
  return dedupe([...splitNames(args.names), ...splitNames(args.name)]);
}

export const joinTitles = (records: FileRecord[]) => records.map((r) => `"${r.file.title}"`).join(", ");

export function findRecord(records: FileRecord[], name: string, kind?: Kind) {
  const pool = kind ? records.filter((r) => r.file.kind === kind) : records;
  const n = name.trim().toLowerCase().replace(/\.(sldoc|slsheet|slslides|sldraw)$/, "");
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
export const listed = () =>
  [...document.querySelectorAll(".file-row")].map((el) => ({
    el,
    title: el.querySelector("a > span:last-child")?.firstChild?.textContent?.trim() ?? "",
    snippet: el.querySelector(".file-snippet")?.textContent?.trim(),
  }));

const row = (title: string) => listed().find((r) => r.title === title)?.el;

/** The file's row, clearing a search or type filter that hides it (as a person would). */
export async function revealRow(ctx: HomeAgentContext, name: string) {
  const record = findRecord(ctx.records, name);
  const { title } = record.file;
  if (!row(title)) {
    ctx.setQuery("");
    ctx.setFilter(record.trashedAt ? "trash" : "all");
    await wait(400);
  }
  return scrolledTo(row(title));
}

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
export async function emptyTrashForever(ctx: HomeAgentContext, targets: FileRecord[]) {
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
