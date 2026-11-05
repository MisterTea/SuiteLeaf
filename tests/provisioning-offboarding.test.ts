import { describe, expect, it } from "vitest";
import {
  ScimProvisioner,
  dryRunOffboarding,
  createOffboardingJob,
  executeOffboarding,
  generateAuditReceipt,
  type OffboardingStorageAdapter,
  type LegalHoldRecord,
} from "../packages/core/src";

function mockStorageAdapter(initialState?: {
  sessions?: string[];
  ownedFiles?: string[];
  holds?: LegalHoldRecord[];
}): OffboardingStorageAdapter & {
  sessions: string[];
  ownedFiles: string[];
  holds: LegalHoldRecord[];
  active: boolean;
  deleted: boolean;
  transfers: { fileId: string; from: string; to: string }[];
} {
  const state = {
    sessions: initialState?.sessions ?? ["session-web-1", "session-desktop-2"],
    ownedFiles: initialState?.ownedFiles ?? ["doc-quarterly", "sheet-budget", "slide-deck"],
    holds: initialState?.holds ?? [],
    active: true,
    deleted: false,
    transfers: [] as { fileId: string; from: string; to: string }[],
  };

  return {
    get sessions() {
      return state.sessions;
    },
    get ownedFiles() {
      return state.ownedFiles;
    },
    get holds() {
      return state.holds;
    },
    get active() {
      return state.active;
    },
    get deleted() {
      return state.deleted;
    },
    get transfers() {
      return state.transfers;
    },
    async getUserSessions() {
      return [...state.sessions];
    },
    async revokeUserSessions() {
      const count = state.sessions.length;
      state.sessions = [];
      return count;
    },
    async getOwnedFileIds() {
      return [...state.ownedFiles];
    },
    async transferFileOwnership(fileId: string, fromOwner: string, toOwner: string) {
      const idx = state.ownedFiles.indexOf(fileId);
      if (idx !== -1) {
        state.ownedFiles.splice(idx, 1);
        state.transfers.push({ fileId, from: fromOwner, to: toOwner });
      }
    },
    async deactivateUser() {
      state.active = false;
    },
    async deleteUserAccount() {
      state.deleted = true;
    },
    async getActiveLegalHolds() {
      return [...state.holds];
    },
  };
}

describe("WP-009 Provisioning and safe employee offboarding", () => {
  it("SCIM upserts are idempotent, preserve stable external IDs, and do not duplicate accounts or restore revoked access", () => {
    const scim = new ScimProvisioner();

    // 1. Initial provision
    const first = scim.upsertUser({
      externalId: "ext-emp-001",
      userName: "alice@example.com",
      displayName: "Alice Smith",
      active: true,
      emails: [{ value: "alice@example.com", primary: true }],
    });

    expect(first.created).toBe(true);
    expect(first.updated).toBe(false);
    expect(first.account.id).toBe("user-ext-emp-001");
    expect(first.account.active).toBe(true);

    // 2. Re-send identical SCIM user (idempotent - no duplicate created)
    const second = scim.upsertUser({
      externalId: "ext-emp-001",
      userName: "alice@example.com",
      displayName: "Alice Smith",
      active: true,
    });

    expect(second.created).toBe(false);
    expect(second.updated).toBe(true);
    expect(second.account.id).toBe(first.account.id);
    expect(scim.listUsers().totalResults).toBe(1);

    // 3. Deactivation via SCIM (active: false)
    const deact = scim.upsertUser({
      externalId: "ext-emp-001",
      userName: "alice@example.com",
      active: false,
    });
    expect(deact.account.active).toBe(false);

    // 4. Repeated deactivation remains deactivated
    const deactRepeat = scim.upsertUser({
      externalId: "ext-emp-001",
      userName: "alice@example.com",
      active: false,
    });
    expect(deactRepeat.account.active).toBe(false);
    expect(scim.listUsers().totalResults).toBe(1);

    // 5. Pagination
    for (let i = 2; i <= 5; i++) {
      scim.upsertUser({
        externalId: `ext-emp-00${i}`,
        userName: `user${i}@example.com`,
        active: true,
      });
    }
    const page1 = scim.listUsers(1, 3);
    expect(page1.totalResults).toBe(5);
    expect(page1.Resources).toHaveLength(3);
    expect(page1.startIndex).toBe(1);

    const page2 = scim.listUsers(4, 3);
    expect(page2.Resources).toHaveLength(2);
  });

  it("dry-run accurately inventories owned files, active sessions, and detects active legal holds", async () => {
    const adapter = mockStorageAdapter({
      ownedFiles: ["file-1", "file-2"],
      sessions: ["session-1"],
      holds: [
        {
          holdId: "hold-litigation-2026",
          userId: "user-departing-123",
          active: true,
          matter: "SEC Regulatory Inquiry 2026",
          placedBy: "legal-counsel@example.com",
        },
      ],
    });

    const dryRun = await dryRunOffboarding("user-departing-123", "sam@example.com", adapter);

    expect(dryRun.userId).toBe("user-departing-123");
    expect(dryRun.inventory.ownedFileIds).toEqual(["file-1", "file-2"]);
    expect(dryRun.inventory.activeSessions).toEqual(["session-1"]);
    expect(dryRun.requiresSuccessor).toBe(true);
    expect(dryRun.holdActive).toBe(true);
    expect(dryRun.holdDetails).toContain("SEC Regulatory Inquiry 2026");
    expect(dryRun.proposedActions.some((a) => a.includes("HOLD NOTICE"))).toBe(true);
  });

  it("resumes an interrupted offboarding job safely and proves all files reach successor owner", async () => {
    const adapter = mockStorageAdapter({
      ownedFiles: ["doc-roadmap", "sheet-financials"],
      sessions: ["sess-mac", "sess-phone"],
    });

    // Attempting to create job without explicit destination owner throws
    expect(() =>
      createOffboardingJob({
        userId: "departed-sam",
        userEmail: "sam@example.com",
        destinationOwnerId: "",
        initiatedBy: "admin-rosa",
      }),
    ).toThrow("destination owner is required");

    // Attempting to transfer to self throws
    expect(() =>
      createOffboardingJob({
        userId: "departed-sam",
        userEmail: "sam@example.com",
        destinationOwnerId: "departed-sam",
        initiatedBy: "admin-rosa",
      }),
    ).toThrow("Destination owner must be different");

    const job = createOffboardingJob({
      userId: "departed-sam",
      userEmail: "sam@example.com",
      destinationOwnerId: "successor-priya",
      initiatedBy: "admin-rosa",
    });

    // Simulate interruption: run first step only (suspend)
    job.currentStep = "suspend";
    await executeOffboarding(job, adapter);

    // Verify session revoked and user deactivated
    expect(adapter.sessions).toEqual([]);
    expect(adapter.active).toBe(false);

    // Verify job reached completion across remaining steps
    expect(job.status).toBe("completed");
    expect(job.verificationPassed).toBe(true);
    expect(job.transferredFileIds).toEqual(["doc-roadmap", "sheet-financials"]);
    expect(adapter.transfers).toEqual([
      { fileId: "doc-roadmap", from: "departed-sam", to: "successor-priya" },
      { fileId: "sheet-financials", from: "departed-sam", to: "successor-priya" },
    ]);
    expect(adapter.ownedFiles).toEqual([]); // 0 remaining owned records for sam

    // Generate downloadable audit receipt
    const receipt = generateAuditReceipt(job);
    expect(receipt.departedUserId).toBe("departed-sam");
    expect(receipt.destinationOwnerId).toBe("successor-priya");
    expect(receipt.transferredCount).toBe(2);
    expect(receipt.verificationPassed).toBe(true);
    expect(receipt.sha256Signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("blocks final deletion when an active legal hold exists (fails closed)", async () => {
    const adapter = mockStorageAdapter({
      ownedFiles: ["file-evidence"],
      sessions: ["sess-1"],
      holds: [
        {
          holdId: "hold-audit-77",
          userId: "departed-hold-user",
          active: true,
          matter: "Internal Audit 2026",
          placedBy: "compliance@example.com",
        },
      ],
    });

    const job = createOffboardingJob({
      userId: "departed-hold-user",
      userEmail: "hold@example.com",
      destinationOwnerId: "successor-dan",
      initiatedBy: "admin-rosa",
    });

    // Execute with allowFinalDeletion=true
    const result = await executeOffboarding(job, adapter, { allowFinalDeletion: true });

    // Job must be blocked due to legal hold, and user account deletion must NOT happen!
    expect(result.status).toBe("blocked");
    expect(result.blockedReason).toContain("Legal hold active: 'Internal Audit 2026'");
    expect(result.deletionPermitted).toBe(false);
    expect(adapter.deleted).toBe(false);

    // Files were still safely transferred to successor to prevent abandonment
    expect(result.transferredFileIds).toEqual(["file-evidence"]);
    expect(adapter.ownedFiles).toEqual([]);

    // Audit receipt records held state
    const receipt = generateAuditReceipt(result);
    expect(receipt.holdCheckStatus).toBe("HELD_PRESERVED");
  });
});
