import { ERROR_REMEDIES, type NodeTelemetrySnapshot, type OperationalAlert } from "./types";

export interface TelemetryInputs {
  nodeId: string;
  disk: {
    totalBytes: number;
    usedBytes: number;
  };
  replication: {
    lagMs: number;
    backlogCount: number;
    connectedPeers: number;
    expectedPeers: number;
  };
  collab?: {
    activeRooms?: number;
    roomErrors?: number;
    queueFailures?: number;
  };
  sync?: {
    failedSaves?: number;
    unsyncedEdits?: number;
    hasIntegrityError?: boolean;
    isNetworkOffline?: boolean;
  };
  backup?: {
    lastBackupTimestamp?: string;
    restoreTested?: boolean;
    lastDrillTimestamp?: string;
    maxFreshnessHours?: number;
  };
}

export function evaluateTelemetry(inputs: TelemetryInputs): NodeTelemetrySnapshot {
  const alerts: OperationalAlert[] = [];
  const now = Date.now();
  const timestamp = new Date(now).toISOString();

  // 1. Disk & Storage capacity evaluation
  const freeBytes = Math.max(0, inputs.disk.totalBytes - inputs.disk.usedBytes);
  const thresholdRatio = inputs.disk.totalBytes > 0 ? inputs.disk.usedBytes / inputs.disk.totalBytes : 0;
  const isFull = thresholdRatio >= 0.95;

  if (isFull) {
    alerts.push({
      id: `alert_disk_full_${now}`,
      code: "ERR_DISK_FULL",
      severity: "critical",
      message: `Disk storage is full (${Math.round(thresholdRatio * 100)}% used). Incoming writes halted safely.`,
      remedy: ERROR_REMEDIES.ERR_DISK_FULL.operatorAction,
      triggeredAt: timestamp,
    });
  } else if (thresholdRatio >= 0.8) {
    alerts.push({
      id: `alert_disk_warning_${now}`,
      code: "ERR_DISK_FULL",
      severity: "warning",
      message: `Disk storage threshold exceeded (${Math.round(thresholdRatio * 100)}% used).`,
      remedy: ERROR_REMEDIES.ERR_DISK_FULL.operatorAction,
      triggeredAt: timestamp,
    });
  }

  // 2. Replication evaluation
  const isLagging = inputs.replication.lagMs > 5000 || inputs.replication.backlogCount > 100;
  if (isLagging) {
    alerts.push({
      id: `alert_repl_lag_${now}`,
      code: "ERR_REPLICATION_LAG",
      severity: inputs.replication.lagMs > 30000 ? "critical" : "warning",
      message: `Replication lag is high: ${inputs.replication.lagMs}ms, ${inputs.replication.backlogCount} operations pending.`,
      remedy: ERROR_REMEDIES.ERR_REPLICATION_LAG.operatorAction,
      triggeredAt: timestamp,
    });
  }

  // 3. Sync & Integrity evaluation (distinguishing transient offline vs integrity error)
  const failedSaves = inputs.sync?.failedSaves ?? 0;
  const unsyncedEdits = inputs.sync?.unsyncedEdits ?? 0;
  let syncState: "online" | "transient_offline" | "integrity_failure" = "online";

  if (inputs.sync?.hasIntegrityError) {
    syncState = "integrity_failure";
    alerts.push({
      id: `alert_integrity_${now}`,
      code: "ERR_DATA_INTEGRITY",
      severity: "critical",
      message: "Data integrity verification failed. Potential blob or row corruption detected.",
      remedy: ERROR_REMEDIES.ERR_DATA_INTEGRITY.operatorAction,
      triggeredAt: timestamp,
    });
  } else if (inputs.sync?.isNetworkOffline || failedSaves > 0) {
    syncState = "transient_offline";
    if (failedSaves > 0) {
      alerts.push({
        id: `alert_upload_${now}`,
        code: "ERR_FAILED_UPLOAD",
        severity: "warning",
        message: `${failedSaves} upload(s) failed. Local edits preserved for offline recovery.`,
        remedy: ERROR_REMEDIES.ERR_FAILED_UPLOAD.remedyAction,
        triggeredAt: timestamp,
      });
    }
  }

  // 4. Backup freshness & restore test evaluation
  const lastBackupStr = inputs.backup?.lastBackupTimestamp ?? "1970-01-01T00:00:00Z";
  const lastBackupTime = new Date(lastBackupStr).getTime();
  const hoursSinceLastBackup = (now - lastBackupTime) / (1000 * 3600);
  const maxHours = inputs.backup?.maxFreshnessHours ?? 24;
  const isStale = hoursSinceLastBackup > maxHours;
  const restoreTested = inputs.backup?.restoreTested ?? false;

  if (isStale) {
    alerts.push({
      id: `alert_backup_stale_${now}`,
      code: "ERR_STALE_BACKUP",
      severity: "critical",
      message: `Automated backup is stale: last backup was ${Math.round(hoursSinceLastBackup)} hours ago (limit: ${maxHours}h).`,
      remedy: ERROR_REMEDIES.ERR_STALE_BACKUP.operatorAction,
      triggeredAt: timestamp,
    });
  }

  // Node overall status
  let status: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (alerts.some((a) => a.severity === "critical")) {
    status = "unhealthy";
  } else if (alerts.some((a) => a.severity === "warning")) {
    status = "degraded";
  }

  return {
    nodeId: inputs.nodeId,
    timestamp,
    status,
    disk: {
      totalBytes: inputs.disk.totalBytes,
      usedBytes: inputs.disk.usedBytes,
      freeBytes,
      thresholdRatio,
      isFull,
    },
    replication: {
      lagMs: inputs.replication.lagMs,
      backlogCount: inputs.replication.backlogCount,
      connectedPeers: inputs.replication.connectedPeers,
      expectedPeers: inputs.replication.expectedPeers,
      isLagging,
    },
    collab: {
      activeRooms: inputs.collab?.activeRooms ?? 0,
      roomErrors: inputs.collab?.roomErrors ?? 0,
      queueFailures: inputs.collab?.queueFailures ?? 0,
    },
    sync: {
      failedSaves,
      unsyncedEdits,
      state: syncState,
    },
    backup: {
      lastBackupTimestamp: lastBackupStr,
      hoursSinceLastBackup,
      isStale,
      restoreTested,
      lastDrillTimestamp: inputs.backup?.lastDrillTimestamp,
    },
    alerts,
  };
}
