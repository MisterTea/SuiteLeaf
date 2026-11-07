import { uploadDriveChunks } from "./drive/upload-span";
import { createAuthClient } from "better-auth/client";
import {
  jwtClient,
  oneTimeTokenClient,
  usernameClient,
} from "better-auth/client/plugins";
import {
  mimeFor,
  parseNamedFile,
  type DriveLink,
  type FileRecord,
  type SuiteFile,
} from "@suiteleaf/core";
import type { AccessExplanation } from "./drive/access-explanation";
import {
  decideClientSession,
  idleSecsFromInfo,
  sessionEndFor,
  sessionTimes,
} from "./session-policy";
import {
  createInFolderOrRoot,
  DriveConflict,
  DriveRequestError,
  type AccountProfile,
  type AuthProviders,
  type DriveComment,
  type DriveFolder,
  type DriveItem,
  type DriveRole,
  type DriveSearchHit,
  type DriveSpreadsheet,
  type DriveVersion,
  type FilePresence,
  type ItemAccess,
  type NodeSession,
  type NodeUser,
  type ShareNotice,
} from "./node-client-types";

export * from "./node-client-types";
export * from "./node-sign-up";

const SESSION_KEY = "suiteleaf:node-session";
const listeners = new Set<(session: NodeSession | null) => void>();
let session: NodeSession | null = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    return raw?.url && raw?.token && raw?.user ? (raw as NodeSession) : null;
  } catch {
    return null;
  }
})();
let jwtCache: { token: string; expires: number } | null = null;
/** Why the last session ended, so the sign-in page can say so. */
let ended: "signed-out" | "expired" | "idle" | null = null;

export function getSession(now = new Date().toISOString()) {
  if (!session) return null;
  if (session.expiresAt !== undefined || session.idleSecs !== undefined) {
    const decision = decideClientSession({
      expiresAt: session.expiresAt,
      updatedAt: session.updatedAt,
      now,
      idleSecs: session.idleSecs,
    });
    const reason = sessionEndFor(decision);
    if (reason) {
      setSession(null, reason);
      return null;
    }
  }
  return session;
}
export function sessionEndReason() {
  return ended;
}
export function onSession(listener: (session: NodeSession | null) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
function setSession(next: NodeSession | null, reason: typeof ended = null) {
  session = next;
  ended = next ? null : reason;
  jwtCache = null;
  if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  else localStorage.removeItem(SESSION_KEY);
  for (const listener of listeners) listener(next);
}

function authClient(url: string, token?: string) {
  return createAuthClient({
    baseURL: `${url}/api/auth`,
    fetchOptions: token ? { auth: { type: "Bearer", token } } : undefined,
    plugins: [usernameClient(), jwtClient(), oneTimeTokenClient()],
  });
}

function failure(error: { message?: string; status?: number } | null) {
  return new Error(error?.message || "The node rejected the request.");
}

export async function providers(url: string): Promise<AuthProviders> {
  const response = await fetch(`${url}/api/auth/suiteleaf/providers`);
  if (!response.ok)
    throw new Error("This node does not offer sign-in. Check the address.");
  return response.json();
}

export async function signIn(
  url: string,
  identifier: string,
  password: string,
) {
  const client = authClient(url);
  const { data, error } = identifier.includes("@")
    ? await client.signIn.email({ email: identifier, password })
    : await client.signIn.username({ username: identifier, password });
  if (error || !data?.token) throw failure(error);
  return startSession(url, data.token, data.user, data);
}

export async function signUp(
  url: string,
  details: { name: string; email: string; username?: string; password: string },
  inviteToken?: string,
) {
  const { data, error } = await authClient(url).signUp.email(
    {
      ...details,
      username: details.username || undefined,
    },
    inviteToken
      ? { headers: { "x-suiteleaf-invite": inviteToken } }
      : undefined,
  );
  if (error || !data?.token) throw failure(error);
  return startSession(url, data.token, data.user, data);
}

/** Exchange the one-time token from a social sign-in hand-off. */
export async function completeHandoff(url: string, oneTimeToken: string) {
  const { data, error } = await authClient(url).oneTimeToken.verify({
    token: oneTimeToken,
  });
  if (error || !data?.session) throw failure(error);
  return startSession(url, data.session.token, data.user, data);
}

async function startSession(
  url: string,
  token: string,
  user: NodeUser,
  data: unknown,
): Promise<NodeSession> {
  let info: unknown = null;
  try {
    const response = await fetch(`${url}/api/node/info`);
    info = response.ok ? await response.json() : null;
  } catch {
    info = null;
  }
  setSession({
    url,
    token,
    user,
    ...sessionTimes(data),
    idleSecs: idleSecsFromInfo(info),
  });
  return session!;
}

const PENDING_KEY = "suiteleaf:pending-handoff";

/** The node page that starts a provider's sign-in and returns here. */
export function socialStartUrl(url: string, provider: string) {
  const back = location.href.split("#")[0];
  sessionStorage.setItem(PENDING_KEY, url);
  return `${url}/api/auth/suiteleaf/start?provider=${encodeURIComponent(provider)}&redirect=${encodeURIComponent(back)}`;
}

export function pendingHandoffUrl() {
  const url = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  return url;
}

/** A signed-out session the server may not have revoked yet. */
const SIGNING_OUT_KEY = "suiteleaf:signing-out";

async function revoke(pending: string) {
  const { url, token } = JSON.parse(pending) as NodeSession;
  // Disconnecting waits for this, so a server that never answers can't hold it up.
  await authClient(url, token)
    .signOut({ fetchOptions: { signal: AbortSignal.timeout(5000) } })
    .catch(() => {});
  if (localStorage.getItem(SIGNING_OUT_KEY) === pending)
    localStorage.removeItem(SIGNING_OUT_KEY);
}

export async function signOut() {
  const current = session;
  if (!current) return;
  const pending = JSON.stringify({ url: current.url, token: current.token });
  localStorage.setItem(SIGNING_OUT_KEY, pending);
  setSession(null, "signed-out");
  await revoke(pending);
}

/** Revoke a session whose sign-out the app closed before finishing. */
export async function finishSignOut() {
  const pending = localStorage.getItem(SIGNING_OUT_KEY);
  if (pending)
    await revoke(pending).catch(() => localStorage.removeItem(SIGNING_OUT_KEY));
}

function requireSession(): NodeSession {
  if (!session) throw new Error("Sign in to SuiteDrive first.");
  return session;
}

/** A short-lived JWT any node can verify; falls back to the session token
 * if this node's auth service is unavailable. */
export async function accessToken(): Promise<string> {
  return bearer(requireSession());
}

async function bearer(current: NodeSession): Promise<string> {
  if (jwtCache && jwtCache.expires - 60_000 > Date.now()) return jwtCache.token;
  await refreshSession(current);
  try {
    const response = await fetch(`${current.url}/api/auth/token`, {
      headers: { authorization: `Bearer ${current.token}` },
    });
    if (!response.ok) return current.token;
    const { token } = (await response.json()) as { token: string };
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp: number };
    jwtCache = { token, expires: payload.exp * 1000 };
    return token;
  } catch {
    return current.token;
  }
}

/** Renew the persistent cookie and keep the local expiry in step with the server. */
async function refreshSession(current: NodeSession): Promise<void> {
  let rejected = false;
  try {
    const response = await fetch(`${current.url}/api/auth/get-session`, {
      credentials: "include",
      headers: { authorization: `Bearer ${current.token}` },
    });
    rejected = response.status === 401;
    if (response.ok) {
      const data = await response.json();
      rejected = data === null;
      if (data?.session && data?.user && session === current) {
        setSession({ ...current, user: data.user, ...sessionTimes(data) });
      }
    }
  } catch {
    // Keep the existing session during an outage; the node can verify it directly.
  }
  if (session !== current && session?.token !== current.token) {
    throw new Error("Your SuiteDrive session ended. Sign in again.");
  }
  if (rejected) {
    setSession(null, "expired");
    throw new Error("Your SuiteDrive session ended. Sign in again.");
  }
}

export async function api(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const current = requireSession();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${await bearer(current)}`);
  let response: Response;
  try {
    response = await fetch(`${current.url}${path}`, { ...init, headers });
  } catch {
    throw new Error(
      "SuiteDrive is unreachable. Your changes stay on this device.",
    );
  }
  if (response.status === 401) {
    setSession(null, "expired");
    throw new Error("Your SuiteDrive session ended. Sign in again.");
  }
  if (!response.ok && response.status !== 409) {
    const body = await response.json().catch(() => ({}));
    throw new DriveRequestError(
      response.status,
      body.error ?? `SuiteDrive request failed (${response.status}).`,
    );
  }
  return response;
}

export const json = (body: unknown): RequestInit => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const drive = {
  async search(query: string): Promise<DriveSearchHit[]> {
    return (
      await (
        await api(`/api/drive/search?q=${encodeURIComponent(query)}`)
      ).json()
    ).hits;
  },
  /** Spreadsheets the signed-in person can read, including files inside folders. */
  async spreadsheets(): Promise<DriveSpreadsheet[]> {
    return (await (await api("/api/drive/spreadsheets")).json()).spreadsheets;
  },
  async list(parentId?: string | null): Promise<DriveItem[]> {
    const query = parentId ? `?parent=${encodeURIComponent(parentId)}` : "";
    return (await (await api(`/api/drive/items${query}`)).json()).items;
  },
  async shared(): Promise<DriveItem[]> {
    return (await (await api("/api/drive/items?shared=1")).json()).items;
  },
  async listTrashed(): Promise<DriveItem[]> {
    return (await (await api("/api/drive/trash")).json()).items;
  },
  /** Folders the signed-in person can edit, with enough to build a path. */
  async listFolders(): Promise<DriveFolder[]> {
    return (await (await api("/api/drive/folders")).json()).folders;
  },
  async deleteForever(id: string): Promise<void> {
    await api(`/api/drive/items/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
  async get(id: string): Promise<DriveItem> {
    return (await api(`/api/drive/items/${encodeURIComponent(id)}`)).json();
  },
  async create(item: {
    name: string;
    parentId?: string | null;
    kind: "file" | "folder";
    mime?: string;
  }): Promise<DriveItem> {
    return (
      await api("/api/drive/items", { method: "POST", ...json(item) })
    ).json();
  },
  async update(
    id: string,
    patch: { name?: string; parentId?: string | null; trashed?: boolean },
  ): Promise<DriveItem> {
    return (
      await api(`/api/drive/items/${encodeURIComponent(id)}`, {
        method: "PATCH",
        ...json(patch),
      })
    ).json();
  },
  async read(id: string): Promise<{ text: string; versionId?: string }> {
    const response = await api(
      `/api/drive/items/${encodeURIComponent(id)}/content`,
    );
    return {
      text: await response.text(),
      versionId: response.headers.get("etag")?.replace(/"/g, "") || undefined,
    };
  },
  async accounts(query: string): Promise<AccountProfile[]> {
    const response = await api(`/api/accounts?q=${encodeURIComponent(query)}`);
    return (await response.json()).accounts;
  },
  async searchGroups(query: string): Promise<{ id: string; name: string }[]> {
    const response = await api(
      `/api/drive/groups?q=${encodeURIComponent(query)}`,
    );
    return (await response.json()).groups;
  },
  async access(id: string): Promise<ItemAccess> {
    return (
      await api(`/api/drive/items/${encodeURIComponent(id)}/access`)
    ).json();
  },
  async explanation(id: string): Promise<AccessExplanation> {
    return (
      await api(`/api/drive/items/${encodeURIComponent(id)}/explanation`)
    ).json();
  },
  async share(
    id: string,
    principalId: string,
    role: Exclude<DriveRole, "owner"> | null,
    principalType: "user" | "group" | "org" = "user",
  ): Promise<void> {
    await api(`/api/drive/items/${encodeURIComponent(id)}/acl`, {
      method: "PUT",
      ...json({
        principalType,
        principalId,
        role,
      }),
    });
  },
  async notices(): Promise<ShareNotice[]> {
    return (await (await api("/api/drive/notices")).json()).notices;
  },
  async dismissNotice(id: string): Promise<void> {
    await api(`/api/drive/notices/${encodeURIComponent(id)}/dismiss`, {
      method: "POST",
    });
  },
  /** A new file the caller owns in My Drive, with the same name and bytes. */
  async keepCopy(id: string): Promise<DriveItem> {
    return (
      await api(`/api/drive/items/${encodeURIComponent(id)}/copy`, {
        method: "POST",
      })
    ).json();
  },
  /** End this person's access at `expiresAt`, or clear the end date with null. */
  async expire(
    id: string,
    principalId: string,
    expiresAt: string | null,
    principalType: "user" | "group" | "org" = "user",
  ): Promise<void> {
    await api(`/api/drive/items/${encodeURIComponent(id)}/expiry`, {
      method: "PUT",
      ...json({ principalId, principalType, expiresAt }),
    });
  },
  /** Make this person the owner now. The caller becomes an editor. */
  async transfer(id: string, userId: string): Promise<void> {
    await api(`/api/drive/items/${encodeURIComponent(id)}/owner`, {
      method: "POST",
      ...json({ userId }),
    });
  },
  async comments(id: string): Promise<DriveComment[]> {
    const response = await api(
      `/api/drive/items/${encodeURIComponent(id)}/comments`,
    );
    return (await response.json()).comments;
  },
  async comment(id: string, body: string): Promise<void> {
    await api(`/api/drive/items/${encodeURIComponent(id)}/comments`, {
      method: "POST",
      ...json({ body }),
    });
  },
  /** Other people whose open-file beat is still fresh. */
  async presence(id: string): Promise<FilePresence[]> {
    return (
      await (
        await api(`/api/drive/items/${encodeURIComponent(id)}/presence`)
      ).json()
    ).people;
  },
  /**
   * This computer has the file open. `editing` is true only while there are
   * unsaved local edits. It does not change the caller's role.
   */
  async reportPresence(id: string, editing: boolean): Promise<void> {
    await api(`/api/drive/items/${encodeURIComponent(id)}/presence`, {
      method: "POST",
      ...json({ editing }),
    });
  },
  async write(
    id: string,
    body: string,
    mime: string,
    ifMatch?: string,
  ): Promise<DriveItem> {
    const headers: Record<string, string> = { "content-type": mime };
    if (ifMatch) headers["if-match"] = `"${ifMatch}"`;
    const response = await api(
      `/api/drive/items/${encodeURIComponent(id)}/content`,
      { method: "PUT", headers, body },
    );
    const result = await response.json();
    if (response.status === 409) throw new DriveConflict(result.item);
    return result;
  },
  async versions(id: string): Promise<DriveVersion[]> {
    return (
      await (
        await api(`/api/drive/items/${encodeURIComponent(id)}/versions`)
      ).json()
    ).versions;
  },
  async readVersion(id: string, versionId: string): Promise<string> {
    return (
      await api(
        `/api/drive/items/${encodeURIComponent(id)}/content?version=${encodeURIComponent(versionId)}`,
      )
    ).text();
  },
  async nameVersion(
    id: string,
    versionId: string,
    name: string,
  ): Promise<DriveVersion> {
    return (
      await api(
        `/api/drive/items/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`,
        { method: "PATCH", ...json({ name }) },
      )
    ).json();
  },
  async restoreVersion(
    id: string,
    versionId: string,
    ifMatch?: string,
  ): Promise<DriveItem> {
    const headers: Record<string, string> = {};
    if (ifMatch) headers["if-match"] = `"${ifMatch}"`;
    const response = await api(
      `/api/drive/items/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`,
      { method: "POST", headers },
    );
    const result = await response.json();
    if (response.status === 409) throw new DriveConflict(result.item);
    return result;
  },
  async copyVersion(
    id: string,
    versionId: string,
    name: string,
  ): Promise<DriveItem> {
    return (
      await api(
        `/api/drive/items/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/copy`,
        { method: "POST", ...json({ name }) },
      )
    ).json();
  },
  /** A link that only adds a response. Creating again returns the same token. */
  async createRespondLink(id: string): Promise<{ token: string }> {
    return (
      await api(`/api/drive/items/${encodeURIComponent(id)}/respond-link`, {
        method: "POST",
      })
    ).json();
  },
  async clearRespondLink(id: string): Promise<void> {
    await api(`/api/drive/items/${encodeURIComponent(id)}/respond-link`, {
      method: "DELETE",
    });
  },
};

/** Load a SuiteDrive file into an editable record linked back to the drive. */
export async function openDriveFile(item: DriveItem): Promise<FileRecord> {
  const { url } = requireSession();
  const { text, versionId } = await drive.read(item.id);
  const file = parseNamedFile(item.name, text);
  return {
    file,
    drive: {
      nodeUrl: url,
      itemId: item.id,
      versionId,
      syncedAt: file.updatedAt,
      name: item.name,
    },
  };
}

let driveWrite: Promise<void> = Promise.resolve();

/** Run drive content writes one at a time so a restore cannot be overwritten
 * by a save that was already queued. */
export function withDriveLock<T>(task: () => Promise<T>): Promise<T> {
  const run = driveWrite.then(task, task);
  driveWrite = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function uploadDriveFileUnlocked(
  file: SuiteFile,
  link: DriveLink,
  onProgress?: (accepted: number, total: number) => void,
): Promise<DriveLink> {
  return uploadDriveChunks(file, link, onProgress);
}

/** Upload `file` as a new version. Throws [`DriveConflict`] if someone else
 * saved after `link.versionId`. */
export async function uploadDriveFile(
  file: SuiteFile,
  link: DriveLink,
  onProgress?: (accepted: number, total: number) => void,
): Promise<DriveLink> {
  return withDriveLock(() => uploadDriveFileUnlocked(file, link, onProgress));
}

export async function currentAccount(): Promise<NodeUser> {
  return (await api("/api/me")).json();
}

export interface AdminUser {
  id: string;
  name: string | null;
  email: string | null;
  username: string | null;
  role: string | null;
  banned: boolean;
  createdAt: string | null;
  groups?: string[];
}

export interface AdminDocument {
  at: string;
  action: "open" | "edit" | string;
  itemId: string;
  name: string;
}

export interface AdminSignIn {
  id: string;
  at: string;
  targetId: string;
  name: string;
}

export interface AdminSession {
  id: string;
  at: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AdminPerson {
  user: AdminUser;
  groups: { id: string; name: string | null }[];
  directGroupIds: string[];
  files: {
    id: string;
    name: string;
    size: number;
    via: string;
    groupName: string | null;
  }[];
  bytes: number;
  documents: AdminDocument[];
  signIns: AdminSignIn[];
  sessions: AdminSession[];
  changes: {
    id: string;
    at: string;
    actorId: string;
    action: string;
    name: string;
  }[];
}

export interface AdminGroup {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminGroupDetail {
  group: AdminGroup;
  members: { memberType: string; memberId: string; direct: boolean }[];
  people: string[];
  loopPresent: boolean;
}

export type ReplicationPeer = {
  peer: string;
  sameEpoch: boolean;
  behind: number;
};

export const adminApi = {
  async replication(): Promise<{ pending: number; peers: ReplicationPeer[] }> {
    return (await api("/api/admin/replication")).json();
  },
  async backup(): Promise<{
    configured: boolean;
    readable?: boolean;
    recordedAt?: string;
    contentCount?: number;
    drilledAt?: string;
    elapsedMs?: number | null;
    restoreTested?: boolean;
  }> {
    return (await api("/api/admin/backup")).json();
  },
  async organizationExport(): Promise<unknown> {
    return (await api("/api/admin/export")).json();
  },
  async users(query = "", group = ""): Promise<AdminUser[]> {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (group) params.set("group", group);
    const suffix = params.size ? `?${params}` : "";
    return (await (await api(`/api/admin/users${suffix}`)).json()).users;
  },
  async user(id: string): Promise<AdminPerson> {
    return (await api(`/api/admin/users/${encodeURIComponent(id)}`)).json();
  },
  async createUser(body: {
    name: string;
    email: string;
    password: string;
    username?: string;
    admin?: boolean;
  }): Promise<void> {
    await api("/api/admin/users", { method: "POST", ...json(body) });
  },
  async updateUser(
    id: string,
    body: { name?: string; email?: string; username?: string },
  ): Promise<AdminPerson> {
    return (
      await api(`/api/admin/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        ...json(body),
      })
    ).json();
  },
  async setRole(id: string, role: "admin" | "user"): Promise<AdminPerson> {
    return (
      await api(`/api/admin/users/${encodeURIComponent(id)}/role`, {
        method: "POST",
        ...json({ role }),
      })
    ).json();
  },
  async setBanned(id: string, banned: boolean): Promise<AdminPerson> {
    return (
      await api(`/api/admin/users/${encodeURIComponent(id)}/banned`, {
        method: "POST",
        ...json({ banned }),
      })
    ).json();
  },
  async setPassword(id: string, password: string): Promise<void> {
    await api(`/api/admin/users/${encodeURIComponent(id)}/password`, {
      method: "POST",
      ...json({ password }),
    });
  },
  async revokeSessions(id: string): Promise<void> {
    await api(`/api/admin/users/${encodeURIComponent(id)}/sessions`, {
      method: "DELETE",
    });
  },
  async removeUser(id: string, ownerId?: string): Promise<void> {
    await api(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: "DELETE",
      ...json({ ownerId: ownerId ?? null }),
    });
  },
  async groups(): Promise<AdminGroup[]> {
    return (await (await api("/api/admin/groups")).json()).groups;
  },
  async group(id: string): Promise<AdminGroupDetail> {
    return (await api(`/api/admin/groups/${encodeURIComponent(id)}`)).json();
  },
  async createGroup(name: string): Promise<AdminGroup> {
    return (
      await api("/api/admin/groups", { method: "POST", ...json({ name }) })
    ).json();
  },
  async renameGroup(id: string, name: string): Promise<AdminGroup> {
    return (
      await api(`/api/admin/groups/${encodeURIComponent(id)}`, {
        method: "PATCH",
        ...json({ name }),
      })
    ).json();
  },
  async deleteGroup(id: string): Promise<void> {
    await api(`/api/admin/groups/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
  async addMember(
    groupId: string,
    memberType: "user" | "group",
    memberId: string,
  ): Promise<AdminGroupDetail> {
    return (
      await api(`/api/admin/groups/${encodeURIComponent(groupId)}/members`, {
        method: "POST",
        ...json({ memberType, memberId }),
      })
    ).json();
  },
  async memberPlan(groupId: string, memberId: string, adding: boolean) {
    return (
      await api(
        `/api/admin/groups/${encodeURIComponent(groupId)}/member-plan`,
        {
          method: "POST",
          ...json({ memberId, adding }),
        },
      )
    ).json();
  },
  async editorPolicy() {
    return (await api("/api/admin/editor-policy")).json();
  },
  async applyEditorPolicy(stamp: string) {
    return (
      await api("/api/admin/editor-policy", {
        method: "POST",
        ...json({ stamp }),
      })
    ).json();
  },
  async removeMember(
    groupId: string,
    memberType: "user" | "group",
    memberId: string,
  ): Promise<AdminGroupDetail> {
    return (
      await api(`/api/admin/groups/${encodeURIComponent(groupId)}/members`, {
        method: "DELETE",
        ...json({ memberType, memberId }),
      })
    ).json();
  },
};

export async function saveNewDriveFile(
  file: SuiteFile,
  parentId: string | null,
  name: string,
  options?: { fallbackToRoot?: boolean; onProgress?: (accepted: number, total: number) => void },
): Promise<DriveLink> {
  const { url } = requireSession();
  const mime = mimeFor(file.kind);
  const create = (folderId: string | null) =>
    drive.create({
      name,
      parentId: folderId,
      kind: "file",
      mime,
    });
  const item = options?.fallbackToRoot
    ? await createInFolderOrRoot(parentId, create)
    : await create(parentId);
  return uploadDriveFile(file, {
    nodeUrl: url,
    itemId: item.id,
    name: item.name,
  }, options?.onProgress);
}
