import { cloneJson, sameJson } from "./json-data";

/** How long a writer can be idle before a solo version is sealed, or a
 * multiuser presence is dropped. Tests override this with
 * `localStorage["suiteleaf.versionPauseMs"]`. */
export const VERSION_PAUSE_MS = 15 * 60 * 1000;
export const VERSION_PAUSE_KEY = "suiteleaf.versionPauseMs";
/** Full snapshots kept in the file. Named versions outlast unnamed ones. */
export const VERSION_SNAPSHOT_CAP = 50;
/** An edit op larger than this is stored as a marker, not the payload. */
export const OP_BYTE_CAP = 32 * 1024;

export type FileKind = "doc" | "sheet" | "slide" | "form" | "drawing";
export type Collaborator = { id: string; name: string };
export type RegionUnit = "paragraph" | "cell" | "slide" | "comment";

export type StoredEdit = {
  id: string;
  at: string;
  by: Collaborator;
  op: unknown;
};

export type StoredVersion = {
  id: string;
  at: string;
  by: Collaborator;
  summary: string;
  label?: string;
  title: string;
  throughEdit: string;
  content: unknown;
};

export type TrackedFile = {
  kind: FileKind;
  title: string;
  content: unknown;
  updatedAt: string;
  edits?: StoredEdit[];
  versions?: StoredVersion[];
};

export type VersionSnapshot = { title: string; content: unknown };

type IdSource = { edit?: () => string; version?: () => string };

export function versionPauseMs(
  storage?: { getItem(key: string): string | null } | null,
): number {
  const raw = storage?.getItem(VERSION_PAUSE_KEY);
  if (raw == null || raw.trim() === "") return VERSION_PAUSE_MS;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : VERSION_PAUSE_MS;
}

function ids(source?: IdSource) {
  return {
    edit: source?.edit ?? (() => crypto.randomUUID()),
    version: source?.version ?? (() => crypto.randomUUID()),
  };
}

const clone = cloneJson;

export function snapshotsEqual(a: VersionSnapshot, b: VersionSnapshot): boolean {
  return a.title === b.title && sameJson(a.content, b.content);
}

function boundOp(op: unknown): unknown {
  let encoded = "";
  try {
    encoded = JSON.stringify(op);
  } catch {
    return { kind: "doc", truncated: true };
  }
  if (encoded.length <= OP_BYTE_CAP) return op;
  const kind =
    op && typeof op === "object" && "kind" in op && typeof op.kind === "string"
      ? op.kind
      : "doc";
  return { kind, truncated: true };
}

function lastEdit(file: TrackedFile): StoredEdit | undefined {
  return file.edits?.at(-1);
}

function lastVersion(file: TrackedFile): StoredVersion | undefined {
  return file.versions?.at(-1);
}

function covered(file: TrackedFile): boolean {
  const edit = lastEdit(file);
  const version = lastVersion(file);
  if (!edit || !version || version.throughEdit !== edit.id) return false;
  return snapshotsEqual(version, file);
}

function blankContent(kind: FileKind): unknown {
  if (kind === "doc") return { type: "doc", content: [{ type: "paragraph" }] };
  if (kind === "sheet")
    return { workbook: { id: "", sheetOrder: ["s"], sheets: { s: { id: "s", name: "Sheet", rowCount: 1, columnCount: 1, cellData: {} } } }, charts: [], pivots: [] };
  if (kind === "form") return { questions: [], responses: [] };
  if (kind === "drawing") return { format: "svg", source: "" };
  return { id: "", width: 1, height: 1, slideOrder: ["s"], slides: { s: { id: "s", elements: [] } } };
}

function beforeSnapshot(file: TrackedFile): VersionSnapshot {
  const previous = lastVersion(file);
  if (previous) return { title: previous.title, content: previous.content };
  return { title: file.title, content: blankContent(file.kind) };
}

function isLabeled(version: StoredVersion): boolean {
  return typeof version.label === "string" && version.label.length > 0;
}

export function trimVersions(versions: StoredVersion[]): StoredVersion[] {
  const next = versions.slice();
  const drop = (labeled: boolean) => {
    const index = next.findIndex((version) => isLabeled(version) === labeled);
    if (index >= 0) next.splice(index, 1);
  };
  while (next.length > VERSION_SNAPSHOT_CAP && next.some((version) => !isLabeled(version)))
    drop(false);
  while (next.length > VERSION_SNAPSHOT_CAP) drop(true);
  return next;
}

function withVersion<T extends TrackedFile>(
  file: T,
  version: StoredVersion,
): T {
  return {
    ...file,
    versions: trimVersions([...(file.versions ?? []), version]),
  };
}

/**
 * Seal the current head when the last edit is already older than `pause`.
 * `force` seals even inside the window, which is how a restore keeps the
 * document you were just looking at.
 */
export function sealIfIdle<T extends TrackedFile>(
  file: T,
  now = Date.now(),
  pause = VERSION_PAUSE_MS,
  source?: IdSource,
  force = false,
): { file: T; sealed: StoredVersion | null } {
  const edit = lastEdit(file);
  if (!edit || covered(file)) return { file, sealed: null };
  const idle = now - Date.parse(edit.at);
  if (!force && (!Number.isFinite(idle) || idle < pause)) return { file, sealed: null };
  const make = ids(source);
  const sealed: StoredVersion = {
    id: make.version(),
    at: edit.at,
    by: edit.by,
    summary: summarizeChange(file.kind, beforeSnapshot(file), file),
    title: file.title,
    throughEdit: edit.id,
    content: clone(file.content),
  };
  return { file: withVersion(file, sealed), sealed };
}

export function recordEdit<T extends TrackedFile>(
  file: T,
  change: {
    content: unknown;
    title?: string;
    op: unknown;
    by: Collaborator;
    at?: string;
    now?: number;
    pauseMs?: number;
  },
  source?: IdSource,
): { file: T; sealed: StoredVersion | null } {
  const now = change.now ?? (Date.parse(change.at ?? "") || Date.now());
  const at = change.at ?? new Date(now).toISOString();
  const pause = change.pauseMs ?? VERSION_PAUSE_MS;
  const idle = sealIfIdle(file, now, pause, source);
  const title = change.title ?? idle.file.title;
  const same =
    idle.file.title === title &&
    sameJson(idle.file.content, change.content);
  if (same) return idle;
  const make = ids(source);
  const edit: StoredEdit = {
    id: make.edit(),
    at,
    by: change.by,
    op: boundOp(change.op),
  };
  return {
    file: {
      ...idle.file,
      title,
      content: clone(change.content),
      updatedAt: at,
      edits: [...(idle.file.edits ?? []), edit],
    },
    sealed: idle.sealed,
  };
}

/** Put `versionId` back on the head. The document you leave stays restorable. */
export function restoreToVersion<T extends TrackedFile>(
  file: T,
  versionId: string,
  by: Collaborator,
  at = new Date().toISOString(),
  source?: IdSource,
): { file: T; sealed: StoredVersion | null } {
  const version = file.versions?.find((item) => item.id === versionId);
  if (!version) throw new Error("That version is not in this file.");
  const kept = sealIfIdle(file, Date.parse(at), 0, source, true);
  const make = ids(source);
  const edit: StoredEdit = {
    id: make.edit(),
    at,
    by,
    op: { kind: "restore", versionId },
  };
  return {
    file: {
      ...kept.file,
      title: version.title,
      content: clone(version.content),
      updatedAt: at,
      edits: [...(kept.file.edits ?? []), edit],
    },
    sealed: kept.sealed,
  };
}

export function nameVersion<T extends TrackedFile>(
  file: T,
  versionId: string,
  label: string,
): T {
  const trimmed = label.trim().slice(0, 80);
  return {
    ...file,
    versions: (file.versions ?? []).map((version) => {
      if (version.id !== versionId) return version;
      if (!trimmed) {
        const copy = { ...version };
        delete copy.label;
        return copy;
      }
      return { ...version, label: trimmed };
    }),
  };
}

type TextNode = { type?: string; text?: string; content?: TextNode[] };

function plain(node: TextNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(plain).join("");
}

export function blockTexts(content: unknown): string[] {
  const found: string[] = [];
  const walk = (node: TextNode) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "paragraph" || node.type === "heading") {
      const text = plain(node).replace(/\s+/g, " ").trim();
      if (text) found.push(text);
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(content as TextNode);
  return found;
}

function clamp(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 200) return clean || "Edited a paragraph";
  return `${clean.slice(0, 199).trimEnd()}…`;
}

function renamedTo(title: string): string {
  const full = `Renamed to "${title}"`;
  if (full.length <= 200) return full;
  const room = 200 - `Renamed to ""`.length;
  return `Renamed to "${title.slice(0, Math.max(0, room))}"`;
}

function joinClauses(title: string | null, body: string | null, fallback: string): string {
  if (title && body) {
    const rest = body.charAt(0).toLowerCase() + body.slice(1);
    return clamp(`${title} and ${rest}`);
  }
  return clamp(title ?? body ?? fallback);
}

function docBody(before: unknown, after: unknown): string | null {
  const previous = blockTexts(before);
  const next = blockTexts(after);
  const sameText =
    previous.length === next.length && previous.every((text, index) => text === next[index]);
  if (sameText)
    return JSON.stringify(before) === JSON.stringify(after) ? null : "Edited a paragraph";
  const previousSet = new Map<string, number>();
  for (const text of previous) previousSet.set(text, (previousSet.get(text) ?? 0) + 1);
  let added = 0;
  let removed = 0;
  for (const text of next) {
    const count = previousSet.get(text) ?? 0;
    if (count > 0) previousSet.set(text, count - 1);
    else added += 1;
  }
  for (const count of previousSet.values()) removed += count;
  if (added > 0 && removed === 0)
    return added === 1 ? "Added a paragraph" : `Added ${added} paragraphs`;
  if (removed > 0 && added === 0)
    return removed === 1 ? "Removed a paragraph" : `Removed ${removed} paragraphs`;
  return "Edited a paragraph";
}

function cellEntries(content: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const sheets = (
    content as {
      workbook?: { sheets?: Record<string, { cellData?: Record<string, Record<string, unknown>> }> };
    }
  )?.workbook?.sheets;
  if (!sheets) return map;
  for (const [sheetId, sheet] of Object.entries(sheets)) {
    for (const [row, cols] of Object.entries(sheet?.cellData ?? {})) {
      if (!cols) continue;
      for (const [col, cell] of Object.entries(cols)) {
        if (cell == null) continue;
        map.set(`${sheetId}:${row}:${col}`, JSON.stringify(cell));
      }
    }
  }
  return map;
}

function sheetBody(before: unknown, after: unknown): string | null {
  const left = cellEntries(before);
  const right = cellEntries(after);
  let changed = 0;
  for (const key of new Set([...left.keys(), ...right.keys()]))
    if (left.get(key) !== right.get(key)) changed += 1;
  if (changed === 1) return "Changed 1 cell";
  if (changed > 1) return `Changed ${changed} cells`;
  if (JSON.stringify(before) !== JSON.stringify(after)) return "Edited the spreadsheet";
  return null;
}

type Deck = { slideOrder?: string[]; slides?: Record<string, unknown> };

export function slideOp(before: unknown, after: unknown): {
  kind: "slide";
  added: string[];
  removed: string[];
  edited: string[];
} {
  const left = (before ?? {}) as Deck;
  const right = (after ?? {}) as Deck;
  const orderA = left.slideOrder ?? [];
  const orderB = right.slideOrder ?? [];
  const setA = new Set(orderA);
  const setB = new Set(orderB);
  return {
    kind: "slide",
    added: orderB.filter((id) => !setA.has(id)),
    removed: orderA.filter((id) => !setB.has(id)),
    edited: orderB.filter(
      (id) => setA.has(id) && JSON.stringify(left.slides?.[id]) !== JSON.stringify(right.slides?.[id]),
    ),
  };
}

function slideBody(before: unknown, after: unknown): string | null {
  const { added, removed, edited } = slideOp(before, after);
  if (added.length > 0 && removed.length === 0 && edited.length === 0)
    return added.length === 1 ? "Added a slide" : `Added ${added.length} slides`;
  if (removed.length > 0 && added.length === 0 && edited.length === 0)
    return removed.length === 1 ? "Removed a slide" : `Removed ${removed.length} slides`;
  if (edited.length > 0 && added.length === 0 && removed.length === 0)
    return edited.length === 1 ? "Edited a slide" : `Edited ${edited.length} slides`;
  if (added.length === 0 && removed.length === 0 && edited.length === 0)
    return JSON.stringify(before) === JSON.stringify(after) ? null : "Edited the presentation";
  return "Edited a slide";
}

/** A short sentence describing how `after` differs from `before`. */
export function summarizeChange(
  kind: FileKind,
  before: VersionSnapshot,
  after: VersionSnapshot,
): string {
  const title = before.title !== after.title ? renamedTo(after.title) : null;
  const body =
    kind === "sheet"
      ? sheetBody(before.content, after.content)
      : kind === "slide"
        ? slideBody(before.content, after.content)
        : kind === "form"
          ? formBody(before.content, after.content)
          : kind === "drawing"
            ? drawingBody(before.content, after.content)
            : docBody(before.content, after.content);
  const fallback =
    kind === "sheet"
      ? "Edited the spreadsheet"
      : kind === "slide"
        ? "Edited the presentation"
        : kind === "form"
          ? "Edited the form"
          : kind === "drawing"
            ? "Edited the drawing"
            : "Edited a paragraph";
  return joinClauses(title, body, fallback);
}

function formBody(before: unknown, after: unknown): string | null {
  return JSON.stringify(before) === JSON.stringify(after) ? null : "Edited the form";
}

function drawingSource(content: unknown): string {
  return (content as { source?: string } | null)?.source ?? "";
}

function changedDrawingLines(before: unknown, after: unknown): number[] {
  const from = drawingSource(before).split("\n");
  const to = drawingSource(after).split("\n");
  const lines: number[] = [];
  for (let line = 0; line < Math.max(from.length, to.length); line += 1)
    if (from[line] !== to[line]) lines.push(line);
  return lines;
}

function drawingBody(before: unknown, after: unknown): string | null {
  const changed = changedDrawingLines(before, after).length;
  if (!changed) return null;
  return changed === 1 ? "Edited a line of the drawing" : `Edited ${changed} lines of the drawing`;
}

function excerptOf(kind: FileKind, content: unknown): string {
  if (kind === "drawing") return drawingSource(content);
  if (kind === "form") {
    const questions = (content as { questions?: { prompt?: string }[] } | null)?.questions ?? [];
    return questions.map((question) => question.prompt ?? "").join("\n");
  }
  if (kind === "doc") return blockTexts(content).join("\n");
  if (kind === "sheet") {
    return [...cellEntries(content).entries()]
      .slice(0, 40)
      .map(([key, value]) => `${key} ${value}`)
      .join("\n");
  }
  const deck = (content ?? {}) as Deck;
  return (deck.slideOrder ?? [])
    .map((id) => {
      const notes = (deck.slides?.[id] as { notes?: string } | undefined)?.notes ?? "";
      return `${id} ${notes}`.trim();
    })
    .join("\n");
}

function capExcerpt(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= 1500 ? clean : `${clean.slice(0, 1499).trimEnd()}…`;
}

export function changeExcerpt(
  kind: FileKind,
  before: VersionSnapshot,
  after: VersionSnapshot,
): { before: string; after: string } {
  return {
    before: capExcerpt(excerptOf(kind, before.content)),
    after: capExcerpt(excerptOf(kind, after.content)),
  };
}

/** FrogNano prompt with thinking already closed, matching `enable_thinking: false`. */
export function summaryPrompt(kind: FileKind, before: string, after: string): string {
  const label =
    kind === "sheet"
      ? "spreadsheet"
      : kind === "slide"
        ? "presentation"
        : kind === "form"
          ? "form"
          : kind === "drawing"
            ? "drawing"
            : "document";
  return [
    "<|im_start|>system\n",
    "You describe what changed in one short sentence a person can scan. No list and no preamble.\n",
    "<|im_end|>\n",
    "<|im_start|>user\n",
    `This is a ${label}.\nBefore:\n${before}\nAfter:\n${after}\n`,
    "<|im_end|>\n",
    "<|im_start|>assistant\n<think>\n\n</think>\n\n",
  ].join("");
}

export type RegionTouch = {
  by: Collaborator;
  at: string;
  unit: RegionUnit;
  key: string;
};

export type RegionChange = { unit: RegionUnit; key: string };

export function changedRegions(kind: FileKind, before: unknown, after: unknown): RegionChange[] {
  if (kind === "form")
    return JSON.stringify(before) === JSON.stringify(after)
      ? []
      : [{ unit: "paragraph", key: "0" }];
  if (kind === "drawing")
    return changedDrawingLines(before, after).map((line) => ({ unit: "paragraph", key: String(line) }));
  if (kind === "sheet") {
    const left = cellEntries(before);
    const right = cellEntries(after);
    const keys = [...new Set([...left.keys(), ...right.keys()])].filter(
      (key) => left.get(key) !== right.get(key),
    );
    return keys.map((key) => ({ unit: "cell", key }));
  }
  if (kind === "slide") {
    const op = slideOp(before, after);
    return [
      ...op.added.map((key) => ({ unit: "slide" as const, key })),
      ...op.removed.map((key) => ({ unit: "slide" as const, key })),
      ...op.edited.map((key) => ({ unit: "slide" as const, key })),
    ];
  }
  const previous = blockTexts(before);
  const next = blockTexts(after);
  const count = Math.max(previous.length, next.length);
  const regions: RegionChange[] = [];
  for (let index = 0; index < count; index += 1)
    if (previous[index] !== next[index])
      regions.push({ unit: "paragraph", key: String(index) });
  return regions;
}

/**
 * Turn a multiuser CRDT session into one edit per person per changed region,
 * plus one version of the merged document.
 */
export function compactSession<T extends TrackedFile>(
  file: T,
  finalContent: unknown,
  finalTitle: string,
  touches: RegionTouch[],
  at: string,
  source?: IdSource,
): { file: T; version: StoredVersion | null } {
  const before = { title: file.title, content: file.content };
  const after = { title: finalTitle, content: finalContent };
  const regions = changedRegions(file.kind, before.content, after.content);
  const make = ids(source);
  const grouped = new Map<string, RegionTouch>();
  for (const touch of touches) {
    if (touch.unit === "comment") continue;
    const bucket = `${touch.by.id}:${touch.unit}:${touch.key}`;
    const existing = grouped.get(bucket);
    if (!existing || existing.at < touch.at) grouped.set(bucket, touch);
  }
  const edits: StoredEdit[] = [];
  const attributed = new Set<string>();
  for (const region of regions) {
    const matches = [...grouped.values()].filter(
      (touch) => touch.unit === region.unit && touch.key === region.key,
    );
    const authors = matches.length > 0 ? matches : [];
    if (authors.length === 0) {
      const fallback = touches.at(-1);
      if (!fallback) continue;
      edits.push({
        id: make.edit(),
        at: fallback.at,
        by: fallback.by,
        op: { kind: "region", unit: region.unit, key: region.key },
      });
      continue;
    }
    for (const touch of authors) {
      const mark = `${touch.by.id}:${region.unit}:${region.key}`;
      if (attributed.has(mark)) continue;
      attributed.add(mark);
      edits.push({
        id: make.edit(),
        at: touch.at,
        by: touch.by,
        op: { kind: "region", unit: region.unit, key: region.key },
      });
    }
  }
  if (edits.length === 0) {
    if (snapshotsEqual(before, after)) return { file, version: null };
    const by = touches.at(-1)?.by ?? { id: "local", name: "You" };
    edits.push({
      id: make.edit(),
      at,
      by,
      op: {
        kind: "region",
        unit: file.kind === "sheet" ? "cell" : file.kind === "slide" ? "slide" : "paragraph",
        key: "0",
      },
    });
  }
  const through = edits.at(-1)!;
  const version: StoredVersion = {
    id: make.version(),
    at,
    by: through.by,
    summary: summarizeChange(file.kind, before, after),
    title: finalTitle,
    throughEdit: through.id,
    content: clone(finalContent),
  };
  return {
    file: withVersion(
      {
        ...file,
        title: finalTitle,
        content: clone(finalContent),
        updatedAt: at,
        edits: [...(file.edits ?? []), ...edits],
      },
      version,
    ),
    version,
  };
}

function isTextBlock(node: TextNode): boolean {
  return node.type === "paragraph" || node.type === "heading";
}

/** Apply merged paragraph texts onto a document snapshot.
 * Empty blocks are skipped, matching {@link blockTexts}, so a blank line
 * between paragraphs does not shift the restored text. Extra texts become
 * new paragraphs. Missing texts clear the blocks they used to fill. */
export function applyParagraphTexts(content: unknown, texts: string[]): unknown {
  const copy = clone(content) as TextNode;
  if (!copy || typeof copy !== "object") return content;
  let index = 0;
  const walk = (node: TextNode) => {
    if (!isTextBlock(node)) {
      for (const child of node.content ?? []) walk(child);
      return;
    }
    const filled = plain(node).replace(/\s+/g, " ").trim();
    if (!filled) return;
    const next = texts[index];
    index += 1;
    node.content = next ? [{ type: "text", text: next }] : [];
  };
  walk(copy);
  if (copy.type === "doc" && index < texts.length) {
    copy.content = copy.content ?? [];
    for (; index < texts.length; index += 1) {
      const text = texts[index];
      copy.content.push(
        text
          ? { type: "paragraph", content: [{ type: "text", text }] }
          : { type: "paragraph" },
      );
    }
  }
  return copy;
}
