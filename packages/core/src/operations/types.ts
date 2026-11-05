export type StableErrorCode =
  | "ERR_STORAGE_QUOTA_EXCEEDED"
  | "ERR_DISK_FULL"
  | "ERR_REPLICATION_LAG"
  | "ERR_STALE_BACKUP"
  | "ERR_FAILED_UPLOAD"
  | "ERR_DATA_INTEGRITY"
  | "ERR_AUTH_LOCKED_OUT"
  | "ERR_TRANSIENT_OFFLINE";

export interface ErrorRemedy {
  code: StableErrorCode;
  userMessage: string;
  remedyAction: string;
  operatorAction: string;
}

export const ERROR_REMEDIES: Record<StableErrorCode, ErrorRemedy> = {
  ERR_STORAGE_QUOTA_EXCEEDED: {
    code: "ERR_STORAGE_QUOTA_EXCEEDED",
    userMessage: "Workspace storage quota has been reached.",
    remedyAction: "Delete unneeded files or contact your administrator to request a quota increase.",
    operatorAction: "Inspect user/tenant storage allocations and increase limits or configure data retention.",
  },
  ERR_DISK_FULL: {
    code: "ERR_DISK_FULL",
    userMessage: "Server disk is currently full; incoming writes are temporarily halted.",
    remedyAction: "Your edits are safely retained in local storage until disk capacity is restored.",
    operatorAction: "Expand server storage volume or clean up unreferenced blobs immediately.",
  },
  ERR_REPLICATION_LAG: {
    code: "ERR_REPLICATION_LAG",
    userMessage: "Cluster replication is currently delayed.",
    remedyAction: "Changes will sync across nodes automatically once connectivity stabilizes.",
    operatorAction: "Check peer network connectivity, high CPU load, and replication backlog queue.",
  },
  ERR_STALE_BACKUP: {
    code: "ERR_STALE_BACKUP",
    userMessage: "Automated backup schedule is behind.",
    remedyAction: "No action required from users; your work continues normally.",
    operatorAction: "Verify backup runner daemon, check SUITELEAF_BACKUP_DIR permissions and disk space.",
  },
  ERR_FAILED_UPLOAD: {
    code: "ERR_FAILED_UPLOAD",
    userMessage: "Upload failed during transmission.",
    remedyAction: "Check your network connection; your local draft remains intact for automatic retry.",
    operatorAction: "Inspect upload ingress gateway logs and blobstore write permissions.",
  },
  ERR_DATA_INTEGRITY: {
    code: "ERR_DATA_INTEGRITY",
    userMessage: "Data integrity verification failed for the requested item.",
    remedyAction: "Do not overwrite the existing file; open version history or contact support.",
    operatorAction: "Quarantine affected blob, inspect audit logs, and trigger restore from verified backup.",
  },
  ERR_AUTH_LOCKED_OUT: {
    code: "ERR_AUTH_LOCKED_OUT",
    userMessage: "Administrator authentication is temporarily locked out.",
    remedyAction: "Use the audited emergency recovery key to regain administrative access.",
    operatorAction: "Follow runbook for emergency recovery code sign-in and audit event verification.",
  },
  ERR_TRANSIENT_OFFLINE: {
    code: "ERR_TRANSIENT_OFFLINE",
    userMessage: "You are currently working offline.",
    remedyAction: "Edits are safely saved to local device storage and will sync upon reconnection.",
    operatorAction: "Normal client behavior; no server intervention needed.",
  },
};

export interface OperationalAlert {
  id: string;
  code: StableErrorCode;
  severity: "info" | "warning" | "critical";
  message: string;
  remedy: string;
  triggeredAt: string;
}

export interface NodeTelemetrySnapshot {
  nodeId: string;
  timestamp: string;
  status: "healthy" | "degraded" | "unhealthy";
  disk: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    thresholdRatio: number;
    isFull: boolean;
  };
  replication: {
    lagMs: number;
    backlogCount: number;
    connectedPeers: number;
    expectedPeers: number;
    isLagging: boolean;
  };
  collab: {
    activeRooms: number;
    roomErrors: number;
    queueFailures: number;
  };
  sync: {
    failedSaves: number;
    unsyncedEdits: number;
    state: "online" | "transient_offline" | "integrity_failure";
  };
  backup: {
    lastBackupTimestamp: string;
    hoursSinceLastBackup: number;
    isStale: boolean;
    restoreTested: boolean;
    lastDrillTimestamp?: string;
  };
  alerts: OperationalAlert[];
}

export interface DiagnosticsBundle {
  correlationId: string;
  generatedAt: string;
  system: {
    nodeVersion: string;
    appVersion: string;
    platform: string;
    memoryMb: number;
  };
  subsystems: {
    auth: {
      providerType: string;
      activeSessions: number;
      emergencyAccessConfigured: boolean;
    };
    storage: {
      totalBytes: number;
      usedBytes: number;
      quotaExceededCount: number;
    };
    replication: {
      lagMs: number;
      backlogCount: number;
      connectedPeers: number;
    };
    backup: {
      lastBackupTimestamp: string;
      restoreTested: boolean;
      freshnessHours: number;
    };
  };
  sanitizedErrors: Array<{
    code: StableErrorCode;
    message: string;
    timestamp: string;
    correlationId: string;
  }>;
  documentContextSummary?: {
    kind: string;
    byteSize: number;
    paragraphCount?: number;
    sheetCount?: number;
    slideCount?: number;
  };
}

export interface QuotaCheckResult {
  allowed: boolean;
  currentUsageBytes: number;
  quotaLimitBytes: number;
  requestedBytes: number;
  code?: StableErrorCode;
  warning?: string;
  preserveLocalEdits: boolean;
}
