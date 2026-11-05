export type DataClassificationLabel = "public" | "internal" | "confidential" | "restricted";

export interface SensitivePattern {
  name: string;
  pattern: RegExp;
  recommendedLabel: DataClassificationLabel;
  description: string;
}

export interface ClassificationPolicy {
  label: DataClassificationLabel;
  allowExternalSharing: boolean;
  allowExport: boolean;
  allowOffline: boolean;
  allowAiProcessing: boolean;
}

export interface ClassificationOverride {
  id: string;
  fileId: string;
  originalLabel: DataClassificationLabel;
  overrideLabel: DataClassificationLabel;
  grantedBy: string;
  reason: string;
  expiresAt: string;
}

export interface LegalHold {
  id: string;
  name: string;
  description: string;
  custodianIds: string[];
  fileIds: string[];
  status: "active" | "released";
  createdAt: string;
  releasedAt?: string;
  createdBy: string;
}

export interface RetentionSchedule {
  id: string;
  name: string;
  retentionDays: number;
  dispositionAction: "archive" | "permanent_delete" | "quarantine";
  appliesToLabels: DataClassificationLabel[];
}

export interface DiscoveryFileRecord {
  id: string;
  name: string;
  sha256: string;
  version: number;
  labels: DataClassificationLabel[];
  custodianId: string;
  createdAt: string;
  modifiedAt: string;
}

export interface DiscoveryExportManifest {
  exportId: string;
  requesterId: string;
  authorizedScope: string;
  generatedAt: string;
  files: DiscoveryFileRecord[];
  totalBytes: number;
  manifestSignature: string;
}

export interface AppendOnlyAuditRecord {
  sequence: number;
  previousHash: string;
  hash: string;
  timestamp: string;
  actorId: string;
  action: string;
  targetId: string;
  details: Record<string, unknown>;
}
