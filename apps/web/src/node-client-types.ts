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
  /** Absolute end from the sign-in payload, when it includes one. */
  expiresAt?: string;
  /** Last activity from the sign-in payload, when it includes one. */
  updatedAt?: string;
  /** Organization idle limit in seconds from `/api/node/info`. */
  idleSecs?: number;
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
  kind?: "user" | "group";
}
export interface AccessGrant {
  principalType: "user" | "group" | "org" | "owner";
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
  /** The last beat is quiet, and this person is still listed. */
  idle?: boolean;
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
  inviteOnly?: boolean;
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
