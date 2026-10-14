import { createAuthClient } from "better-auth/client";
import {
  jwtClient,
  oneTimeTokenClient,
  usernameClient,
} from "better-auth/client/plugins";
import {
  mimeFor,
  nativeFilename,
  parseNamedFile,
  serializeFile,
  type DriveLink,
  type FileRecord,
  type SuiteFile,
} from "@suiteleaf/core";

export interface NodeUser {
  id: string;
  email?: string | null;
  name?: string | null;
  username?: string | null;
  role?: string | null;
}
/** Authentication uses bearer tokens so the same flow works when the app is
 * served by the node, hosted elsewhere, or running in Electron. */
export interface NodeSession {
  url: string;
  token: string;
  user: NodeUser;
}
export interface DriveVersion {
  id: string;
  itemId: string;
  contentHash: string;
  size: number;
  authorId: string;
  authorName: string;
  createdAt: string;
  name: string | null;
  restoredFrom: string | null;
}
export interface DriveFolder {
  id: string;
  name: string;
  parentId: string | null;
}
export interface DriveItem {
  id: string;
  parentId: string | null;
  name: string;
  kind: "file" | "folder";
  ownerId: string;
  mime: string | null;
  size: number;
  headVersionId: string | null;
  contentHash: string | null;
  createdAt: string;
  updatedAt: string;
  trashed: boolean;
  role: DriveRole | null;
  /** Display name of the owner, when the server includes it (shared lists). */
  ownerName?: string | null;
  /** Parent folder name when this item is in a folder. */
  parentName?: string | null;
  /** Head version author. Not the owner, and absent for folders. */
  lastAuthorId?: string | null;
  lastAuthorName?: string | null;
  /** When that head version was written. Same instant version history shows. */
  lastEditedAt?: string | null;
  available: boolean;
}

/** A SuiteDrive file found by the words in its name or its contents. */
export interface DriveSearchHit {
  id: string;
  name: string;
  /** Parent folder name, or "My Drive" at the top. */
  parentName: string;
  snippet: string;
}
/** A `.slsheet` the signed-in person can read. The bytes are not included. */
export interface DriveSpreadsheet {
  id: string;
  name: string;
  /** Parent folder name, or "My Drive" at the top. */
  parentName: string;
}
export type DriveRole =
  "viewer" | "commenter" | "responder" | "editor" | "owner";
export interface AccountProfile {
  id: string;
  name: string | null;
  email: string | null;
  username: string | null;
}
export interface AccessGrant {
  principalType: "user" | "org" | "owner";
  principalId: string;
  role: DriveRole;
  name: string | null;
  email: string | null;
  inheritedFrom: { id: string; name: string } | null;
  /** When this grant stops opening the file. Null means it does not expire. */
  expiresAt?: string | null;
  /** The end time has passed. The owner can still see the row and remove it. */
  expired?: boolean;
}
export interface DriveComment {
  id: string;
  itemId: string;
  authorId: string;
  body: string;
  createdAt: string;
}
/** Someone else with this file open. The caller is never included. */
export interface FilePresence {
  name: string;
  editing: boolean;
}
export interface ItemAccess {
  grants: AccessGrant[];
  parent: { id: string; name: string } | null;
  yourRole: DriveRole;
}
export interface ShareNotice {
  id: string;
  itemId: string;
  itemName: string;
  sharerId: string;
  sharerName: string | null;
  role: DriveRole;
  createdAt: string;
}
export interface AuthProviders {
  emailAndPassword: boolean;
  username: boolean;
  providers: string[];
}

export class DriveConflict extends Error {
  constructor(public item: DriveItem) {
    super("This file was changed in SuiteDrive after you opened it.");
  }
}

/** A SuiteDrive response that is not success and not a save conflict. */
export class DriveRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DriveRequestError";
  }
}

/** The folder refused a new file: no access, or it is gone. */
export function cannotCreateInFolder(error: unknown): boolean {
  return (
    error instanceof DriveRequestError &&
    (error.status === 403 || error.status === 404)
  );
}

/**
 * Run `create` in `parentId`. When that folder cannot take a new file,
 * run it again at My Drive (`null`).
 */
export async function createInFolderOrRoot<T>(
  parentId: string | null,
  create: (parentId: string | null) => Promise<T>,
): Promise<T> {
  try {
    return await create(parentId);
  } catch (error) {
    if (parentId && cannotCreateInFolder(error)) return create(null);
    throw error;
  }
}

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
let ended: "signed-out" | "expired" | null = null;

export function getSession() {
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
  setSession({ url, token: data.token, user: data.user });
  return session!;
}

export async function signUp(
  url: string,
  details: { name: string; email: string; username?: string; password: string },
) {
  const { data, error } = await authClient(url).signUp.email({
    ...details,
    username: details.username || undefined,
  });
  if (error || !data?.token) throw failure(error);
  setSession({ url, token: data.token, user: data.user });
  return session!;
}

/** Exchange the one-time token from a social sign-in hand-off. */
export async function completeHandoff(url: string, oneTimeToken: string) {
  const { data, error } = await authClient(url).oneTimeToken.verify({
    token: oneTimeToken,
  });
  if (error || !data?.session) throw failure(error);
  setSession({ url, token: data.session.token, user: data.user });
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

async function api(path: string, init: RequestInit = {}): Promise<Response> {
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

const json = (body: unknown): RequestInit => ({
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
  async access(id: string): Promise<ItemAccess> {
    return (
      await api(`/api/drive/items/${encodeURIComponent(id)}/access`)
    ).json();
  },
  async share(
    id: string,
    principalId: string,
    role: Exclude<DriveRole, "owner"> | null,
  ): Promise<void> {
    await api(`/api/drive/items/${encodeURIComponent(id)}/acl`, {
      method: "PUT",
      ...json({
        principalType: "user",
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
  ): Promise<void> {
    await api(`/api/drive/items/${encodeURIComponent(id)}/expiry`, {
      method: "PUT",
      ...json({ principalId, expiresAt }),
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

export interface PublicQuestion {
  id: string;
  prompt: string;
  kind: "text" | "choice";
  required: boolean;
  choices?: string[];
}

export interface PublicForm {
  title: string;
  questions: PublicQuestion[];
}

/** The sign-up page. These requests do not send a SuiteLeaf session. */
export async function loadSignUp(token: string): Promise<PublicForm> {
  const response = await fetch(
    `${location.origin}/api/respond/${encodeURIComponent(token)}`,
  );
  if (!response.ok) throw new Error("closed");
  return response.json();
}

export async function submitSignUp(
  token: string,
  answers: Record<string, string>,
): Promise<void> {
  const response = await fetch(
    `${location.origin}/api/respond/${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers }),
    },
  );
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  if (response.status === 400 && body.error) throw new Error(body.error);
  throw new Error("closed");
}

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
): Promise<DriveLink> {
  let item = await drive.write(
    link.itemId,
    serializeFile(file),
    mimeFor(file.kind),
    link.versionId,
  );
  // A SuiteDrive file is named after its title, like a cloud document.
  const name = nativeFilename(file);
  if (item.name !== name) item = await drive.update(link.itemId, { name });
  return {
    ...link,
    versionId: item.headVersionId ?? undefined,
    syncedAt: file.updatedAt,
    name: item.name,
  };
}

/** Upload `file` as a new version. Throws [`DriveConflict`] if someone else
 * saved after `link.versionId`. */
export async function uploadDriveFile(
  file: SuiteFile,
  link: DriveLink,
): Promise<DriveLink> {
  return withDriveLock(() => uploadDriveFileUnlocked(file, link));
}

export async function saveNewDriveFile(
  file: SuiteFile,
  parentId: string | null,
  name: string,
  options?: { fallbackToRoot?: boolean },
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
  });
}
