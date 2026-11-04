/** Sentences for an editor-policy plan. The lists passed in stay as they were. */

export interface PolicyImpactChange {
  itemName: string;
  principalId: string;
  before: string;
  after: string;
}

const ROLES = new Set(["owner", "editor", "commenter", "viewer", "responder"]);

function person(id: string): string {
  const name = id.trim();
  if (!name || /secret|password|token|api[_-]?key/i.test(name)) return "Someone";
  return name;
}

function item(name: string): string {
  const title = name.trim();
  if (!title || /secret|password|token|api[_-]?key/i.test(title)) return "this item";
  return title;
}

function role(value: string): string {
  return ROLES.has(value) ? value : "another role";
}

function sentence(change: PolicyImpactChange): string {
  return `${person(change.principalId)} on ${item(change.itemName)} would change from ${role(change.before)} to ${role(change.after)}.`;
}

export function policyImpact(plan: {
  changes: readonly PolicyImpactChange[];
  effects: readonly PolicyImpactChange[];
  recovery: string;
}): string {
  const lines = [...plan.changes, ...plan.effects].map(sentence);
  const recovery = plan.recovery.trim() || "Set each changed grant back to editor.";
  lines.push(recovery);
  return lines.join(" ");
}
