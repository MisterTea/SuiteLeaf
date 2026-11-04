/** The same accept, expiry, and idle rules as the node's `decide_session`. */

export type SessionDecision = "accept" | "expired" | "idle" | "reauth";

/** Why a local session clock ended. Idle is not the same as an expired token. */
export function sessionEndFor(decision: SessionDecision): "expired" | "idle" | null {
  if (decision === "accept") return null;
  if (decision === "idle") return "idle";
  return "expired";
}

export function decideClientSession(input: {
  expiresAt?: string;
  updatedAt?: string;
  now: string;
  idleSecs?: number;
  reauth?: boolean;
}): SessionDecision {
  if (input.reauth) return "reauth";
  if (
    input.expiresAt !== undefined &&
    (input.expiresAt === "" || parseIsoMs(input.expiresAt) === undefined || input.expiresAt <= input.now)
  ) {
    return "expired";
  }
  if (input.idleSecs === undefined || input.updatedAt === undefined) return "accept";
  const updated = parseIsoMs(input.updatedAt);
  const now = parseIsoMs(input.now);
  if (updated === undefined || now === undefined) return "idle";
  if (now - updated >= input.idleSecs * 1000) return "idle";
  return "accept";
}

/** A session-list sentence. The times themselves are not included. */
export function sessionActivityNote(input: {
  expiresAt?: string;
  updatedAt?: string;
  now: string;
  idleSecs?: number;
  reauth?: boolean;
}): string {
  const decision = decideClientSession(input);
  if (decision === "reauth") return "This device must sign in again.";
  if (decision === "expired") return "This session has expired.";
  if (decision === "idle") return "This device is idle.";
  if (input.idleSecs === undefined) return "No idle limit is set.";
  return "This device is signed in.";
}

/** Times from a sign-in payload. Absent fields stay absent. */
export function sessionTimes(data: unknown): { expiresAt?: string; updatedAt?: string } {
  if (!data || typeof data !== "object" || !("session" in data)) return {};
  const session = (data as { session?: unknown }).session;
  if (!session || typeof session !== "object") return {};
  const row = session as { expiresAt?: unknown; updatedAt?: unknown };
  return { expiresAt: isoTime(row.expiresAt), updatedAt: isoTime(row.updatedAt) };
}

/** The auth client turns ISO strings into Dates; the session stores strings. */
function isoTime(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return undefined;
}

/** Whole seconds from `/api/node/info`, or undefined when the node has no idle limit. */
export function idleSecsFromInfo(info: unknown): number | undefined {
  if (!info || typeof info !== "object" || !("auth" in info)) return;
  const auth = (info as { auth?: unknown }).auth;
  if (!auth || typeof auth !== "object" || !("idleSecs" in auth)) return;
  const idle = (auth as { idleSecs?: unknown }).idleSecs;
  if (typeof idle !== "number" || !Number.isInteger(idle) || idle < 0) return;
  return idle;
}

function parseIsoMs(value: string): number | undefined {
  if (value.length !== 24 || value[10] !== "T" || value[23] !== "Z") return;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  const millis = Number(value.slice(20, 23));
  if (![year, month, day, hour, minute, second, millis].every(Number.isInteger)) return;
  if (month < 1 || month > 12 || !validDay(year, month, day)) return;
  if (hour > 23 || minute > 59 || second > 59) return;
  const days = daysFromCivil(year, month, day);
  if (days === undefined) return;
  return days * 86_400_000 + (hour * 3600 + minute * 60 + second) * 1000 + millis;
}

function validDay(year: number, month: number, day: number): boolean {
  const lengths = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const leap = month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const max = leap ? 29 : lengths[month]!;
  return day >= 1 && day <= max;
}

function daysFromCivil(year: number, month: number, day: number): number | undefined {
  if (year < 1970) return;
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}
