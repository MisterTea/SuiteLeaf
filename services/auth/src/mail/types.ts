export interface MailEndpoint {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}
export interface MailAccount {
  id: string;
  name: string;
  email: string;
  imap: MailEndpoint;
  smtp: MailEndpoint;
  signature: string;
  provider?: "gmail" | "imap";
  oauth?: { accessToken: string; refreshToken: string; expiresAt: number };
}
export interface MailCompose {
  from?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: { filename: string; content: string; contentType: string }[];
}
export function publicAccount(account: MailAccount) {
  const { oauth, ...publicFields } = account;
  return {
    ...publicFields,
    ...(oauth ? { oauthConnected: true } : {}),
    imap: { ...account.imap, password: "" },
    smtp: { ...account.smtp, password: "" },
  };
}
export function validateAccount(value: unknown): MailAccount {
  const a = value as MailAccount;
  if (
    !a ||
    typeof a.name !== "string" ||
    !a.name.trim() ||
    /[\r\n]/.test(a.name) ||
    a.name.length > 256 ||
    typeof a.email !== "string" ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(a.email)
  )
    throw new Error("Enter a name and a valid email address.");
  for (const e of [a.imap, a.smtp]) {
    if (
      !e ||
      typeof e.host !== "string" ||
      !/^[a-z0-9.-]+$/i.test(e.host) ||
      !Number.isInteger(e.port) ||
      e.port < 1 ||
      e.port > 65535 ||
      typeof e.secure !== "boolean" ||
      typeof e.user !== "string" ||
      !e.user ||
      typeof e.password !== "string" ||
      (!e.password && !a.oauth)
    )
      throw new Error(
        "Enter a host, port, username and password for IMAP and SMTP.",
      );
  }
  if (typeof a.signature !== "string") a.signature = "";
  if (
    a.oauth &&
    (a.imap.host !== "imap.gmail.com" ||
      a.smtp.host !== "smtp.gmail.com" ||
      a.imap.port !== 993 ||
      a.smtp.port !== 465 ||
      !a.imap.secure ||
      !a.smtp.secure ||
      a.imap.user !== a.email ||
      a.smtp.user !== a.email)
  )
    throw new Error(
      "Invalid Gmail OAuth endpoints. Reconnect Google to reset this account.",
    );
  return a;
}
export function validateCompose(value: unknown): MailCompose {
  const m = value as MailCompose;
  if (
    !m ||
    typeof m.to !== "string" ||
    typeof m.subject !== "string" ||
    typeof m.text !== "string"
  )
    throw new Error("Invalid message.");
  if (
    m.html !== undefined &&
    (typeof m.html !== "string" || m.html.length > 2_000_000)
  )
    throw new Error("Invalid HTML message.");
  if (m.references !== undefined && !Array.isArray(m.references))
    throw new Error("Invalid message header.");
  if (m.attachments !== undefined && !Array.isArray(m.attachments))
    throw new Error("Invalid attachments.");
  for (const field of [
    m.to,
    m.from,
    m.cc,
    m.bcc,
    m.subject,
    m.inReplyTo,
    ...(m.references ?? []),
  ]) {
    if (
      field !== undefined &&
      (typeof field !== "string" || /[\r\n]/.test(field))
    )
      throw new Error("Invalid message header.");
  }
  if (
    (m.attachments?.length ?? 0) > 30 ||
    m.attachments?.some(
      (a) =>
        !a ||
        typeof a.filename !== "string" ||
        typeof a.contentType !== "string" ||
        /[\r\n]/.test(a.filename + a.contentType) ||
        typeof a.content !== "string" ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(a.content),
    )
  )
    throw new Error("Invalid attachments.");
  if (
    (m.attachments ?? []).reduce((sum, a) => sum + a.content.length, 0) >
    28_000_000
  )
    throw new Error("Attachments must total less than 20 MB.");
  // Never pass arbitrary Nodemailer options supplied by the client to the transport.
  return {
    from: m.from,
    to: m.to,
    cc: m.cc,
    bcc: m.bcc,
    subject: m.subject,
    text: m.text,
    html: m.html,
    inReplyTo: m.inReplyTo,
    references: m.references,
    attachments: m.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  };
}
