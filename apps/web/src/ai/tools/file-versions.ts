import { parseFile } from "@suiteleaf/core";
import { versionWhen } from "../../editors/version-history-model";
import { ToolError } from "../host";

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
