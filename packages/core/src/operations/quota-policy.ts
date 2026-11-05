import type { QuotaCheckResult } from "./types";

export interface QuotaCheckOptions {
  currentUsageBytes: number;
  incomingBytes: number;
  quotaLimitBytes: number;
  warningThresholdRatio?: number; // default 0.8 (80%)
}

/**
 * Evaluates storage quota before acknowledging server writes.
 * Quotas fail safely before write acknowledgment and preserve unsynchronized local edits.
 */
export function evaluateStorageQuota(options: QuotaCheckOptions): QuotaCheckResult {
  const { currentUsageBytes, incomingBytes, quotaLimitBytes } = options;
  const warningRatio = options.warningThresholdRatio ?? 0.8;

  // If no quota set (limit <= 0), allow write
  if (quotaLimitBytes <= 0) {
    return {
      allowed: true,
      currentUsageBytes,
      quotaLimitBytes,
      requestedBytes: incomingBytes,
      preserveLocalEdits: false,
    };
  }

  const projectedUsage = currentUsageBytes + incomingBytes;

  if (projectedUsage > quotaLimitBytes) {
    return {
      allowed: false,
      currentUsageBytes,
      quotaLimitBytes,
      requestedBytes: incomingBytes,
      code: "ERR_STORAGE_QUOTA_EXCEEDED",
      preserveLocalEdits: true, // Crucial: local unsynced edits must be preserved!
    };
  }

  const projectedRatio = projectedUsage / quotaLimitBytes;
  const warning =
    projectedRatio >= warningRatio
      ? `Storage usage is near limit: ${Math.round(projectedRatio * 100)}% of quota used.`
      : undefined;

  return {
    allowed: true,
    currentUsageBytes,
    quotaLimitBytes,
    requestedBytes: incomingBytes,
    warning,
    preserveLocalEdits: false,
  };
}
