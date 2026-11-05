import type { FileRecord } from "../file-schema";

export function hasUnsyncedEdits(record: FileRecord): boolean {
  return !!record.drive && record.drive.syncedAt !== record.file.updatedAt;
}

export interface OfflinePolicy {
  requireAuthentication: boolean;
  maxOfflineHours: number;
  allowOfflineExport: boolean;
  preventSilentDeletion: boolean;
}

export interface OfflineLease {
  userId: string;
  leaseExpiresAt: string;
  lastAuthenticatedAt: string;
  policy: OfflinePolicy;
}

export interface OfflinePolicyDecision {
  allowed: boolean;
  action: "allow-edit" | "require-auth" | "read-only" | "unsynced-preserved";
  reason: string;
  unsyncedEditsRetained: boolean;
  notice: string;
}

/**
 * Evaluate managed offline policy decisions.
 * Enforces policy leases while NEVER silently deleting unuploaded local edits.
 */
export function evaluateOfflinePolicy(
  record: FileRecord,
  lease?: OfflineLease | null,
  now: Date = new Date(),
): OfflinePolicyDecision {
  // 1. Unmanaged ordinary local file
  if (!record.drive) {
    return {
      allowed: true,
      action: "allow-edit",
      reason: "Unmanaged local file. Full offline editing allowed with no account requirement.",
      unsyncedEditsRetained: false,
      notice: "",
    };
  }

  // 2. Managed file without authentication lease
  if (!lease) {
    const hasEdits = hasUnsyncedEdits(record);
    return {
      allowed: false,
      action: hasEdits ? "unsynced-preserved" : "require-auth",
      reason: "Managed enterprise file requires active offline lease.",
      unsyncedEditsRetained: hasEdits,
      notice: hasEdits
        ? "Offline lease missing. Your unsynchronized local changes are preserved safely on this device. Sign in to upload."
        : "Sign in to open or edit managed files offline.",
    };
  }

  // 3. Managed file with lease
  const expiresAt = new Date(lease.leaseExpiresAt);
  const isExpired = now.getTime() > expiresAt.getTime();

  if (isExpired) {
    const hasEdits = hasUnsyncedEdits(record);
    return {
      allowed: false,
      action: hasEdits ? "unsynced-preserved" : "require-auth",
      reason: `Offline lease expired at ${lease.leaseExpiresAt}.`,
      unsyncedEditsRetained: hasEdits,
      notice: hasEdits
        ? "Your offline lease has expired. All unsynchronized edits remain safely preserved on this device and cannot be silently discarded. Please re-authenticate to synchronize."
        : "Your offline lease has expired. Re-authenticate to access this document.",
    };
  }

  // Valid lease
  return {
    allowed: true,
    action: "allow-edit",
    reason: `Offline lease active until ${lease.leaseExpiresAt}.`,
    unsyncedEditsRetained: false,
    notice: "",
  };
}

export interface RevocationExplanation {
  serverScope: string;
  localScope: string;
  limitations: string;
}

/**
 * Return an accurate explanation of access-revocation boundaries for previously downloaded content.
 */
export function explainOfflineRevocation(record: FileRecord): RevocationExplanation {
  return {
    serverScope: "Revoking sharing or permissions on SuiteDrive immediately denies future sync, locks server downloads, and disconnects live collaboration sessions.",
    localScope: "Unencrypted files previously exported to host disk or cached in browser storage cannot be remotely retracted or erased over the network.",
    limitations: "Network permission changes govern server access; local device encryption (FileVault, BitLocker) and device management are required to protect exported offline copies on departing employee hardware.",
  };
}
