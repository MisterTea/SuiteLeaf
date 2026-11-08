import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { MailStore } from "./store";
import { validateCompose, type MailAccount, type MailCompose } from "./types";
import { mailCommand } from "./service";
import { withMailLock } from "./locks";
interface SecureMail {
  key: string;
  sender: string;
  subject: string;
  message?: MailCompose;
  expiresAt: number;
  salt: string;
  hash: string;
  failures: number;
  lockedUntil: number;
}
export async function confidentialCommand(
  store: MailStore,
  user: string,
  account: MailAccount,
  action: string,
  body: Record<string, unknown>,
) {
  if (action === "confidentialItems")
    return (
      await store.records<SecureMail>(user, account.id, "confidential")
    ).map((r) => ({
      key: r.payload.key,
      subject: r.payload.subject,
      expiresAt: r.payload.expiresAt,
      state: r.state,
    }));
  if (action === "revokeConfidential") {
    const row = await store.record<SecureMail>(
      user,
      account.id,
      "confidential",
      String(body.key),
    );
    if (!row) throw new Error("Invalid secure message.");
    row.state = "revoked";
    delete row.payload.message;
    await store.updateRecord(row);
    return { ok: true };
  }
  if (action !== "confidentialSend")
    throw new Error("Unknown secure message action.");
  const publicUrl = process.env.SUITELEAF_PUBLIC_URL;
  if (!publicUrl || new URL(publicUrl).protocol !== "https:")
    throw new Error("Secure mail requires an HTTPS public server URL.");
  const message = validateCompose(body.message);
  const expiresAt = Date.parse(String(body.expiresAt));
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt < Date.now() + 60000 ||
    expiresAt > Date.now() + 31 * 86400000
  )
    throw new Error(
      "Choose a secure message expiry between one minute and 31 days.",
    );
  if (
    typeof body.passcode !== "string" ||
    body.passcode.length < 8 ||
    body.passcode.length > 128
  )
    throw new Error("Enter a secure message passcode of 8–128 characters.");
  const key = randomUUID(),
    salt = randomBytes(16).toString("hex"),
    hash = scryptSync(body.passcode, salt, 32).toString("hex");
  const payload: SecureMail = {
    key,
    sender: `${account.name} <${account.email}>`,
    subject: message.subject,
    message,
    expiresAt,
    salt,
    hash,
    failures: 0,
    lockedUntil: 0,
  };
  await store.saveRecord(user, account.id, "confidential", key, payload, {
    state: "active",
  });
  const token = store.seal({ user, accountId: account.id, key, expiresAt });
  const link = `${publicUrl.replace(/\/$/, "")}/#/confidential/${encodeURIComponent(token)}`;
  const result = (await mailCommand(account, "send", {
    message: {
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      from: message.from,
      subject: message.subject,
      text: `${account.name} sent you an expiring SuiteLeaf message.\n\nOpen: ${link}\n\nExpires: ${new Date(expiresAt).toISOString()}\nA passcode is required. Ask the sender for it through a separate channel.\n\nAccess can be revoked by the sender. This does not prevent screenshots or copying after viewing.`,
    },
  })) as { warning?: string };
  if (body.draftRef && typeof body.draftRef === "object") {
    const ref = body.draftRef as Record<string, unknown>;
    try {
      await mailCommand(account, "delete", { ...ref, uids: [ref.uid] });
    } catch {
      result.warning =
        (result.warning || "") +
        " The previous provider draft could not be removed.";
    }
  }
  return { ok: true, warning: result.warning, link };
}
export async function readConfidential(
  store: MailStore,
  body: Record<string, unknown>,
) {
  if (
    typeof body.token !== "string" ||
    typeof body.passcode !== "string" ||
    body.passcode.length > 128
  )
    throw new Error("Access denied.");
  const token = store.open<{
    user: string;
    accountId: string;
    key: string;
    expiresAt: number;
  }>(body.token);
  const passcode = body.passcode;
  return withMailLock(`secure:${token.user}:${token.key}`, async () => {
    if (token.expiresAt < Date.now()) throw new Error("Access denied.");
    if (!(await store.ownerActive(token.user)))
      throw new Error("Access denied.");
    const row = await store.record<SecureMail>(
      token.user,
      token.accountId,
      "confidential",
      token.key,
    );
    if (
      !row ||
      row.state !== "active" ||
      row.payload.expiresAt < Date.now() ||
      !row.payload.message ||
      row.payload.lockedUntil > Date.now()
    )
      throw new Error("Access denied.");
    const candidate = scryptSync(passcode, row.payload.salt, 32),
      expected = Buffer.from(row.payload.hash, "hex");
    if (
      expected.length !== candidate.length ||
      !timingSafeEqual(candidate, expected)
    ) {
      row.payload.failures++;
      if (row.payload.failures >= 10) {
        row.payload.lockedUntil = Date.now() + 30 * 60000;
        row.payload.failures = 0;
      }
      await store.updateRecord(row);
      throw new Error("Access denied.");
    }
    const message = row.payload.message;
    if (body.check === true)
      return { ok: true, expiresAt: row.payload.expiresAt };
    if (body.index !== undefined) {
      const index = Number(body.index);
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        !message.attachments?.[index]
      )
        throw new Error("Access denied.");
      return message.attachments[index];
    }
    return {
      sender: row.payload.sender,
      subject: message.subject,
      text: message.text,
      html: message.html,
      expiresAt: row.payload.expiresAt,
      attachments: (message.attachments || []).map((a, index) => ({
        index,
        filename: a.filename,
        contentType: a.contentType,
        size: Math.floor(a.content.length * 0.75),
      })),
    };
  });
}
export async function confidentialRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: MailStore,
) {
  const reply = (status: number, value: unknown) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    });
    res.end(JSON.stringify(value));
  };
  if (
    req.method !== "POST" ||
    !req.headers["content-type"]?.startsWith("application/json")
  )
    return reply(405, { error: "Use a JSON POST." });
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 64000) return reply(413, { error: "Request too large." });
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());
    return reply(200, await readConfidential(store, body));
  } catch {
    return reply(403, {
      error:
        "This link or passcode is invalid, expired, revoked, or temporarily locked. Ask the sender for access.",
    });
  }
}
