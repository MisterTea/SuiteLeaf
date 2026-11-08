import type { Summary } from "./client";
/** Only use provider thread identifiers; matching subjects alone can merge unrelated mail. */
export function groupMailRows(
  messages: Summary[],
  enabled: boolean,
): (Summary & { uids: number[] })[] {
  const groups = new Map<string, Summary & { uids: number[] }>();
  for (const message of messages) {
    const key =
      enabled && message.threadId
        ? `thread:${message.threadId}`
        : `uid:${message.uid}`;
    const group = groups.get(key);
    if (group) {
      group.uids.push(message.uid);
      if (!message.flags.includes("\\Seen"))
        group.flags = group.flags.filter((f) => f !== "\\Seen");
    } else
      groups.set(key, {
        ...message,
        flags: [...message.flags],
        uids: [message.uid],
      });
  }
  return [...groups.values()];
}
