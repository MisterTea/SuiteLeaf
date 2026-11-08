import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { MailStore } from "./store";
import { publicAccount, validateAccount } from "./types";
import { mailCommand } from "./service";
import { jobCommand } from "./jobs";
import { authorizedAccount, beginGoogle, googleCommand } from "./google";
import { preferenceCommand } from "./preferences";
import { confidentialCommand } from "./confidential";

const active = new Map<string, number>();
const actions = new Set([
  "test",
  "folders",
  "createFolder",
  "renameFolder",
  "deleteFolder",
  "send",
  "draft",
  "list",
  "read",
  "attachment",
  "flags",
  "move",
  "copy",
  "delete",
  "labels",
  "conversation",
  "original",
]);
export async function mailRequest(
  req: IncomingMessage,
  res: ServerResponse,
  user: string | undefined,
  store: MailStore,
) {
  const reply = (status: number, value: unknown) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  if (!user) return reply(401, { error: "Sign in to use mail." });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  if (
    !req.headers.authorization?.startsWith("Bearer ") ||
    !req.headers["content-type"]?.startsWith("application/json")
  )
    return reply(403, {
      error: "Mail requires a bearer session and JSON request.",
    });
  if ((active.get(user) ?? 0) >= 4)
    return reply(429, { error: "Too many mail requests. Try again shortly." });
  active.set(user, (active.get(user) ?? 0) + 1);
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32_000_000)
        return reply(413, { error: "Mail request exceeds 32 MB." });
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.action === "accounts")
      return reply(200, (await store.list(user)).map(publicAccount));
    if (body.action === "googleConnect")
      return reply(200, await beginGoogle(store, user, body.services === true));
    if (body.action === "saveAccount") {
      const candidate = body.account;
      if (!candidate || typeof candidate !== "object")
        throw new Error("Invalid account.");
      if (candidate.id) {
        const old = await authorizedAccount(
          store,
          user,
          await store.get(user, String(candidate.id)),
        );
        if (old.oauth && candidate.email !== old.email)
          throw new Error(
            "Invalid Gmail identity. Reconnect Google to change the mailbox.",
          );
        candidate.oauth = old.oauth;
        candidate.provider = old.provider;
        if (candidate.imap && !candidate.imap.password)
          candidate.imap.password = old.imap.password;
        if (candidate.smtp && !candidate.smtp.password)
          candidate.smtp.password = old.smtp.password;
      } else {
        candidate.id = randomUUID();
        delete candidate.oauth;
        candidate.provider = "imap";
      }
      const account = validateAccount(candidate);
      const connection = (await mailCommand(account, "test", {})) as {
        provider?: "gmail";
      };
      if (connection.provider) account.provider = connection.provider;
      await store.put(user, account);
      return reply(200, publicAccount(account));
    }
    if (typeof body.accountId !== "string")
      throw new Error("Choose a mail account.");
    let account = await store.get(user, body.accountId);
    if (
      ["confidentialSend", "confidentialItems", "revokeConfidential"].includes(
        body.action,
      )
    )
      return reply(
        200,
        await confidentialCommand(
          store,
          user,
          body.action === "confidentialSend"
            ? await authorizedAccount(store, user, account)
            : account,
          body.action,
          body,
        ),
      );
    if (body.action === "removeAccount") {
      await store.remove(user, account.id);
      return reply(200, { ok: true });
    }
    if (
      [
        "preferences",
        "savePreferences",
        "rules",
        "saveRule",
        "deleteRule",
        "templates",
        "saveTemplate",
        "deleteTemplate",
        "contacts",
        "saveContact",
        "deleteContact",
      ].includes(body.action)
    )
      return reply(
        200,
        await preferenceCommand(store, user, account, body.action, body),
      );
    if (body.action === "syncStatus")
      return reply(
        200,
        (await store.record(user, account.id, "sync", "inbox"))?.payload ?? {
          syncedAt: "",
          error: "Waiting for the first background sync.",
        },
      );
    if (/^(gmail|google)/.test(body.action)) {
      account = await authorizedAccount(store, user, account);
      return reply(200, await googleCommand(account, body.action, body));
    }
    if (
      ["jobs", "scheduleSend", "snooze", "cancelJob", "editJob"].includes(
        body.action,
      )
    )
      return reply(
        200,
        await jobCommand(
          store,
          user,
          body.action === "snooze"
            ? await authorizedAccount(store, user, account)
            : account,
          body.action,
          body,
          process.env.SUITELEAF_MAIL_WORKER_ID ?? "",
        ),
      );
    if (!actions.has(body.action)) throw new Error("Unknown mail command.");
    return reply(
      200,
      await mailCommand(
        await authorizedAccount(store, user, account),
        body.action,
        body,
      ),
    );
  } catch (error) {
    // Provider errors may contain credentials, server responses, and message contents.
    const safe =
      error instanceof Error &&
      /^(Secure mail requires|Choose |Enter |Invalid |Select |Unsupported |Unknown |Google |Gmail |Connect this account|This server has no mail worker|Use the SuiteLeaf server|The job has already|Snooze storage failed|The mailbox changed|Message not found|Attachment not found|Mail account not found|Mail account storage|Attachments must|This message exceeds|Your provider has no|The provider did not)/.test(
        error.message,
      );
    return reply(400, {
      error: safe
        ? (error as Error).message
        : "The mail operation failed. Check your server settings and provider availability. For a send failure, check Sent before retrying.",
    });
  } finally {
    const count = (active.get(user) ?? 1) - 1;
    if (count) active.set(user, count);
    else active.delete(user);
  }
}
