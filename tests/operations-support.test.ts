import { describe, expect, it } from "vitest";
import {
  createDiagnosticsBundle,
  ERROR_REMEDIES,
  evaluateStorageQuota,
  evaluateTelemetry,
  sanitizeErrorMessage,
  type StableErrorCode,
} from "../packages/core/src/operations";

describe("WP-033: Operational Visibility & Actionable Support", () => {
  it("identifies induced failed upload, lagging node, full disk, and stale backup from telemetry", () => {
    // 1. Induce full disk and replication lag
    const degradedSnapshot = evaluateTelemetry({
      nodeId: "node-us-east-1",
      disk: {
        totalBytes: 100 * 1024 * 1024 * 1024,
        usedBytes: 96 * 1024 * 1024 * 1024, // 96% -> full disk
      },
      replication: {
        lagMs: 6500, // > 5000ms -> lagging
        backlogCount: 150, // > 100 -> backlog
        connectedPeers: 2,
        expectedPeers: 3,
      },
      sync: {
        failedSaves: 3,
        unsyncedEdits: 5,
        isNetworkOffline: true,
      },
      backup: {
        lastBackupTimestamp: new Date(Date.now() - 36 * 3600 * 1000).toISOString(), // 36 hours ago -> stale
        restoreTested: false,
      },
    });

    expect(degradedSnapshot.status).toBe("unhealthy");
    expect(degradedSnapshot.disk.isFull).toBe(true);
    expect(degradedSnapshot.replication.isLagging).toBe(true);
    expect(degradedSnapshot.backup.isStale).toBe(true);
    expect(degradedSnapshot.sync.state).toBe("transient_offline");

    const alertCodes = degradedSnapshot.alerts.map((a) => a.code);
    expect(alertCodes).toContain<StableErrorCode>("ERR_DISK_FULL");
    expect(alertCodes).toContain<StableErrorCode>("ERR_REPLICATION_LAG");
    expect(alertCodes).toContain<StableErrorCode>("ERR_STALE_BACKUP");
    expect(alertCodes).toContain<StableErrorCode>("ERR_FAILED_UPLOAD");

    // All alerts contain clear operator or user remedies
    for (const alert of degradedSnapshot.alerts) {
      expect(alert.remedy).toBeDefined();
      expect(alert.remedy.length).toBeGreaterThan(10);
    }
  });

  it("clearly distinguishes transient offline state from data-integrity failures", () => {
    // Transient offline: client disconnected, edits safe locally
    const offlineSnapshot = evaluateTelemetry({
      nodeId: "node-1",
      disk: { totalBytes: 1000, usedBytes: 100 },
      replication: { lagMs: 0, backlogCount: 0, connectedPeers: 3, expectedPeers: 3 },
      sync: {
        failedSaves: 1,
        unsyncedEdits: 2,
        isNetworkOffline: true,
        hasIntegrityError: false,
      },
      backup: {
        lastBackupTimestamp: new Date().toISOString(),
        restoreTested: true,
      },
    });
    expect(offlineSnapshot.sync.state).toBe("transient_offline");
    expect(offlineSnapshot.alerts.some((a) => a.code === "ERR_DATA_INTEGRITY")).toBe(false);

    // Data-integrity failure: corrupted blob / row hash mismatch
    const integritySnapshot = evaluateTelemetry({
      nodeId: "node-1",
      disk: { totalBytes: 1000, usedBytes: 100 },
      replication: { lagMs: 0, backlogCount: 0, connectedPeers: 3, expectedPeers: 3 },
      sync: {
        failedSaves: 0,
        unsyncedEdits: 0,
        hasIntegrityError: true,
      },
      backup: {
        lastBackupTimestamp: new Date().toISOString(),
        restoreTested: true,
      },
    });
    expect(integritySnapshot.sync.state).toBe("integrity_failure");
    expect(integritySnapshot.alerts.some((a) => a.code === "ERR_DATA_INTEGRITY")).toBe(true);
    expect(integritySnapshot.status).toBe("unhealthy");
  });

  it("creates an opt-in diagnostics bundle that strictly excludes file contents, tokens, and secrets", () => {
    const rawError =
      "Request failed: Bearer ya29.secret_auth_token_xyz failed for password=mySecretPassword123 with ghp_abc123456789";
    const sanitized = sanitizeErrorMessage(rawError);

    expect(sanitized).not.toContain("ya29.secret_auth_token_xyz");
    expect(sanitized).not.toContain("mySecretPassword123");
    expect(sanitized).not.toContain("ghp_abc123456789");
    expect(sanitized).toContain("[REDACTED]");

    const bundle = createDiagnosticsBundle({
      correlationId: "diag_incident_991",
      appVersion: "1.2.0",
      nodeVersion: "v22.2.0",
      platform: "linux",
      auth: {
        providerType: "oidc",
        activeSessions: 42,
        emergencyAccessConfigured: true,
      },
      storage: {
        totalBytes: 500 * 1024 * 1024,
        usedBytes: 400 * 1024 * 1024,
        quotaExceededCount: 2,
      },
      errors: [
        {
          code: "ERR_FAILED_UPLOAD",
          rawMessage: rawError,
        },
      ],
      documentSample: {
        kind: "doc",
        byteSize: 125000,
        rawTextOrContent: "Top Secret Strategy text that must never leak",
        paragraphCount: 45,
        tabCount: 3,
      },
    });

    expect(bundle.correlationId).toBe("diag_incident_991");
    expect(bundle.subsystems.auth.emergencyAccessConfigured).toBe(true);
    expect(bundle.sanitizedErrors[0].message).not.toContain("mySecretPassword123");

    // The structural summary is included, but NEVER document text or content
    expect(bundle.documentContextSummary).toEqual({
      kind: "doc",
      byteSize: 125000,
      paragraphCount: 45,
      sheetCount: undefined,
      slideCount: undefined,
    });
    expect(JSON.stringify(bundle)).not.toContain("Top Secret Strategy text");
  });

  it("enforces storage quota before writes are acknowledged and preserves unsynchronized local edits", () => {
    const quotaLimit = 100 * 1024 * 1024; // 100 MB

    // Safe write below quota
    const check1 = evaluateStorageQuota({
      currentUsageBytes: 70 * 1024 * 1024,
      incomingBytes: 5 * 1024 * 1024,
      quotaLimitBytes: quotaLimit,
    });
    expect(check1.allowed).toBe(true);
    expect(check1.warning).toBeUndefined();

    // Warning threshold (80% used)
    const check2 = evaluateStorageQuota({
      currentUsageBytes: 78 * 1024 * 1024,
      incomingBytes: 5 * 1024 * 1024, // 83 MB total -> > 80%
      quotaLimitBytes: quotaLimit,
    });
    expect(check2.allowed).toBe(true);
    expect(check2.warning).toContain("Storage usage is near limit");

    // Quota exceeded: rejects write before server acknowledgement, preserves local edits
    const check3 = evaluateStorageQuota({
      currentUsageBytes: 98 * 1024 * 1024,
      incomingBytes: 5 * 1024 * 1024, // 103 MB > 100 MB
      quotaLimitBytes: quotaLimit,
    });
    expect(check3.allowed).toBe(false);
    expect(check3.code).toBe("ERR_STORAGE_QUOTA_EXCEEDED");
    expect(check3.preserveLocalEdits).toBe(true); // Ensures local client never discards unsynced edits
  });

  it("verifies stable error remedies cover all stable error codes", () => {
    const codes: StableErrorCode[] = [
      "ERR_STORAGE_QUOTA_EXCEEDED",
      "ERR_DISK_FULL",
      "ERR_REPLICATION_LAG",
      "ERR_STALE_BACKUP",
      "ERR_FAILED_UPLOAD",
      "ERR_DATA_INTEGRITY",
      "ERR_AUTH_LOCKED_OUT",
      "ERR_TRANSIENT_OFFLINE",
    ];

    for (const code of codes) {
      const remedy = ERROR_REMEDIES[code];
      expect(remedy).toBeDefined();
      expect(remedy.userMessage).toBeTruthy();
      expect(remedy.remedyAction).toBeTruthy();
      expect(remedy.operatorAction).toBeTruthy();
    }
  });
});
