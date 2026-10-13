import {
  choicesFromAccounts,
  choicesFromNames,
  type MentionChoice,
  type MentionReader,
} from "@suiteleaf/core/doc-comments";
import { knownNames, localName } from "../identity";
import { drive, getSession } from "../node-client";

/** Who is opening the file: the signed-in account, or the name stored on this computer. */
export function mentionReader(): MentionReader {
  const user = getSession()?.user;
  if (user) {
    return {
      name: (user.name || user.username || "").trim(),
      email: user.email?.trim() || undefined,
      accountId: user.id,
    };
  }
  return { name: localName() };
}

/**
 * Suggestions for @ in a comment.
 * On this computer they are names already stored here.
 * Signed in, they are accounts (name and email). A name with no account is still offered.
 * Neither path sends mail.
 */
export async function loadMentionChoices(query: string): Promise<MentionChoice[]> {
  const text = query.trim();
  if (text.length < 2) return [];
  if (getSession()) {
    try {
      return choicesFromAccounts(text, await drive.accounts(text));
    } catch {
      return choicesFromNames(text, knownNames());
    }
  }
  return choicesFromNames(text, knownNames());
}
