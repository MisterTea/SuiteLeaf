/** Who sees Admin, and how a person's trail is shown. */

export function isAdminRole(role: string | null | undefined): boolean {
  return (role ?? "")
    .split(",")
    .some((part) => part.trim() === "admin");
}

export function adminDestination(
  cluster: boolean,
  role: string | null | undefined,
): "home" | "denied" | "admin" {
  if (!cluster) return "home";
  if (!isAdminRole(role)) return "denied";
  return "admin";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export interface SignInRow {
  id: string;
  at: string;
  detail: string;
}

export function signInRows(
  sessions: {
    id: string;
    at: string | null;
    ipAddress: string | null;
    userAgent: string | null;
  }[],
  audits: { id: string; at: string; targetId: string; name: string }[],
): SignInRow[] {
  const covered = new Set(audits.map((event) => event.targetId));
  const fromAudit = audits.map((event) => ({
    id: event.id,
    at: event.at,
    detail: event.name,
  }));
  const fromSession = sessions
    .filter((session) => !covered.has(session.id))
    .map((session) => ({
      id: session.id,
      at: session.at ?? "",
      detail: [session.ipAddress, session.userAgent].filter(Boolean).join(" · "),
    }));
  return [...fromAudit, ...fromSession].sort((a, b) => b.at.localeCompare(a.at));
}

export function documentLabel(action: string, name: string): string {
  return `${action === "open" ? "Opened" : "Edited"} ${name}`;
}
