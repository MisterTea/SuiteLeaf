/** Why the signed-in person can open one item. Other people's grants are absent. */
export type AccessExplanation = {
  role: string | null;
  reason:
    | { kind: "admin" }
    | { kind: "owner"; itemId: string; itemName: string }
    | {
        kind: "grant";
        principalType: string;
        principalId: string;
        itemId: string;
        itemName: string;
        inherited: boolean;
      }
    | { kind: "expired"; principalType: string; principalId: string; itemId: string }
    | { kind: "restricted"; itemId: string; itemName: string }
    | { kind: "none" };
  folderChainTruncated: boolean;
  groupLoops: string[];
};

function accessLevel(role: string | null): string | null {
  if (role === "editor" || role === "owner") return `an ${role}`;
  if (role === "viewer" || role === "commenter" || role === "responder") return `a ${role}`;
  if (role) return "another role";
  return null;
}

/** A sentence for the share dialog. It does not repeat grant ids. */
export function accessExplanationText(explanation: AccessExplanation): string {
  const reason = explanation.reason;
  let sentence = "You do not have access.";
  const itemName = "itemName" in reason ? reason.itemName.trim() : "";
  if (reason.kind === "admin") sentence = "You can open this because you are an administrator.";
  else if (reason.kind === "owner") sentence = itemName ? `You own “${itemName}”.` : "You own this item.";
  else if (reason.kind === "grant" && reason.principalType === "group" && reason.inherited) {
    sentence = itemName
      ? `You have access from a group on “${itemName}”.`
      : "You have access from a group.";
  } else if (reason.kind === "grant" && reason.principalType === "group") {
    sentence = "You were given access through a group.";
  } else if (reason.kind === "grant" && reason.principalType === "org" && reason.inherited) {
    sentence = itemName
      ? `You have access from your organization on “${itemName}”.`
      : "You have access from your organization.";
  } else if (reason.kind === "grant" && reason.principalType === "org") {
    sentence = "You were given access through your organization.";
  } else if (reason.kind === "grant" && reason.inherited) {
    sentence = itemName ? `You have access from “${itemName}”.` : "You have access on this item.";
  } else if (reason.kind === "grant") sentence = "You were given access on this item.";
  else if (reason.kind === "expired") sentence = "Your access has expired.";
  else if (reason.kind === "restricted") {
    sentence = reason.itemName
      ? `“${reason.itemName}” is restricted. Access from a folder above it does not apply.`
      : "A folder above this item is restricted. Access from that folder does not apply.";
  }
  if (reason.kind === "grant") {
    const level = accessLevel(explanation.role);
    if (level) sentence = sentence.replace(/\.$/, ` as ${level}.`);
  }
  if (explanation.folderChainTruncated) {
    sentence += " The folder chain was too deep to finish.";
  }
  if (explanation.groupLoops.length > 0) {
    sentence += " A group membership cycle was found.";
  }
  return sentence;
}
