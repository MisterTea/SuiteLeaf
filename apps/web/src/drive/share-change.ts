const NAMED_ROLES = new Set(["viewer", "commenter", "responder", "editor", "owner"]);

function roleLabel(role: string | null): string | null {
  if (role == null) return null;
  return NAMED_ROLES.has(role) ? role : "another role";
}

function personName(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > 80) return "Someone";
  return trimmed;
}

/**
 * What a share change would do. The file is not shared.
 * A role that is not a SuiteLeaf role is called another role, and that word is not repeated.
 */
export function shareChangePreview(input: {
  name: string;
  fromRole: string | null;
  toRole: string | null;
}): { note: string; changes: boolean } {
  const name = personName(input.name);
  const from = roleLabel(input.fromRole);
  const to = roleLabel(input.toRole);
  if (from === to) {
    return { note: `This does not change ${name}'s access.`, changes: false };
  }
  if (!from && to) return { note: `${name} would gain ${to} access.`, changes: true };
  if (from && !to) return { note: `${name} would lose access.`, changes: true };
  return { note: `${name} would change from ${from} to ${to}.`, changes: true };
}
