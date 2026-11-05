/**
 * SCIM 2.0 User and Group provisioning engine.
 * Implements idempotent upserts, stable external IDs, deactivation, pagination,
 * and reconciliation without duplicating accounts or accidentally restoring revoked access.
 */

export interface ScimEmail {
  value: string;
  type?: string;
  primary?: boolean;
}

export interface ScimUserResource {
  schemas?: string[];
  id?: string;
  externalId: string;
  userName: string;
  displayName?: string;
  emails?: ScimEmail[];
  active: boolean;
  meta?: {
    resourceType?: string;
    created?: string;
    lastModified?: string;
    version?: string;
  };
}

export interface ScimGroupMember {
  value: string; // user id
  display?: string;
}

export interface ScimGroupResource {
  schemas?: string[];
  id?: string;
  externalId: string;
  displayName: string;
  members?: ScimGroupMember[];
}

export interface ScimListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface LocalAccount {
  id: string;
  externalId: string;
  email: string;
  displayName: string;
  active: boolean;
  role: "admin" | "member" | "viewer";
  groups: string[];
  updatedAt: string;
}

export interface ScimReconciliationReport {
  timestamp: string;
  totalIncoming: number;
  totalLocal: number;
  matched: number;
  created: number;
  updated: number;
  deactivated: number;
  orphanedLocals: string[]; // local accounts with no incoming SCIM mapping
}

export class ScimProvisioner {
  private accounts = new Map<string, LocalAccount>(); // id -> LocalAccount
  private externalIndex = new Map<string, string>(); // externalId -> id
  private groups = new Map<string, ScimGroupResource>(); // id -> ScimGroupResource
  private groupExternalIndex = new Map<string, string>();

  /**
   * Idempotent SCIM User Upsert.
   * Matches by stable externalId first. Does not allow mutable email alone to hijack an existing account.
   */
  upsertUser(incoming: ScimUserResource): { account: LocalAccount; created: boolean; updated: boolean } {
    if (!incoming.externalId || !incoming.externalId.trim()) {
      throw new Error("SCIM user must have a non-empty externalId");
    }

    const primaryEmail =
      incoming.emails?.find((e) => e.primary)?.value ??
      incoming.emails?.[0]?.value ??
      incoming.userName;

    if (!primaryEmail || !primaryEmail.includes("@")) {
      throw new Error("SCIM user must have a valid email address");
    }

    const existingId = this.externalIndex.get(incoming.externalId);
    const now = new Date().toISOString();

    if (existingId) {
      const current = this.accounts.get(existingId)!;
      // Do not allow re-activating if explicitly revoked unless explicitly active in incoming
      const nextActive = incoming.active;
      const updatedAccount: LocalAccount = {
        ...current,
        email: primaryEmail,
        displayName: incoming.displayName ?? current.displayName,
        active: nextActive,
        updatedAt: now,
      };
      this.accounts.set(existingId, updatedAccount);
      return { account: updatedAccount, created: false, updated: true };
    }

    // Create new account with stable ID
    const newId = incoming.id ?? `user-${incoming.externalId}`;
    const newAccount: LocalAccount = {
      id: newId,
      externalId: incoming.externalId,
      email: primaryEmail,
      displayName: incoming.displayName ?? incoming.userName,
      active: incoming.active,
      role: "member",
      groups: [],
      updatedAt: now,
    };

    this.accounts.set(newId, newAccount);
    this.externalIndex.set(incoming.externalId, newId);
    return { account: newAccount, created: true, updated: false };
  }

  /**
   * Idempotent SCIM Group Upsert.
   */
  upsertGroup(incoming: ScimGroupResource): { group: ScimGroupResource; created: boolean } {
    if (!incoming.externalId?.trim()) {
      throw new Error("SCIM group must have a non-empty externalId");
    }

    const existingId = this.groupExternalIndex.get(incoming.externalId);
    if (existingId) {
      const current = this.groups.get(existingId)!;
      const updated: ScimGroupResource = {
        ...current,
        displayName: incoming.displayName,
        members: incoming.members ? [...incoming.members] : current.members,
      };
      this.groups.set(existingId, updated);
      return { group: updated, created: false };
    }

    const newId = incoming.id ?? `grp-${incoming.externalId}`;
    const newGroup: ScimGroupResource = {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: newId,
      externalId: incoming.externalId,
      displayName: incoming.displayName,
      members: incoming.members ? [...incoming.members] : [],
    };

    this.groups.set(newId, newGroup);
    this.groupExternalIndex.set(incoming.externalId, newId);
    return { group: newGroup, created: true };
  }

  /**
   * Retrieve SCIM paginated users list.
   */
  listUsers(startIndex = 1, count = 50): ScimListResponse<ScimUserResource> {
    const all = Array.from(this.accounts.values());
    const totalResults = all.length;
    const startIdx = Math.max(1, startIndex) - 1;
    const slice = all.slice(startIdx, startIdx + count);

    const Resources: ScimUserResource[] = slice.map((acc) => ({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: acc.id,
      externalId: acc.externalId,
      userName: acc.email,
      displayName: acc.displayName,
      active: acc.active,
      emails: [{ value: acc.email, primary: true }],
      meta: {
        resourceType: "User",
        lastModified: acc.updatedAt,
      },
    }));

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults,
      startIndex,
      itemsPerPage: Resources.length,
      Resources,
    };
  }

  getAccount(id: string): LocalAccount | undefined {
    return this.accounts.get(id);
  }

  getByExternalId(externalId: string): LocalAccount | undefined {
    const id = this.externalIndex.get(externalId);
    return id ? this.accounts.get(id) : undefined;
  }

  /**
   * Reconcile external identity list with local accounts.
   */
  reconcile(incomingUsers: ScimUserResource[]): ScimReconciliationReport {
    let created = 0;
    let updated = 0;
    let deactivated = 0;
    let matched = 0;

    const incomingExternals = new Set(incomingUsers.map((u) => u.externalId));

    for (const user of incomingUsers) {
      const isExisting = this.externalIndex.has(user.externalId);
      const res = this.upsertUser(user);
      if (res.created) created += 1;
      if (res.updated) {
        updated += 1;
        matched += 1;
        if (!user.active && res.account.active === false) {
          deactivated += 1;
        }
      }
    }

    const orphanedLocals: string[] = [];
    for (const [id, acc] of this.accounts.entries()) {
      if (!incomingExternals.has(acc.externalId)) {
        orphanedLocals.push(id);
      }
    }

    return {
      timestamp: new Date().toISOString(),
      totalIncoming: incomingUsers.length,
      totalLocal: this.accounts.size,
      matched,
      created,
      updated,
      deactivated,
      orphanedLocals,
    };
  }
}
