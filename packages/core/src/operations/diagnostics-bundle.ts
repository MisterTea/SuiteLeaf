import type { DiagnosticsBundle, StableErrorCode } from "./types";

export interface DiagnosticsContext {
  correlationId?: string;
  appVersion?: string;
  nodeVersion?: string;
  platform?: string;
  memoryMb?: number;
  auth?: {
    providerType: string;
    activeSessions: number;
    emergencyAccessConfigured: boolean;
  };
  storage?: {
    totalBytes: number;
    usedBytes: number;
    quotaExceededCount?: number;
  };
  replication?: {
    lagMs: number;
    backlogCount: number;
    connectedPeers: number;
  };
  backup?: {
    lastBackupTimestamp: string;
    restoreTested: boolean;
    freshnessHours: number;
  };
  errors?: Array<{
    code: StableErrorCode;
    rawMessage: string;
    timestamp?: string;
    correlationId?: string;
  }>;
  documentSample?: {
    kind: string;
    byteSize: number;
    rawTextOrContent?: unknown;
    paragraphCount?: number;
    sheetCount?: number;
    slideCount?: number;
  };
}

/**
 * Strips tokens, passwords, bearer credentials, and API secrets from error strings.
 */
export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, "$1[REDACTED]")
    .replace(/(password|secret|key|token|authorization)=[^&\s]+/gi, "$1=[REDACTED]")
    .replace(/(ya29\.[A-Za-z0-9._-]+)/gi, "[REDACTED_GDRIVE_TOKEN]")
    .replace(/(ghp_[A-Za-z0-9]+)/gi, "[REDACTED_GITHUB_TOKEN]");
}

/**
 * Creates an opt-in diagnostics bundle excluding document contents, tokens, and secrets.
 */
export function createDiagnosticsBundle(context: DiagnosticsContext): DiagnosticsBundle {
  const correlationId =
    context.correlationId ?? `diag_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const sanitizedErrors = (context.errors ?? []).map((err) => ({
    code: err.code,
    message: sanitizeErrorMessage(err.rawMessage),
    timestamp: err.timestamp ?? new Date().toISOString(),
    correlationId: err.correlationId ?? correlationId,
  }));

  // Create structural document summary without exposing file contents or text
  let documentContextSummary: DiagnosticsBundle["documentContextSummary"] | undefined;
  if (context.documentSample) {
    documentContextSummary = {
      kind: context.documentSample.kind,
      byteSize: context.documentSample.byteSize,
      paragraphCount: context.documentSample.paragraphCount,
      sheetCount: context.documentSample.sheetCount,
      slideCount: context.documentSample.slideCount,
    };
  }

  return {
    correlationId,
    generatedAt: new Date().toISOString(),
    system: {
      nodeVersion: context.nodeVersion ?? "v22.0.0",
      appVersion: context.appVersion ?? "0.1.0",
      platform: context.platform ?? "posix",
      memoryMb: context.memoryMb ?? 512,
    },
    subsystems: {
      auth: {
        providerType: context.auth?.providerType ?? "oidc",
        activeSessions: context.auth?.activeSessions ?? 0,
        emergencyAccessConfigured: context.auth?.emergencyAccessConfigured ?? false,
      },
      storage: {
        totalBytes: context.storage?.totalBytes ?? 0,
        usedBytes: context.storage?.usedBytes ?? 0,
        quotaExceededCount: context.storage?.quotaExceededCount ?? 0,
      },
      replication: {
        lagMs: context.replication?.lagMs ?? 0,
        backlogCount: context.replication?.backlogCount ?? 0,
        connectedPeers: context.replication?.connectedPeers ?? 0,
      },
      backup: {
        lastBackupTimestamp: context.backup?.lastBackupTimestamp ?? "",
        restoreTested: context.backup?.restoreTested ?? false,
        freshnessHours: context.backup?.freshnessHours ?? 0,
      },
    },
    sanitizedErrors,
    documentContextSummary,
  };
}
