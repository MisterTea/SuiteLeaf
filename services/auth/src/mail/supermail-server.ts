import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join, resolve, sep, dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";

export function getSupermailBaseDir(): string {
  return (
    process.env.SUITELEAF_SUPERMAIL_DIR ||
    join(process.cwd(), "data", "supermail")
  );
}

export function getUserSupermailDir(userId: string): string {
  if (!userId || typeof userId !== "string") {
    throw new Error("Invalid user ID");
  }
  const hash = createHash("sha256")
    .update(`supermail-user:${userId}`)
    .digest("hex");
  return join(getSupermailBaseDir(), "users", hash);
}

export function resolveSafeUserPath(userDir: string, relPath: string): string {
  if (!relPath || typeof relPath !== "string") {
    throw new Error("Invalid path");
  }
  if (
    /^[a-zA-Z]:/.test(relPath) ||
    relPath.startsWith("\\") ||
    relPath.startsWith("/")
  ) {
    throw new Error("Access denied: path outside user directory");
  }
  const target = resolve(userDir, relPath);
  if (target !== userDir && !target.startsWith(userDir + sep)) {
    throw new Error("Access denied: path outside user directory");
  }
  return target;
}

const userDbs = new Map<string, DatabaseSync>();

export async function getUserDb(userId: string): Promise<DatabaseSync> {
  let db = userDbs.get(userId);
  if (!db) {
    const userDir = getUserSupermailDir(userId);
    await mkdir(userDir, { recursive: true });
    const dbPath = join(userDir, "velo.db");
    db = new DatabaseSync(dbPath);
    userDbs.set(userId, db);
  }
  return db;
}

export function closeAllUserDbs(): void {
  for (const db of userDbs.values()) {
    try {
      db.close();
    } catch {}
  }
  userDbs.clear();
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readJsonBody<T = any>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 50 * 1024 * 1024) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : ({} as T));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function createImapClient(config: any) {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.security === "tls",
    doSTARTTLS: config.security === "starttls",
    auth:
      config.auth_method === "oauth2"
        ? { user: config.username, accessToken: config.password }
        : { user: config.username, pass: config.password },
    tls: config.accept_invalid_certs ? { rejectUnauthorized: false } : undefined,
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

function createSmtpTransport(config: any) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.security === "tls",
    requireTLS: config.security === "starttls",
    auth:
      config.auth_method === "oauth2"
        ? { type: "OAuth2", user: config.username, accessToken: config.password }
        : { user: config.username, pass: config.password },
    tls: config.accept_invalid_certs ? { rejectUnauthorized: false } : undefined,
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

export async function handleSupermailRequest(
  req: IncomingMessage,
  res: ServerResponse,
  userId: string,
  url: URL,
): Promise<void> {
  const subpath = url.pathname.replace(/^\/api\/auth\/suiteleaf\/supermail\/?/, "");

  try {
    const userDir = getUserSupermailDir(userId);
    await mkdir(userDir, { recursive: true });

    // Database operations
    if (subpath === "db/select") {
      const { query, params } = await readJsonBody(req);
      if (!query || typeof query !== "string") {
        return sendJson(res, 400, { error: "Missing query" });
      }
      const db = await getUserDb(userId);
      const normalized = query.replace(/\$\d+/g, "?");
      const stmt = db.prepare(normalized);
      const rows = stmt.all(...(Array.isArray(params) ? params : []));
      return sendJson(res, 200, rows);
    }

    if (subpath === "db/execute") {
      const { query, params } = await readJsonBody(req);
      if (!query || typeof query !== "string") {
        return sendJson(res, 400, { error: "Missing query" });
      }
      const db = await getUserDb(userId);
      const normalized = query.replace(/\$\d+/g, "?");
      const stmt = db.prepare(normalized);
      const result = stmt.run(...(Array.isArray(params) ? params : []));
      return sendJson(res, 200, {
        rowsAffected: result.changes,
        lastInsertId: Number(result.lastInsertRowid),
      });
    }

    // Filesystem operations
    if (subpath === "fs/mkdir") {
      const { path } = await readJsonBody(req);
      const target = resolveSafeUserPath(userDir, path);
      await mkdir(target, { recursive: true });
      return sendJson(res, 200, { ok: true });
    }

    if (subpath === "fs/writeFile") {
      const { path, data } = await readJsonBody(req);
      const target = resolveSafeUserPath(userDir, path);
      await mkdir(dirname(target), { recursive: true });
      const buf =
        typeof data === "string"
          ? Buffer.from(data, "base64")
          : Buffer.from(data ?? []);
      await writeFile(target, buf);
      return sendJson(res, 200, { ok: true });
    }

    if (subpath === "fs/writeTextFile") {
      const { path, text } = await readJsonBody(req);
      const target = resolveSafeUserPath(userDir, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, String(text ?? ""), "utf8");
      return sendJson(res, 200, { ok: true });
    }

    if (subpath === "fs/readFile") {
      const { path } = await readJsonBody(req);
      const target = resolveSafeUserPath(userDir, path);
      const buf = await readFile(target);
      return sendJson(res, 200, { data: buf.toString("base64") });
    }

    if (subpath === "fs/readTextFile") {
      const { path } = await readJsonBody(req);
      const target = resolveSafeUserPath(userDir, path);
      const text = await readFile(target, "utf8");
      return sendJson(res, 200, { text });
    }

    if (subpath === "fs/remove") {
      const { path, recursive } = await readJsonBody(req);
      const target = resolveSafeUserPath(userDir, path);
      await rm(target, { recursive: Boolean(recursive), force: true });
      return sendJson(res, 200, { ok: true });
    }

    if (subpath === "fs/exists") {
      const { path } = await readJsonBody(req);
      const target = resolveSafeUserPath(userDir, path);
      try {
        await stat(target);
        return sendJson(res, 200, { exists: true });
      } catch {
        return sendJson(res, 200, { exists: false });
      }
    }

    // Invoke commands
    if (subpath === "invoke") {
      const { cmd, args = {} } = await readJsonBody(req);

      if (cmd === "imap_test_connection") {
        const client = createImapClient(args.config);
        client.on("error", () => {});
        try {
          await client.connect();
          return sendJson(res, 200, "Connection successful");
        } finally {
          await client.logout().catch(() => client.close());
        }
      }

      if (cmd === "imap_list_folders") {
        const client = createImapClient(args.config);
        client.on("error", () => {});
        await client.connect();
        try {
          const list = await client.list({
            statusQuery: { messages: true, unseen: true },
          });
          const folders = list.map((f) => ({
            path: f.path,
            raw_path: f.path,
            name: f.name,
            delimiter: f.delimiter,
            special_use: f.specialUse || null,
            exists: f.status?.messages ?? 0,
            unseen: f.status?.unseen ?? 0,
          }));
          return sendJson(res, 200, folders);
        } finally {
          await client.logout().catch(() => client.close());
        }
      }

      if (cmd === "imap_search_all_uids") {
        const client = createImapClient(args.config);
        client.on("error", () => {});
        await client.connect();
        try {
          const lock = await client.getMailboxLock(args.folder);
          try {
            const uids = await client.search({ all: true }, { uid: true });
            return sendJson(res, 200, uids || []);
          } finally {
            lock.release();
          }
        } finally {
          await client.logout().catch(() => client.close());
        }
      }

      if (cmd === "imap_fetch_new_uids") {
        const client = createImapClient(args.config);
        client.on("error", () => {});
        await client.connect();
        try {
          const lock = await client.getMailboxLock(args.folder);
          try {
            const sinceUid = args.sinceUid || 0;
            const uids = await client.search(
              { uid: `${sinceUid + 1}:*` },
              { uid: true },
            );
            return sendJson(
              res,
              200,
              (uids || []).filter((u: number) => u > sinceUid),
            );
          } finally {
            lock.release();
          }
        } finally {
          await client.logout().catch(() => client.close());
        }
      }

      if (cmd === "imap_fetch_messages") {
        const client = createImapClient(args.config);
        client.on("error", () => {});
        await client.connect();
        try {
          const lock = await client.getMailboxLock(args.folder);
          try {
            const messages: any[] = [];
            const uids: number[] = Array.isArray(args.uids) ? args.uids : [];
            if (uids.length > 0) {
              for await (const msg of client.fetch(uids, {
                envelope: true,
                flags: true,
                size: true,
                source: true,
                uid: true,
              })) {
                if (!msg.source) continue;
                const parsed: any = await (simpleParser as any)(msg.source, {
                  skipTextToHtml: true,
                });
                messages.push({
                  uid: msg.uid,
                  folder: args.folder,
                  message_id: parsed.messageId || null,
                  in_reply_to: parsed.inReplyTo || null,
                  references: Array.isArray(parsed.references)
                    ? parsed.references.join(" ")
                    : parsed.references || null,
                  from_address: parsed.from?.value?.[0]?.address || null,
                  from_name: parsed.from?.value?.[0]?.name || null,
                  to_addresses: parsed.to
                    ? Array.isArray(parsed.to)
                      ? parsed.to.flatMap((t: any) => t.value).map((v: any) => v.address).join(", ")
                      : parsed.to.text
                    : null,
                  cc_addresses: parsed.cc
                    ? Array.isArray(parsed.cc)
                      ? parsed.cc.flatMap((t: any) => t.value).map((v: any) => v.address).join(", ")
                      : parsed.cc.text
                    : null,
                  bcc_addresses: parsed.bcc
                    ? Array.isArray(parsed.bcc)
                      ? parsed.bcc.flatMap((t: any) => t.value).map((v: any) => v.address).join(", ")
                      : parsed.bcc.text
                    : null,
                  reply_to: parsed.replyTo?.value?.[0]?.address || null,
                  subject: parsed.subject || null,
                  date: parsed.date ? parsed.date.getTime() : Date.now(),
                  is_read: Boolean(msg.flags?.has("\\Seen")),
                  is_starred: Boolean(msg.flags?.has("\\Flagged")),
                  is_draft: Boolean(msg.flags?.has("\\Draft")),
                  body_html: parsed.html || null,
                  body_text: parsed.text || null,
                  snippet: (parsed.text || "").slice(0, 150),
                  raw_size: msg.size,
                  list_unsubscribe:
                    (parsed.headers?.get("list-unsubscribe") as string) || null,
                  list_unsubscribe_post:
                    (parsed.headers?.get("list-unsubscribe-post") as string) || null,
                  auth_results:
                    (parsed.headers?.get("authentication-results") as string) || null,
                  attachments: (parsed.attachments || []).map((att: any, idx: number) => ({
                    part_id: String(idx),
                    filename: att.filename || `attachment-${idx}`,
                    mime_type: att.contentType,
                    size: att.size,
                    content_id: att.cid || null,
                    is_inline: Boolean(att.related),
                  })),
                });
              }
            }
            const mb = client.mailbox ? client.mailbox : undefined;
            const folderStatus = {
              uidvalidity: Number(mb?.uidValidity ?? 0),
              uidnext: Number(mb?.uidNext ?? 1),
              exists: mb?.exists ?? 0,
              unseen: 0,
              highest_modseq: null,
            };
            return sendJson(res, 200, { messages, folder_status: folderStatus });
          } finally {
            lock.release();
          }
        } finally {
          await client.logout().catch(() => client.close());
        }
      }

      if (cmd === "imap_fetch_message_body") {
        const client = createImapClient(args.config);
        client.on("error", () => {});
        await client.connect();
        try {
          const lock = await client.getMailboxLock(args.folder);
          try {
            const msg = await client.fetchOne(String(args.uid), {
              source: true,
              flags: true,
              size: true,
            }, { uid: true });
            if (!msg || !msg.source) {
              return sendJson(res, 404, { error: "Message not found" });
            }
            const parsed: any = await (simpleParser as any)(msg.source, { skipTextToHtml: true });
            return sendJson(res, 200, {
              uid: args.uid,
              folder: args.folder,
              message_id: parsed.messageId || null,
              in_reply_to: parsed.inReplyTo || null,
              references: Array.isArray(parsed.references)
                ? parsed.references.join(" ")
                : parsed.references || null,
              from_address: parsed.from?.value?.[0]?.address || null,
              from_name: parsed.from?.value?.[0]?.name || null,
              to_addresses: parsed.to
                ? Array.isArray(parsed.to)
                  ? parsed.to.flatMap((t: any) => t.value).map((v: any) => v.address).join(", ")
                  : parsed.to.text
                : null,
              cc_addresses: parsed.cc
                ? Array.isArray(parsed.cc)
                  ? parsed.cc.flatMap((t: any) => t.value).map((v: any) => v.address).join(", ")
                  : parsed.cc.text
                : null,
              bcc_addresses: parsed.bcc
                ? Array.isArray(parsed.bcc)
                  ? parsed.bcc.flatMap((t: any) => t.value).map((v: any) => v.address).join(", ")
                  : parsed.bcc.text
                : null,
              reply_to: parsed.replyTo?.value?.[0]?.address || null,
              subject: parsed.subject || null,
              date: parsed.date ? parsed.date.getTime() : Date.now(),
              is_read: Boolean(msg.flags?.has("\\Seen")),
              is_starred: Boolean(msg.flags?.has("\\Flagged")),
              is_draft: Boolean(msg.flags?.has("\\Draft")),
              body_html: parsed.html || null,
              body_text: parsed.text || null,
              snippet: (parsed.text || "").slice(0, 150),
              raw_size: msg.size,
              list_unsubscribe:
                (parsed.headers?.get("list-unsubscribe") as string) || null,
              list_unsubscribe_post:
                (parsed.headers?.get("list-unsubscribe-post") as string) || null,
              auth_results:
                (parsed.headers?.get("authentication-results") as string) || null,
              attachments: (parsed.attachments || []).map((att: any, idx: number) => ({
                part_id: String(idx),
                filename: att.filename || `attachment-${idx}`,
                mime_type: att.contentType,
                size: att.size,
                content_id: att.cid || null,
                is_inline: Boolean(att.related),
              })),
            });
          } finally {
            lock.release();
          }
        } finally {
          await client.logout().catch(() => client.close());
        }
      }

      if (cmd === "imap_set_flags") {
        const client = createImapClient(args.config);
        client.on("error", () => {});
        await client.connect();
        try {
          const lock = await client.getMailboxLock(args.folder);
          try {
            const formatted = (args.flags || []).map((f: string) =>
              f.startsWith("\\") ? f : `\\${f}`,
            );
            if (args.add) {
              await client.messageFlagsAdd(args.uids, formatted, { uid: true });
            } else {
              await client.messageFlagsRemove(args.uids, formatted, { uid: true });
            }
            return sendJson(res, 200, null);
          } finally {
            lock.release();
          }
        } finally {
          await client.logout().catch(() => client.close());
        }
      }

      if (cmd === "imap_move_messages") {
        const client = createImapClient(args.config);
        client.on("error", () => {});
        await client.connect();
        try {
          const lock = await client.getMailboxLock(args.source_folder);
          try {
            await client.messageMove(args.uids, args.target_folder, { uid: true });
            return sendJson(res, 200, null);
          } finally {
            lock.release();
          }
        } finally {
          await client.logout().catch(() => client.close());
        }
      }

      if (cmd === "imap_delete_messages") {
        const client = createImapClient(args.config);
        client.on("error", () => {});
        await client.connect();
        try {
          const lock = await client.getMailboxLock(args.folder);
          try {
            await client.messageDelete(args.uids, { uid: true });
            return sendJson(res, 200, null);
          } finally {
            lock.release();
          }
        } finally {
          await client.logout().catch(() => client.close());
        }
      }

      if (cmd === "smtp_test_connection") {
        const transporter = createSmtpTransport(args.config);
        try {
          await transporter.verify();
          return sendJson(res, 200, {
            success: true,
            message: "SMTP server verified",
          });
        } finally {
          transporter.close();
        }
      }

      if (cmd === "smtp_send_email") {
        const transporter = createSmtpTransport(args.config);
        try {
          const email = args.email || {};
          const info = await transporter.sendMail({
            from: email.from,
            to: email.to,
            cc: email.cc,
            bcc: email.bcc,
            subject: email.subject,
            text: email.body_text,
            html: email.body_html,
            inReplyTo: email.in_reply_to,
            references: email.references,
            attachments: email.attachments?.map((a: any) => ({
              filename: a.filename,
              content: Buffer.from(a.content, "base64"),
              contentType: a.mime_type,
            })),
          });
          return sendJson(res, 200, {
            success: true,
            message: info.messageId || "Sent",
          });
        } finally {
          transporter.close();
        }
      }

      // Default fallback for client UI lifecycle commands
      return sendJson(res, 200, null);
    }

    return sendJson(res, 404, { error: "Unknown SuperMail endpoint" });
  } catch (err: any) {
    const status = err.message?.includes("Access denied") ? 403 : 500;
    return sendJson(res, status, { error: err.message || "Internal server error" });
  }
}
