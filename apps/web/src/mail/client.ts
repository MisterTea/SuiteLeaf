import { getSession } from "../node-client";
import { cacheMail, cachedMail, setOfflineMail } from "./offline";
export interface Endpoint {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}
export interface Account {
  id: string;
  name: string;
  email: string;
  signature: string;
  provider?: "gmail" | "imap";
  oauthConnected?: boolean;
  imap: Endpoint;
  smtp: Endpoint;
}
export interface Folder {
  path: string;
  name: string;
  specialUse?: string;
  selectable: boolean;
  messages?: number;
  unseen?: number;
}
export interface Address {
  name?: string;
  address?: string;
}
export interface Summary {
  uid: number;
  flags: string[];
  subject?: string;
  date?: string;
  from?: Address[];
  to?: Address[];
  messageId?: string;
  threadId?: string;
}
export interface Listing {
  total: number;
  uidValidity: string;
  messages: Summary[];
}
export interface Attachment {
  index: number;
  filename: string;
  size: number;
  contentType: string;
  cid?: string;
}
export interface Message {
  uid: number;
  subject: string;
  from?: string;
  senderAddress?: string;
  replyTo?: string;
  to?: { text: string; value: Address[] };
  cc?: { text: string; value: Address[] };
  bcc?: { text: string; value: Address[] };
  date?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[] | string;
  text: string;
  html: string;
  attachments: Attachment[];
}
export interface Compose {
  from?: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments: { filename: string; content: string; contentType: string }[];
}
export const emptyCompose = (): Compose => ({
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  text: "",
  attachments: [],
});
export async function mailCall<T>(
  action: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const session = getSession();
  if (!session)
    throw new Error("Sign in to your SuiteLeaf server to use Mail.");
  const request = { ...body, action };
  let response: Response;
  try {
    response = await fetch(`${session.url}/api/auth/suiteleaf/mail`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(request),
    });
  } catch (error) {
    const cached = await cachedMail<T>(session, request);
    if (cached !== undefined) {
      window.dispatchEvent(new Event("suiteleaf:mail-offline"));
      return cached;
    }
    throw error;
  }
  const payload = await response
    .json()
    .catch(() => ({ error: "The mail server returned an invalid response." }));
  if (!response.ok) throw new Error(payload.error || "Mail request failed.");
  if (
    (action === "savePreferences" || action === "preferences") &&
    typeof payload.offline === "boolean"
  )
    await setOfflineMail(session, payload.offline);
  if (action === "savePreferences" && payload.offline)
    window.dispatchEvent(new Event("suiteleaf:mail-offline-enabled"));
  await cacheMail(session, request, payload);
  return payload as T;
}
export function downloadAttachment(file: {
  filename: string;
  content: string;
  contentType: string;
}) {
  const bytes = Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/octet-stream" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function replyTo(
  message: Message,
  account: Account,
  kind: "reply" | "all" | "forward",
): Compose {
  const draft = emptyCompose();
  const forward = kind === "forward";
  draft.to = forward ? "" : message.replyTo || message.from || "";
  if (kind === "all")
    draft.cc = [...(message.to?.value ?? []), ...(message.cc?.value ?? [])]
      .filter((a) => a.address?.toLowerCase() !== account.email.toLowerCase())
      .map((a) => a.address)
      .filter(Boolean)
      .join(", ");
  draft.subject = /^(re|fwd?):/i.test(message.subject)
    ? message.subject
    : `${forward ? "Fwd" : "Re"}: ${message.subject}`;
  draft.text = `${account.signature ? `\n\n${account.signature}` : ""}\n\nOn ${message.date ?? ""}, ${message.from ?? ""} wrote:\n${message.text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n")}`;
  if (!forward) {
    draft.inReplyTo = message.messageId;
    draft.references = [
      ...(typeof message.references === "string"
        ? [message.references]
        : (message.references ?? [])),
      ...(message.messageId ? [message.messageId] : []),
    ];
  }
  return draft;
}
