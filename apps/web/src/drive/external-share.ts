/** A grant the caller already loaded. Membership is whether that person is in this organization. */
export type ShareGrant = {
  principalId: string;
  principalName: string;
  member: boolean;
  itemName: string;
  /** When this access ends. A missing end date stays in the review. */
  expiresAt?: string;
};

export type ExternalShareReview = {
  count: number;
  names: string[];
  note: string;
};

function realInstant(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?Z$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function ended(expiresAt: string | undefined, now: string): boolean {
  const end = expiresAt?.trim() ?? "";
  const clock = now.trim();
  if (!realInstant(end) || !realInstant(clock)) return false;
  return end <= clock;
}

/**
 * People who still have access and are not members. A guest whose end date
 * has passed is left out. The note does not repeat ids, file names, or dates.
 * The list passed in is not changed.
 */
export function externalShareReview(grants: readonly ShareGrant[], now = ""): ExternalShareReview {
  const outside = grants.filter((grant) => !grant.member && !ended(grant.expiresAt, now));
  const names = outside
    .map((grant) => grant.principalName.trim())
    .filter((name) => name.length > 0)
    .slice(0, 20);
  return {
    count: outside.length,
    names,
    note: outside.length
      ? "People outside this organization still have access."
      : "No one outside this organization has access.",
  };
}
