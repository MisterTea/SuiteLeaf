import type { MailStore } from "./store";
import type { MailRule } from "./preferences";
import { authorizedAccount } from "./google";
import { mailSearch, withMailbox } from "./service";
interface Checkpoint {
  uidValidity: string;
  lastUid: number;
  syncedAt: string;
  error?: string;
}
/** Polls new inbox UIDs independently of open browsers. Each account has one owning node. */
export async function syncMailAccounts(store: MailStore, owner: string) {
  for (const row of await store.workerAccounts(owner)) {
    try {
      if (!(await store.ownerActive(row.userId))) continue;
      const account = await authorizedAccount(store, row.userId, row.account);
      const previous = await store.record<Checkpoint>(
        row.userId,
        account.id,
        "sync",
        "inbox",
      );
      const rules = (
        await store.records<MailRule>(row.userId, account.id, "rule")
      )
        .map((r) => r.payload)
        .filter((r) => r.enabled);
      await withMailbox(account, async (client) => {
        const lock = await client.getMailboxLock("INBOX");
        try {
          if (!client.mailbox) throw new Error("No inbox");
          const uidValidity = String(client.mailbox.uidValidity);
          const lastUid = (client.mailbox.uidNext || 1) - 1;
          const checkpoint = previous?.payload;
          if (
            checkpoint?.uidValidity === uidValidity &&
            lastUid > checkpoint.lastUid
          ) {
            const ids = (
              (await client.search(
                { uid: `${checkpoint.lastUid + 1}:*` },
                { uid: true },
              )) || []
            ).filter((uid) => uid > checkpoint.lastUid);
            for (const rule of rules) {
              if (!ids.length) break;
              const matches = await client.search(
                {
                  ...(client.capabilities.has("X-GM-EXT-1")
                    ? { gmraw: rule.query }
                    : mailSearch(rule.query)),
                  uid: ids.join(","),
                },
                { uid: true },
              );
              if (!matches || !matches.length) continue;
              if (rule.markRead)
                await client.messageFlagsAdd(matches, ["\\Seen"], {
                  uid: true,
                });
              if (rule.star)
                await client.messageFlagsAdd(matches, ["\\Flagged"], {
                  uid: true,
                });
              if (rule.moveTo && rule.moveTo !== "INBOX") {
                if (
                  !(await client.list()).some(
                    (folder) => folder.path === rule.moveTo,
                  )
                )
                  await client.mailboxCreate(rule.moveTo);
                await client.messageMove(matches, rule.moveTo, { uid: true });
                for (const uid of matches) {
                  const i = ids.indexOf(uid);
                  if (i >= 0) ids.splice(i, 1);
                }
              }
            }
          }
          await store.saveRecord(row.userId, account.id, "sync", "inbox", {
            uidValidity,
            lastUid,
            syncedAt: new Date().toISOString(),
          });
        } finally {
          lock.release();
        }
      });
    } catch {
      // Retain the cursor so errors never skip new UIDs. Expose health to the settings UI.
      const previous = await store.record<Checkpoint>(
        row.userId,
        row.account.id,
        "sync",
        "inbox",
      );
      await store.saveRecord(row.userId, row.account.id, "sync", "inbox", {
        ...(previous?.payload || { uidValidity: "", lastUid: 0, syncedAt: "" }),
        error:
          "Background sync failed. Check credentials and provider availability.",
      });
    }
  }
}
