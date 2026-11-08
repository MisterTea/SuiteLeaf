import { ImapFlow, type SearchObject } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser } from "mailparser";
import { convert } from "html-to-text";
import { googleCommand } from "./google";
import type { MailAccount } from "./types";
import { validateCompose } from "./types";

export function mailSearch(input: string): SearchObject {
  const and: SearchObject[] = [];
  for (const token of input.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
    const [key, ...rest] = token.split(":");
    const value = rest.join(":").replace(/^"|"$/g, "");
    if (["from", "to", "cc", "subject"].includes(key) && value)
      and.push({ [key]: value });
    else if (token === "is:unread") and.push({ seen: false });
    else if (token === "is:read") and.push({ seen: true });
    else if (token === "is:starred") and.push({ flagged: true });
    else if (
      ["before", "after"].includes(key) &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value))
    )
      and.push({ [key === "before" ? "before" : "since"]: new Date(value) });
    else and.push({ body: token.replace(/^"|"$/g, "") });
  }
  if (!and.length) return { all: true };
  if (and.length === 1) return and[0];
  // De Morgan preserves repeated terms (e.g. two body words) with IMAP's OR/NOT grammar.
  return { not: { or: and.map((term) => ({ not: term })) } };
}

export const mailDependencies = {
  imap: (a: MailAccount) =>
    new ImapFlow({
      host: a.imap.host,
      port: a.imap.port,
      secure: a.imap.secure,
      doSTARTTLS: a.imap.secure ? undefined : true,
      auth: a.oauth
        ? { user: a.imap.user, accessToken: a.oauth.accessToken }
        : { user: a.imap.user, pass: a.imap.password },
      logger: false,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    }),
  smtp: (a: MailAccount) =>
    nodemailer.createTransport({
      host: a.smtp.host,
      port: a.smtp.port,
      secure: a.smtp.secure,
      requireTLS: !a.smtp.secure,
      auth: a.oauth
        ? {
            type: "OAuth2",
            user: a.smtp.user,
            accessToken: a.oauth.accessToken,
          }
        : { user: a.smtp.user, pass: a.smtp.password },
      connectionTimeout: 15_000,
      socketTimeout: 60_000,
      disableFileAccess: true,
      disableUrlAccess: true,
    }),
};

export async function withMailbox<T>(
  account: MailAccount,
  run: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = mailDependencies.imap(account);
  // Prevent EventEmitter errors escaping the request. Connection commands report failures.
  client.on("error", () => {});
  try {
    await client.connect();
    return await run(client);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

function requiredText(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1024 ||
    /[\r\n\0]/.test(value)
  )
    throw new Error(`Invalid ${name}.`);
  return value;
}
function uids(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 500 ||
    value.some((n) => !Number.isSafeInteger(n) || n < 1)
  )
    throw new Error("Select 1–500 messages.");
  return value;
}
function validity(client: ImapFlow, value: unknown) {
  if (!client.mailbox || String(client.mailbox.uidValidity) !== value)
    throw new Error("The mailbox changed. Refresh before continuing.");
}
async function rawSource(client: ImapFlow, uid: number) {
  const message = await client.fetchOne(
    String(uid),
    { size: true },
    { uid: true },
  );
  if (!message) throw new Error("Message not found.");
  if (message.size === undefined || message.size > 25_000_000)
    throw new Error("This message exceeds the 25 MB reading limit.");
  const raw = await client.fetchOne(
    String(uid),
    { source: true },
    { uid: true },
  );
  if (!raw || !raw.source) throw new Error("Message not found.");
  return raw.source;
}
async function source(client: ImapFlow, uid: number) {
  return simpleParser(await rawSource(client, uid), {
    skipTextToHtml: true,
  });
}

/** Each request holds one mailbox lock; no UID is used without UIDVALIDITY. */
export async function mailCommand(
  account: MailAccount,
  action: string,
  body: Record<string, unknown>,
) {
  if (action === "test") {
    const gmail = await withMailbox(account, async (client) =>
      client.capabilities.has("X-GM-EXT-1"),
    );
    const smtp = mailDependencies.smtp(account);
    try {
      await smtp.verify();
    } finally {
      smtp.close();
    }
    return gmail ? { ok: true, provider: "gmail" } : { ok: true };
  }
  return withMailbox(account, async (client) => {
    if (action === "folders")
      return (
        await client.list({ statusQuery: { messages: true, unseen: true } })
      ).map((f) => ({
        path: f.path,
        name: f.name,
        specialUse: f.specialUse,
        selectable: !f.flags.has("\\Noselect"),
        messages: f.status?.messages,
        unseen: f.status?.unseen,
      }));
    if (action === "createFolder") {
      await client.mailboxCreate(requiredText(body.path, "folder"));
      return { ok: true };
    }
    if (action === "renameFolder") {
      await client.mailboxRename(
        requiredText(body.path, "folder"),
        requiredText(body.destination, "destination"),
      );
      return { ok: true };
    }
    if (action === "deleteFolder") {
      await client.mailboxDelete(requiredText(body.path, "folder"));
      return { ok: true };
    }
    if (action === "send" || action === "draft") {
      const message = validateCompose(body.message);
      let sender = account.email;
      if (message.from && message.from !== account.email) {
        if (!account.oauth)
          throw new Error(
            "Unsupported: alternate send identities require a verified Gmail identity.",
          );
        const identities = (await googleCommand(
          account,
          "gmailIdentities",
          {},
        )) as {
          sendAsEmail: string;
          verificationStatus?: string;
          isPrimary?: boolean;
        }[];
        if (
          !identities.some(
            (identity) =>
              identity.sendAsEmail === message.from &&
              (identity.verificationStatus === "accepted" ||
                identity.isPrimary),
          )
        )
          throw new Error(
            "Invalid sender identity. Verify the address in Gmail settings first.",
          );
        sender = message.from;
      }
      if (action === "send" && !message.to.trim())
        throw new Error("Enter a recipient.");
      const options = {
        ...message,
        from: { name: account.name, address: sender },
        attachments: message.attachments?.map((a) => ({
          ...a,
          content: Buffer.from(a.content, "base64"),
        })),
        disableFileAccess: true,
        disableUrlAccess: true,
      };
      const compiled = new MailComposer(options).compile();
      compiled.keepBcc = action === "draft";
      const raw = await compiled.build();
      const folders = await client.list();
      const target = folders.find(
        (f) => f.specialUse === (action === "draft" ? "\\Drafts" : "\\Sent"),
      );
      const removePreviousDraft = async () => {
        if (!body.draftRef || typeof body.draftRef !== "object") return "";
        const ref = body.draftRef as Record<string, unknown>;
        try {
          const lock = await client.getMailboxLock(
            requiredText(ref.folder, "draft folder"),
          );
          try {
            validity(client, ref.uidValidity);
            await client.messageDelete(uids([ref.uid]), { uid: true });
          } finally {
            lock.release();
          }
          return "";
        } catch {
          return " The previous draft could not be removed.";
        }
      };
      if (action === "draft") {
        if (!target)
          throw new Error(
            "Your provider has no Drafts folder. Create or configure one first.",
          );
        const appended = await client.append(target.path, raw, [
          "\\Draft",
          "\\Seen",
        ]);
        if (!appended) throw new Error("The provider did not save the draft.");
        return {
          ok: true,
          uid: appended.uid,
          folder: target.path,
          uidValidity: String(appended.uidValidity),
          warning: await removePreviousDraft(),
        };
      }
      const smtp = mailDependencies.smtp(account);
      let result;
      try {
        // SMTP envelope retains Bcc while the RFC822 copy omits that header.
        result = await smtp.sendMail({
          envelope: compiled.getEnvelope(),
          raw,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
      } finally {
        smtp.close();
      }
      let warning = result.rejected?.length
        ? "Some recipients were rejected by the SMTP server."
        : "";
      if (
        client.capabilities.has("X-GM-EXT-1") &&
        ["smtp.gmail.com", "smtp.googlemail.com"].includes(
          account.smtp.host.toLowerCase(),
        )
      ) {
        // Gmail's SMTP service already files the identical message in Sent.
      } else if (target) {
        try {
          await client.append(target.path, raw, ["\\Seen"]);
        } catch {
          warning +=
            " Message sent, but the Sent copy could not be saved. Do not resend.";
        }
      } else
        warning +=
          " Message sent; this provider has no Sent folder for a copy.";
      warning += await removePreviousDraft();
      return { ok: true, messageId: result.messageId, warning };
    }
    const folder = requiredText(body.folder, "folder");
    if (action === "snooze") {
      if (!client.capabilities.has("UIDPLUS"))
        throw new Error(
          "Unsupported: snooze requires provider UIDPLUS support.",
        );
      const path = "SuiteLeaf Snoozed";
      if (!(await client.list()).some((f) => f.path === path))
        await client.mailboxCreate(path);
    }
    const lock = await client.getMailboxLock(folder);
    try {
      if (action === "list") {
        const page = Number(body.page ?? 0);
        if (!Number.isInteger(page) || page < 0)
          throw new Error("Invalid page.");
        const found = await client.search(
          client.capabilities.has("X-GM-EXT-1") && body.query
            ? { gmraw: String(body.query) }
            : mailSearch(String(body.query ?? "")),
          { uid: true },
        );
        const all = (found || []).sort((a, b) => b - a);
        const ids = all.slice(page * 50, (page + 1) * 50);
        const messages = ids.length
          ? await client.fetchAll(
              ids,
              { envelope: true, flags: true, size: true, threadId: true },
              { uid: true },
            )
          : [];
        return {
          total: all.length,
          uidValidity: client.mailbox ? String(client.mailbox.uidValidity) : "",
          messages: messages
            .sort((a, b) => b.uid - a.uid)
            .map((m) => ({
              uid: m.uid,
              flags: [...(m.flags ?? [])],
              size: m.size,
              threadId: m.threadId,
              ...m.envelope,
            })),
        };
      }
      validity(client, body.uidValidity);
      if (action === "original") {
        const [uid] = uids([body.uid]);
        return {
          filename: `message-${uid}.eml`,
          contentType: "message/rfc822",
          content: (await rawSource(client, uid)).toString("base64"),
        };
      }
      if (action === "snooze") {
        const ids = uids(body.uids);
        const moved = await client.messageMove(ids, "SuiteLeaf Snoozed", {
          uid: true,
        });
        if (!moved || !moved.uidMap || !moved.uidValidity)
          throw new Error(
            "The provider did not return snooze identifiers. Check SuiteLeaf Snoozed and restore messages manually.",
          );
        return {
          folder: "SuiteLeaf Snoozed",
          uidValidity: String(moved.uidValidity),
          uids: [...moved.uidMap.values()],
        };
      }
      if (action === "labels") {
        if (!client.capabilities.has("X-GM-EXT-1"))
          throw new Error(
            "Unsupported: this provider does not support Gmail labels.",
          );
        const labels = body.labels;
        if (
          !Array.isArray(labels) ||
          !labels.length ||
          labels.length > 30 ||
          labels.some((l) => typeof l !== "string" || !l || /[\r\n\0]/.test(l))
        )
          throw new Error("Invalid labels.");
        if (body.add)
          await client.messageFlagsAdd(uids(body.uids), labels, {
            uid: true,
            useLabels: true,
          });
        else
          await client.messageFlagsRemove(uids(body.uids), labels, {
            uid: true,
            useLabels: true,
          });
        return { ok: true };
      }
      if (action === "conversation") {
        const [uid] = uids([body.uid]);
        const root = await source(client, uid);
        const references =
          typeof root.references === "string"
            ? [root.references]
            : (root.references ?? []);
        const ids = [...references, root.messageId]
          .filter((id): id is string => !!id)
          .slice(-20);
        const terms: SearchObject[] = ids.flatMap((id) =>
          ["Message-ID", "References"].map((key) => ({
            header: { [key]: id },
          })),
        );
        const matches = ids.length
          ? await client.search({ or: terms }, { uid: true })
          : [uid];
        const found = (matches || [uid]).sort((a, b) => a - b);
        const page = Math.max(0, Number(body.page) || 0);
        const messages = [];
        for (const id of found.slice(page * 20, (page + 1) * 20)) {
          const parsed = await source(client, id);
          await client.messageFlagsAdd([id], ["\\Seen"], { uid: true });
          messages.push({
            uid: id,
            subject: parsed.subject ?? "(no subject)",
            from: parsed.from?.text,
            date: parsed.date,
            messageId: parsed.messageId,
            text: parsed.text || (parsed.html ? convert(parsed.html) : ""),
            html: parsed.html || "",
            attachments: parsed.attachments.map((a, index) => ({
              index,
              filename: a.filename || "attachment",
              size: a.size,
              contentType: a.contentType,
            })),
          });
        }
        return { total: found.length, messages };
      }
      if (action === "read" || action === "attachment") {
        const [uid] = uids([body.uid]);
        const parsed = await source(client, uid);
        if (action === "attachment") {
          const index = Number(body.index);
          if (
            !Number.isInteger(index) ||
            index < 0 ||
            !parsed.attachments[index]
          )
            throw new Error("Attachment not found.");
          const a = parsed.attachments[index];
          return {
            filename: a.filename || "attachment",
            contentType: a.contentType,
            content: a.content.toString("base64"),
          };
        }
        await client.messageFlagsAdd([uid], ["\\Seen"], { uid: true });
        const addresses = (value: typeof parsed.to) =>
          Array.isArray(value)
            ? {
                text: value.map((a) => a.text).join(", "),
                value: value.flatMap((a) => a.value),
              }
            : value;
        return {
          uid,
          subject: parsed.subject ?? "(no subject)",
          from: parsed.from?.text,
          senderAddress: parsed.from?.value[0]?.address,
          replyTo: parsed.replyTo?.text,
          to: addresses(parsed.to),
          cc: addresses(parsed.cc),
          bcc: addresses(parsed.bcc),
          date: parsed.date,
          messageId: parsed.messageId,
          inReplyTo: parsed.inReplyTo,
          references: parsed.references,
          text:
            parsed.text ||
            (parsed.html
              ? convert(parsed.html, {
                  limits: { maxInputLength: 2_000_000, maxDepth: 50 },
                })
              : ""),
          html: parsed.html || "",
          attachments: parsed.attachments.map((a, index) => ({
            index,
            filename: a.filename || "attachment",
            contentType: a.contentType,
            size: a.size,
            cid: a.cid,
          })),
        };
      }
      const ids = uids(body.uids);
      if (action === "flags") {
        const flag = requiredText(body.flag, "flag");
        if (!["\\Seen", "\\Flagged", "$Junk", "$NotJunk"].includes(flag))
          throw new Error("Unsupported flag.");
        if (typeof body.add !== "boolean")
          throw new Error("Invalid flag operation.");
        await (body.add
          ? client.messageFlagsAdd(ids, [flag], { uid: true })
          : client.messageFlagsRemove(ids, [flag], { uid: true }));
      } else if (action === "move" || action === "copy") {
        const destination = requiredText(body.destination, "destination");
        if (action === "move")
          await client.messageMove(ids, destination, { uid: true });
        else await client.messageCopy(ids, destination, { uid: true });
      } else if (action === "delete")
        await client.messageDelete(ids, { uid: true });
      else throw new Error("Unknown mail command.");
      return { ok: true };
    } finally {
      lock.release();
    }
  });
}
