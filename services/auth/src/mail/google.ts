import {
  createHash,
  randomBytes,
  randomUUID,
  sign,
  createPrivateKey,
} from "node:crypto";
import type { MailAccount } from "./types";
import type { MailStore } from "./store";

const gmailBase = "https://gmail.googleapis.com/gmail/v1/users/me";
async function administrationAccount(account: MailAccount) {
  if (!account.oauth)
    throw new Error(
      "Connect this account with Google OAuth before using Gmail administration.",
    );
  const raw = process.env.SUITELEAF_GMAIL_SERVICE_ACCOUNT;
  if (!raw)
    throw new Error(
      "Gmail administration requires a service account with Workspace domain-wide delegation configured by the server administrator.",
    );
  let assertion: string;
  try {
    const key = JSON.parse(raw) as {
      client_email: string;
      private_key: string;
    };
    if (!key.client_email || !key.private_key) throw new Error();
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: key.client_email, sub: account.email, scope: "https://www.googleapis.com/auth/gmail.settings.sharing https://www.googleapis.com/auth/gmail.settings.basic", aud: "https://oauth2.googleapis.com/token", iat: now - 30, exp: now + 3600 })}`;
    assertion = `${input}.${sign("RSA-SHA256", Buffer.from(input), createPrivateKey(key.private_key)).toString("base64url")}`;
  } catch {
    throw new Error("Gmail administrative credentials are invalid.");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token)
    throw new Error(
      "Google rejected Workspace delegation. Check the service account's authorized scopes and domain policy.",
    );
  return {
    ...account,
    oauth: { ...account.oauth, accessToken: String(result.access_token) },
  };
}
function clientConfig() {
  const clientId =
    process.env.SUITELEAF_GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.SUITELEAF_GMAIL_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET;
  const publicUrl = process.env.SUITELEAF_PUBLIC_URL;
  if (!clientId || !clientSecret || !publicUrl)
    throw new Error(
      "Gmail OAuth is not configured. Ask your server administrator to set SUITELEAF_GMAIL_CLIENT_ID and SUITELEAF_GMAIL_CLIENT_SECRET.",
    );
  return {
    clientId,
    clientSecret,
    redirectUri: `${publicUrl.replace(/\/$/, "")}/api/auth/suiteleaf/mail/google/callback`,
  };
}
async function tokenRequest(params: Record<string, string>) {
  const { clientId, clientSecret } = clientConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      ...params,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token)
    throw new Error(
      "Google authorization failed. Reconnect your Gmail account.",
    );
  return result as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}
export async function authorizedAccount(
  store: MailStore,
  user: string,
  account: MailAccount,
): Promise<MailAccount> {
  if (!account.oauth || account.oauth.expiresAt > Date.now() + 60_000)
    return account;
  const result = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: account.oauth.refreshToken,
  });
  const next = {
    ...account,
    oauth: {
      accessToken: result.access_token,
      refreshToken: result.refresh_token || account.oauth.refreshToken,
      expiresAt: Date.now() + result.expires_in * 1000,
    },
  };
  await store.put(user, next);
  return next;
}
export async function beginGoogle(
  store: MailStore,
  user: string,
  services = false,
) {
  const { clientId, redirectUri } = clientConfig();
  const key = randomUUID(),
    verifier = randomBytes(48).toString("base64url"),
    expiresAt = Date.now() + 10 * 60_000;
  const state = store.seal({ user, key, expiresAt });
  await store.saveRecord(user, "", "oauth", key, { verifier, expiresAt });
  const scope = [
    "https://mail.google.com/",
    "https://www.googleapis.com/auth/gmail.settings.basic",
    "https://www.googleapis.com/auth/contacts.readonly",
  ];
  if (services)
    scope.push(
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/tasks",
    );
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: scope.join(" "),
    state,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
  return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` };
}
export async function finishGoogle(
  store: MailStore,
  state: string,
  code: string,
) {
  const decoded = store.open<{ user: string; key: string; expiresAt: number }>(
    state,
  );
  if (decoded.expiresAt < Date.now())
    throw new Error("Google authorization expired. Start again.");
  const record = await store.record<{ verifier: string; expiresAt: number }>(
    decoded.user,
    "",
    "oauth",
    decoded.key,
  );
  if (!record || record.payload.expiresAt < Date.now())
    throw new Error("Google authorization was already used or expired.");
  await store.deleteRecord(decoded.user, record.id);
  const result = await tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: record.payload.verifier,
    redirect_uri: clientConfig().redirectUri,
  });
  if (!result.refresh_token)
    throw new Error(
      "Google did not grant offline access. Reconnect and allow the requested permissions.",
    );
  const response = await fetch(`${gmailBase}/profile`, {
    headers: { authorization: `Bearer ${result.access_token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const profile = await response.json();
  if (!response.ok || !profile.emailAddress)
    throw new Error("Google did not provide a Gmail mailbox.");
  const existing = (await store.list(decoded.user)).find(
    (a) => a.email.toLowerCase() === String(profile.emailAddress).toLowerCase(),
  );
  const endpoint = {
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    user: profile.emailAddress,
    password: "",
  };
  const account: MailAccount = {
    id: existing?.id || randomUUID(),
    name: existing?.name || profile.emailAddress,
    email: profile.emailAddress,
    signature: existing?.signature || "",
    provider: "gmail",
    imap: endpoint,
    smtp: { ...endpoint, host: "smtp.gmail.com", port: 465 },
    oauth: {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: Date.now() + result.expires_in * 1000,
    },
  };
  await store.put(decoded.user, account);
  return account;
}
async function googleFetch(
  account: MailAccount,
  url: string,
  method = "GET",
  body?: unknown,
) {
  if (!account.oauth)
    throw new Error(
      "Connect this account with Google OAuth to use Gmail integrations.",
    );
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${account.oauth.accessToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok)
    throw new Error(
      `Google rejected this operation (${response.status}). Check your granted permissions and Workspace administrator policy.`,
    );
  return data;
}
const text = (value: unknown) => {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 2000 ||
    /[\r\n\0]/.test(value)
  )
    throw new Error("Invalid Google setting.");
  return value;
};
export async function googleCommand(
  account: MailAccount,
  action: string,
  body: Record<string, unknown>,
) {
  const api = (path: string, method = "GET", data?: unknown) =>
    googleFetch(account, `${gmailBase}${path}`, method, data);
  if (
    action === "gmailAdministration" &&
    !process.env.SUITELEAF_GMAIL_SERVICE_ACCOUNT
  )
    return {
      available: false,
      delegates: [],
      forwardingAddresses: [],
      autoForwarding: { enabled: false },
    };
  if (
    [
      "gmailAdministration",
      "gmailDelegate",
      "gmailForwarding",
      "gmailAlias",
    ].includes(action)
  ) {
    const admin = await administrationAccount(account),
      request = (path: string, method = "GET", data?: unknown) =>
        googleFetch(admin, `${gmailBase}${path}`, method, data);
    if (action === "gmailAdministration") {
      const [delegates, forwarding, automatic] = await Promise.all([
        request("/settings/delegates"),
        request("/settings/forwardingAddresses"),
        request("/settings/autoForwarding"),
      ]);
      return {
        available: true,
        delegates: delegates.delegates || [],
        forwardingAddresses: forwarding.forwardingAddresses || [],
        autoForwarding: automatic,
      };
    }
    if (action === "gmailDelegate") {
      const email = text(body.email);
      return body.operation === "delete"
        ? request(`/settings/delegates/${encodeURIComponent(email)}`, "DELETE")
        : request("/settings/delegates", "POST", { delegateEmail: email });
    }
    if (action === "gmailForwarding") {
      if (body.operation === "create")
        return request("/settings/forwardingAddresses", "POST", {
          forwardingEmail: text(body.email),
        });
      if (body.operation === "delete")
        return request(
          `/settings/forwardingAddresses/${encodeURIComponent(text(body.email))}`,
          "DELETE",
        );
      const disposition = [
        "leaveInInbox",
        "archive",
        "trash",
        "markRead",
      ].includes(String(body.disposition))
        ? body.disposition
        : "leaveInInbox";
      return request("/settings/autoForwarding", "PUT", {
        enabled: body.enabled === true,
        ...(body.email ? { emailAddress: text(body.email) } : {}),
        disposition,
      });
    }
    return request("/settings/sendAs", "POST", {
      sendAsEmail: text(body.email),
      displayName: typeof body.name === "string" ? body.name : "",
      ...(body.replyTo ? { replyToAddress: text(body.replyTo) } : {}),
    });
  }
  if (action === "gmailIdentities")
    return (await api("/settings/sendAs")).sendAs || [];
  if (action === "gmailSettings") {
    const [labels, filters, vacation, sendAs] = await Promise.all([
      api("/labels"),
      api("/settings/filters"),
      api("/settings/vacation"),
      api("/settings/sendAs"),
    ]);
    return {
      labels: labels.labels || [],
      filters: filters.filter || [],
      vacation,
      sendAs: sendAs.sendAs || [],
    };
  }
  if (action === "gmailLabel") {
    if (body.operation === "create")
      return api("/labels", "POST", {
        name: text(body.name),
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      });
    const id = encodeURIComponent(text(body.id));
    if (body.operation === "delete") return api(`/labels/${id}`, "DELETE");
    if (body.operation === "rename")
      return api(`/labels/${id}`, "PATCH", { name: text(body.name) });
  }
  if (action === "gmailFilter") {
    if (body.operation === "delete")
      return api(
        `/settings/filters/${encodeURIComponent(text(body.id))}`,
        "DELETE",
      );
    const criteria = { query: text(body.query) };
    const allowedLabels = (value: unknown) =>
      Array.isArray(value) && value.every((v) => typeof v === "string")
        ? value
        : [];
    return api("/settings/filters", "POST", {
      criteria,
      action: {
        addLabelIds: allowedLabels(body.addLabelIds),
        removeLabelIds: allowedLabels(body.removeLabelIds),
        ...(body.forward ? { forward: text(body.forward) } : {}),
      },
    });
  }
  if (action === "gmailVacation") {
    const start = body.startTime
        ? Date.parse(String(body.startTime))
        : undefined,
      end = body.endTime ? Date.parse(String(body.endTime)) : undefined;
    if (
      (start !== undefined && !Number.isFinite(start)) ||
      (end !== undefined && !Number.isFinite(end)) ||
      (start !== undefined && end !== undefined && end <= start)
    )
      throw new Error("Invalid vacation date range.");
    return api("/settings/vacation", "PUT", {
      enableAutoReply: body.enabled === true,
      responseSubject: typeof body.subject === "string" ? body.subject : "",
      responseBodyPlainText: typeof body.text === "string" ? body.text : "",
      restrictToContacts: body.contactsOnly === true,
      ...(body.startTime
        ? { startTime: String(Date.parse(String(body.startTime))) }
        : {}),
      ...(body.endTime
        ? { endTime: String(Date.parse(String(body.endTime))) }
        : {}),
    });
  }
  if (action === "gmailSignature")
    return api(
      `/settings/sendAs/${encodeURIComponent(text(body.email))}`,
      "PATCH",
      { signature: String(body.html ?? "") },
    );
  if (action === "googleContacts") {
    const result = await googleFetch(
      account,
      "https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=1000",
    );
    return (result.connections || []).flatMap(
      (p: {
        names?: { displayName: string }[];
        emailAddresses?: { value: string }[];
      }) =>
        (p.emailAddresses || []).map((e) => ({
          name: p.names?.[0]?.displayName || e.value,
          email: e.value,
        })),
    );
  }
  if (action === "googleCalendar")
    return googleFetch(
      account,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=30&timeMin=${encodeURIComponent(new Date().toISOString())}`,
    );
  if (action === "googleTasks")
    return googleFetch(
      account,
      "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=false&maxResults=100",
    );
  if (action === "googleAddTask")
    return googleFetch(
      account,
      "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks",
      "POST",
      {
        title: text(body.title),
        notes: String(body.notes ?? ""),
        ...(body.due ? { due: new Date(String(body.due)).toISOString() } : {}),
      },
    );
  if (action === "googleCompleteTask")
    return googleFetch(
      account,
      `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(text(body.id))}`,
      "PATCH",
      { status: "completed" },
    );
  throw new Error("Unsupported Google operation.");
}
