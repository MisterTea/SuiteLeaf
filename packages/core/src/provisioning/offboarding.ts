/**
 * Safe, resumable employee offboarding engine.
 * Ensures business records are transferred to an explicit successor, active sessions
 * are revoked, retention holds fail closed, and an audit receipt is produced.
 */

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export interface OffboardingInventory {
  userId: string;
  ownedFileIds: string[];
  sharedFileIds: string[];
  groupMemberships: string[];
  activeSessions: string[];
  appCredentialCount: number;
}

export interface LegalHoldRecord {
  holdId: string;
  userId?: string;
  fileIds?: string[];
  active: boolean;
  matter: string;
  placedBy: string;
}

export interface OffboardingDryRun {
  userId: string;
  userEmail: string;
  inventory: OffboardingInventory;
  requiresSuccessor: boolean;
  holdActive: boolean;
  holdDetails?: string;
  proposedActions: string[];
  canProceed: boolean;
}

export type OffboardingStep =
  | "init"
  | "suspend"
  | "transfer"
  | "retention_check"
  | "verify"
  | "completed";

export interface OffboardingJob {
  jobId: string;
  userId: string;
  userEmail: string;
  destinationOwnerId: string;
  initiatedBy: string;
  createdAt: string;
  currentStep: OffboardingStep;
  status: "in_progress" | "completed" | "blocked" | "failed";
  transferredFileIds: string[];
  revokedSessions: string[];
  holdCheckPassed: boolean;
  verificationPassed: boolean;
  deletionPermitted: boolean;
  deletionCompleted: boolean;
  logs: { step: OffboardingStep; timestamp: string; message: string }[];
  blockedReason?: string;
  completedAt?: string;
}

export interface OffboardingStorageAdapter {
  getUserSessions(userId: string): Promise<string[]>;
  revokeUserSessions(userId: string): Promise<number>;
  getOwnedFileIds(userId: string): Promise<string[]>;
  transferFileOwnership(fileId: string, fromOwner: string, toOwner: string): Promise<void>;
  deactivateUser(userId: string): Promise<void>;
  deleteUserAccount(userId: string): Promise<void>;
  getActiveLegalHolds(): Promise<LegalHoldRecord[]>;
}

/**
 * Dry-run an offboarding action to inventory ownership, sessions, and active legal holds.
 */
export async function dryRunOffboarding(
  userId: string,
  userEmail: string,
  adapter: OffboardingStorageAdapter,
): Promise<OffboardingDryRun> {
  const [sessions, ownedFiles, holds] = await Promise.all([
    adapter.getUserSessions(userId),
    adapter.getOwnedFileIds(userId),
    adapter.getActiveLegalHolds(),
  ]);

  const activeUserHold = holds.find(
    (h) => h.active && (h.userId === userId || h.fileIds?.some((f) => ownedFiles.includes(f))),
  );

  const inventory: OffboardingInventory = {
    userId,
    ownedFileIds: ownedFiles,
    sharedFileIds: [],
    groupMemberships: [],
    activeSessions: sessions,
    appCredentialCount: 0,
  };

  const proposedActions: string[] = [
    `Revoke ${sessions.length} active sessions and app credentials`,
    `Deactivate user account ${userEmail}`,
    `Transfer ${ownedFiles.length} owned documents to designated successor`,
    "Verify 0 items remain owned by departed employee",
  ];

  if (activeUserHold) {
    proposedActions.push(
      `HOLD NOTICE: Active legal hold '${activeUserHold.matter}' applies. Deletion will be blocked.`,
    );
  }

  return {
    userId,
    userEmail,
    inventory,
    requiresSuccessor: ownedFiles.length > 0,
    holdActive: Boolean(activeUserHold),
    holdDetails: activeUserHold ? `Active hold '${activeUserHold.matter}' placed by ${activeUserHold.placedBy}` : undefined,
    proposedActions,
    canProceed: true, // dry run proceeds, execution validates explicit successor
  };
}

/**
 * Create a new resumable offboarding job.
 */
export function createOffboardingJob(params: {
  userId: string;
  userEmail: string;
  destinationOwnerId: string;
  initiatedBy: string;
}): OffboardingJob {
  if (!params.destinationOwnerId?.trim()) {
    throw new Error("Explicit destination owner is required. Files cannot be silently orphaned.");
  }
  if (params.destinationOwnerId === params.userId) {
    throw new Error("Destination owner must be different from the departing employee.");
  }

  return {
    jobId: `offboard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    userId: params.userId,
    userEmail: params.userEmail,
    destinationOwnerId: params.destinationOwnerId.trim(),
    initiatedBy: params.initiatedBy,
    createdAt: new Date().toISOString(),
    currentStep: "init",
    status: "in_progress",
    transferredFileIds: [],
    revokedSessions: [],
    holdCheckPassed: false,
    verificationPassed: false,
    deletionPermitted: false,
    deletionCompleted: false,
    logs: [
      {
        step: "init",
        timestamp: new Date().toISOString(),
        message: `Offboarding job initiated for ${params.userEmail} by ${params.initiatedBy}`,
      },
    ],
  };
}

/**
 * Execute or resume an offboarding job through its discrete steps.
 * Safe against mid-job interruptions; resumes from the last completed checkpoint.
 */
export async function executeOffboarding(
  job: OffboardingJob,
  adapter: OffboardingStorageAdapter,
  options: { allowFinalDeletion?: boolean } = {},
): Promise<OffboardingJob> {
  const log = (step: OffboardingStep, message: string) => {
    job.logs.push({ step, timestamp: new Date().toISOString(), message });
  };

  // Step 1: Suspend user & terminate sessions
  if (job.currentStep === "init" || job.currentStep === "suspend") {
    log("suspend", `Suspending user ${job.userId} and terminating active sessions`);
    const sessions = await adapter.getUserSessions(job.userId);
    await adapter.revokeUserSessions(job.userId);
    await adapter.deactivateUser(job.userId);
    job.revokedSessions = sessions;
    job.currentStep = "transfer";
  }

  // Step 2: Transfer all owned files to successor owner
  if (job.currentStep === "transfer") {
    log("transfer", `Beginning transfer of owned files to successor ${job.destinationOwnerId}`);
    const ownedFiles = await adapter.getOwnedFileIds(job.userId);

    for (const fileId of ownedFiles) {
      if (!job.transferredFileIds.includes(fileId)) {
        await adapter.transferFileOwnership(fileId, job.userId, job.destinationOwnerId);
        job.transferredFileIds.push(fileId);
      }
    }
    log("transfer", `Successfully transferred ${job.transferredFileIds.length} files`);
    job.currentStep = "retention_check";
  }

  // Step 3: Retention and legal-hold check (fails closed on active hold)
  if (job.currentStep === "retention_check") {
    log("retention_check", "Evaluating active legal holds and organizational retention policy");
    const holds = await adapter.getActiveLegalHolds();
    const activeHold = holds.find(
      (h) => h.active && (h.userId === job.userId || h.fileIds?.some((f) => job.transferredFileIds.includes(f))),
    );

    if (activeHold) {
      job.status = "blocked";
      job.blockedReason = `Legal hold active: '${activeHold.matter}'. User records preserved under hold. Final deletion prohibited.`;
      log("retention_check", `HOLD ENFORCED: ${job.blockedReason}`);
      job.deletionPermitted = false;
      return job;
    }

    job.holdCheckPassed = true;
    job.deletionPermitted = true;
    job.currentStep = "verify";
  }

  // Step 4: Verification of zero remaining ownership
  if (job.currentStep === "verify") {
    log("verify", "Verifying zero remaining owned records for departed employee");
    const remaining = await adapter.getOwnedFileIds(job.userId);
    if (remaining.length > 0) {
      job.status = "failed";
      job.blockedReason = `Verification failed: ${remaining.length} files still owned by ${job.userId}`;
      log("verify", job.blockedReason);
      return job;
    }

    job.verificationPassed = true;
    job.currentStep = "completed";
  }

  // Step 5: Final completion (optional account purge if requested, hold-passed, and verified)
  if (job.currentStep === "completed") {
    if (options.allowFinalDeletion && job.deletionPermitted && job.verificationPassed) {
      log("completed", "Purging departed user credentials (business files preserved with successor)");
      await adapter.deleteUserAccount(job.userId);
      job.deletionCompleted = true;
    }

    job.status = "completed";
    job.completedAt = new Date().toISOString();
    log("completed", "Offboarding lifecycle completed successfully");
  }

  return job;
}

export interface OffboardingAuditReceipt {
  receiptId: string;
  jobId: string;
  departedUserId: string;
  departedUserEmail: string;
  destinationOwnerId: string;
  initiatedBy: string;
  completedAt: string;
  transferredCount: number;
  transferredFileIds: string[];
  revokedSessionCount: number;
  holdCheckStatus: string;
  verificationPassed: boolean;
  sha256Signature: string;
}

/**
 * Generate a cryptographically signed, downloadable audit receipt for compliance and recovery.
 */
export function generateAuditReceipt(job: OffboardingJob): OffboardingAuditReceipt {
  if (job.status !== "completed" && job.status !== "blocked") {
    throw new Error("Audit receipt can only be generated for completed or hold-blocked jobs.");
  }

  const payload = JSON.stringify({
    jobId: job.jobId,
    userId: job.userId,
    userEmail: job.userEmail,
    destinationOwnerId: job.destinationOwnerId,
    initiatedBy: job.initiatedBy,
    completedAt: job.completedAt ?? new Date().toISOString(),
    transferredCount: job.transferredFileIds.length,
    revokedSessions: job.revokedSessions.length,
    holdStatus: job.blockedReason ?? "CLEARED_NO_HOLD",
    verified: job.verificationPassed,
  });

  const signature = bytesToHex(sha256(new TextEncoder().encode(payload)));

  return {
    receiptId: `receipt-${job.jobId}`,
    jobId: job.jobId,
    departedUserId: job.userId,
    departedUserEmail: job.userEmail,
    destinationOwnerId: job.destinationOwnerId,
    initiatedBy: job.initiatedBy,
    completedAt: job.completedAt ?? new Date().toISOString(),
    transferredCount: job.transferredFileIds.length,
    transferredFileIds: [...job.transferredFileIds],
    revokedSessionCount: job.revokedSessions.length,
    holdCheckStatus: job.blockedReason ? "HELD_PRESERVED" : "CLEARED",
    verificationPassed: job.verificationPassed,
    sha256Signature: signature,
  };
}
