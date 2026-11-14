

export type MigrationSourceType = "google-drive" | "sharepoint" | "onedrive" | "local";

export interface SourcePermission {
  principal: {
    id: string;
    email?: string;
    type: "user" | "group" | "domain" | "anyone";
  };
  role: "owner" | "editor" | "commenter" | "viewer";
  inherited: boolean;
}

export interface SourceItem {
  id: string;
  name: string;
  path: string;
  type: "file" | "folder";
  mimeType: string;
  size: number;
  contentHash: string; // SHA-256 or provider ETag
  modifiedTime: string; // ISO 8601
  ownerEmail?: string;
  permissions: SourcePermission[];
  metadata?: Record<string, unknown>;
}

export interface IdentityMappingRule {
  source: string; // email or principal id
  target: string; // SuiteLeaf accountId or groupId
  targetType: "user" | "group";
}

export interface PermissionMappingPolicy {
  /** How to handle permissions referencing unmapped identities */
  unmappedIdentity: "block" | "isolate";
  /** Fallback quarantine / admin account ID when isolate is selected */
  isolatedFallbackId?: string;
}

export interface PreflightReport {
  totalFiles: number;
  totalFolders: number;
  totalBytes: number;
  duplicateNames: Array<{ path: string; names: string[] }>;
  unmappedIdentities: Array<{ email?: string; id: string; count: number }>;
  unsupportedFormats: Array<{ extension: string; count: number; items: string[] }>;
  conversionLossRisks: Array<{ id: string; name: string; warning: string }>;
  quotaCheck: {
    estimatedBytes: number;
    availableBytes?: number;
    sufficient: boolean;
  };
  valid: boolean;
}

export type ItemDisposition =
  | "created"
  | "updated"
  | "skipped_unchanged"
  | "quarantined"
  | "failed";

export interface MigrationItemState {
  sourceId: string;
  sourceName: string;
  sourcePath: string;
  sourceHash: string;
  destinationId: string;
  destinationPath: string;
  destinationHash?: string;
  status: "pending" | "migrated" | "unchanged" | "quarantined" | "failed";
  disposition: ItemDisposition;
  converterVersion: string;
  error?: string;
  warnings: string[];
  mappedPermissions: Array<{
    principalId: string;
    role: "viewer" | "editor" | "owner";
  }>;
  lastAttempt: string;
}

export interface MigrationCheckpoint {
  migrationId: string;
  sourceType: MigrationSourceType;
  createdAt: string;
  updatedAt: string;
  phase: "preflight" | "staged" | "delta" | "cutover" | "rolled_back";
  items: Record<string, MigrationItemState>; // keyed by sourceId
  stats: {
    total: number;
    migrated: number;
    unchanged: number;
    quarantined: number;
    failed: number;
  };
}

export interface MigrationManifest {
  migrationId: string;
  timestamp: string;
  sourceType: MigrationSourceType;
  converterVersion: string;
  items: MigrationItemState[];
  reconciliation: {
    sourceTotal: number;
    destinationTotal: number;
    matchedHashes: number;
    discrepancies: number;
    unsupportedCount: number;
    quarantinedCount: number;
    errorsCount: number;
  };
}

export interface MigrationStorageAdapter {
  writeFile(
    destinationPath: string,
    content: string | Uint8Array,
    metadata?: Record<string, unknown>,
  ): Promise<{ id: string; hash: string }>;
  deleteFile(destinationPath: string): Promise<void>;
  fileExists(destinationPath: string): Promise<boolean>;
  readFile(destinationPath: string): Promise<Uint8Array | string>;
}
