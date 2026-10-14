/** How far apart two saves can be and still collapse into one history entry. */
export const AUTOSAVE_WINDOW_MS = 10 * 60 * 1000;
/** Local snapshots are coarser than the 500ms autosave, so a busy hour stays readable. */
export const LOCAL_SNAPSHOT_GAP_MS = 3 * 60 * 1000;

export interface HistoryVersion {
  id: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  name: string | null;
  restoredFrom: string | null;
  /** Sentence describing the checkpoint, when the file stored one. */
  summary?: string;
}

export interface HistoryGroup {
  version: HistoryVersion;
  /** Older saves hidden under this entry until it is expanded. */
  earlier: HistoryVersion[];
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function dayStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today 09:14", "Yesterday 18:02", or "11 Oct 18:02" in local time. */
export function versionWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

/** "12 Oct 09:14", used in copy names so they don't say "Today" tomorrow. */
export function versionStamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dayHeading(iso: string, now = new Date()): string {
  const when = versionWhen(iso, now);
  if (when.startsWith("Today")) return "Today";
  if (when.startsWith("Yesterday")) return "Yesterday";
  const d = new Date(iso);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function firstName(authorName: string) {
  return authorName.trim().split(/\s+/)[0] || "Someone";
}

/** "Watering rota (Sam's draft, 12 Oct 09:14).sldoc" */
export function copyFilename(
  title: string,
  authorName: string,
  iso: string,
  extension: string,
): string {
  const who = authorName === "You" ? "your" : `${firstName(authorName)}'s`;
  const suffix = ` (${who} draft, ${versionStamp(iso)}).${extension}`;
  const room = Math.max(1, 255 - suffix.length);
  const base = (title.trim() || "Untitled").slice(0, room);
  return `${base}${suffix}`;
}

export function copyTitle(filename: string) {
  return filename.replace(/\.[^.]+$/, "");
}

export function restoreHeading(
  source: HistoryVersion | undefined,
  authorName: string,
  now = new Date(),
): string {
  const label = source?.name
    ? `"${source.name}"`
    : source
      ? versionWhen(source.createdAt, now)
      : "an earlier version";
  return `Restored ${label} · ${authorName}`;
}

function collapsible(version: HistoryVersion) {
  return !version.name && !version.restoredFrom;
}

/**
 * Newest first. Consecutive unnamed saves by one person within 10 minutes
 * become one entry; the newest stays visible and the rest sit under it.
 * Named versions and restores always stay visible.
 */
export function groupVersions(versions: HistoryVersion[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  let i = 0;
  while (i < versions.length) {
    const version = versions[i];
    const earlier: HistoryVersion[] = [];
    let prev = version;
    let j = i + 1;
    if (collapsible(version)) {
      while (j < versions.length) {
        const next = versions[j];
        if (!collapsible(next) || next.authorId !== version.authorId) break;
        const gap = Date.parse(prev.createdAt) - Date.parse(next.createdAt);
        if (!Number.isFinite(gap) || gap < 0 || gap > AUTOSAVE_WINDOW_MS) break;
        earlier.push(next);
        prev = next;
        j++;
      }
    }
    groups.push({ version, earlier });
    i = j;
  }
  return groups;
}

export type ChangeUnit = "paragraph" | "cell" | "slide";

export function changeSentence(count: number, unit: ChangeUnit = "paragraph") {
  if (count === 0) return "Nothing will change";
  const noun = count === 1 ? unit : `${unit}s`;
  const verb = count === 1 ? "changes" : "change";
  return `${count} ${noun} ${verb}`;
}

/** History title for a restore that put one paragraph back. */
export function partialRestoreTitle(label: string) {
  const title = `Restored the ${label} paragraph`;
  return title.length <= 80 ? title : `${title.slice(0, 79)}…`;
}

/** Shown before the restore button, so the click that restores is the confirmation. */
export function restorePrompt(
  version: HistoryVersion,
  count: number,
  now = new Date(),
  unit: ChangeUnit = "paragraph",
) {
  const what = version.name
    ? `"${version.name}"`
    : `the version from ${versionWhen(version.createdAt, now)}`;
  return `Restore ${what}? ${changeSentence(count, unit)}. The current version stays in history.`;
}

export function shouldSnapshot(
  latest: { native: string; createdAt: string } | undefined,
  native: string,
  explicit: boolean,
  now = Date.now(),
) {
  if (latest?.native === native) return false;
  if (!latest || explicit) return true;
  return now - Date.parse(latest.createdAt) >= LOCAL_SNAPSHOT_GAP_MS;
}
