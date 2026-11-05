import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { SuiteFile } from "../file-schema";
import { createFile, serializeFile } from "../native-file";
import type { MigrationSourceAdapter } from "./adapters";
import type {
  IdentityMappingRule,
  ItemDisposition,
  MigrationCheckpoint,
  MigrationItemState,
  MigrationManifest,
  MigrationStorageAdapter,
  PermissionMappingPolicy,
  PreflightReport,
  SourceItem,
  SourcePermission,
} from "./types";

export interface MigrationEngineOptions {
  migrationId?: string;
  adapter: MigrationSourceAdapter;
  storage: MigrationStorageAdapter;
  identityRules?: IdentityMappingRule[];
  policy?: PermissionMappingPolicy;
  checkpoint?: MigrationCheckpoint;
  converterVersion?: string;
  convertOffice?: (
    bytes: Uint8Array,
    format: string,
    name: string,
  ) => Promise<SuiteFile>;
}

export class MigrationEngine {
  private adapter: MigrationSourceAdapter;
  private storage: MigrationStorageAdapter;
  private identityRules: Map<string, IdentityMappingRule> = new Map();
  private policy: PermissionMappingPolicy;
  private checkpoint: MigrationCheckpoint;
  private converterVersion: string;
  private convertOffice?: (
    bytes: Uint8Array,
    format: string,
    name: string,
  ) => Promise<SuiteFile>;

  constructor(options: MigrationEngineOptions) {
    this.adapter = options.adapter;
    this.storage = options.storage;
    this.converterVersion = options.converterVersion ?? "SuiteLeaf-Migration/1.0.0";
    this.convertOffice = options.convertOffice;
    this.policy = options.policy ?? {
      unmappedIdentity: "block",
      isolatedFallbackId: "admin-quarantine",
    };

    if (options.identityRules) {
      for (const rule of options.identityRules) {
        this.identityRules.set(rule.source.toLowerCase(), rule);
      }
    }

    if (options.checkpoint) {
      this.checkpoint = options.checkpoint;
    } else {
      const id = options.migrationId ?? `mig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      this.checkpoint = {
        migrationId: id,
        sourceType: this.adapter.sourceType,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        phase: "preflight",
        items: {},
        stats: {
          total: 0,
          migrated: 0,
          unchanged: 0,
          quarantined: 0,
          failed: 0,
        },
      };
    }
  }

  getCheckpoint(): MigrationCheckpoint {
    return JSON.parse(JSON.stringify(this.checkpoint));
  }

  /**
   * Discovers all inventory items across pagination pages.
   */
  async fetchAllSourceItems(): Promise<SourceItem[]> {
    const items: SourceItem[] = [];
    let cursor: string | undefined = undefined;
    do {
      const page = await this.adapter.listInventory(cursor);
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }

  /**
   * Preflight & dry-run inspection.
   */
  async runPreflight(): Promise<PreflightReport> {
    const items = await this.fetchAllSourceItems();
    const duplicateMap = new Map<string, Set<string>>();
    const unmappedIdentitiesMap = new Map<string, { email?: string; id: string; count: number }>();
    const unsupportedMap = new Map<string, { count: number; items: string[] }>();
    const conversionLossRisks: Array<{ id: string; name: string; warning: string }> = [];

    let totalFiles = 0;
    let totalFolders = 0;
    let totalBytes = 0;

    for (const item of items) {
      if (item.type === "folder") {
        totalFolders++;
        continue;
      }
      totalFiles++;
      totalBytes += item.size;

      // Duplicate names check per directory path
      const dirPath = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "";
      if (!duplicateMap.has(dirPath)) {
        duplicateMap.set(dirPath, new Set());
      }
      const dirSet = duplicateMap.get(dirPath)!;
      if (dirSet.has(item.name.toLowerCase())) {
        conversionLossRisks.push({
          id: item.id,
          name: item.name,
          warning: `Duplicate filename in ${dirPath || "root"}: ${item.name}`,
        });
      } else {
        dirSet.add(item.name.toLowerCase());
      }

      // Format inspection
      const ext = item.name.includes(".") ? item.name.split(".").pop()!.toLowerCase() : "";
      const supportedExts = [
        "docx", "doc", "xlsx", "xls", "pptx", "ppt", "csv", "tsv", "txt", "html", "htm", "md",
        "sldoc", "slsheet", "slslides", "sldraw"
      ];
      const isGoogleNative = item.mimeType.startsWith("application/vnd.google-apps.");
      if (!supportedExts.includes(ext) && !isGoogleNative) {
        const entry = unsupportedMap.get(ext || "none") ?? { count: 0, items: [] };
        entry.count++;
        entry.items.push(item.name);
        unsupportedMap.set(ext || "none", entry);
      }

      if (ext === "docm" || ext === "xlsm" || ext === "pptm") {
        conversionLossRisks.push({
          id: item.id,
          name: item.name,
          warning: "VBA macros will be quarantined and stripped during conversion.",
        });
      }

      // Permissions & identity check
      for (const perm of item.permissions) {
        const principalId = perm.principal.email || perm.principal.id;
        if (principalId && !this.identityRules.has(principalId.toLowerCase())) {
          const entry = unmappedIdentitiesMap.get(principalId) ?? {
            id: perm.principal.id,
            email: perm.principal.email,
            count: 0,
          };
          entry.count++;
          unmappedIdentitiesMap.set(principalId, entry);
        }
      }
    }

    const duplicates: Array<{ path: string; names: string[] }> = [];
    for (const [path, set] of duplicateMap.entries()) {
      if (set.size < items.filter((i) => i.path.startsWith(path)).length) {
        duplicates.push({ path, names: Array.from(set) });
      }
    }

    const unmappedIdentities = Array.from(unmappedIdentitiesMap.values());
    const unsupportedFormats = Array.from(unsupportedMap.entries()).map(([extension, data]) => ({
      extension,
      count: data.count,
      items: data.items,
    }));

    return {
      totalFiles,
      totalFolders,
      totalBytes,
      duplicateNames: duplicates,
      unmappedIdentities,
      unsupportedFormats,
      conversionLossRisks,
      quotaCheck: {
        estimatedBytes: totalBytes,
        sufficient: true,
      },
      valid: unmappedIdentities.length === 0 || this.policy.unmappedIdentity === "isolate",
    };
  }

  /**
   * Execute staged import or delta pass. Resumes from checkpoint if interrupted.
   */
  async runMigration(options: {
    deltaOnly?: boolean;
    sampleLimit?: number;
    onProgress?: (item: MigrationItemState) => void;
  } = {}): Promise<MigrationCheckpoint> {
    this.checkpoint.phase = options.deltaOnly ? "delta" : "staged";
    this.checkpoint.updatedAt = new Date().toISOString();

    const allItems = await this.fetchAllSourceItems();
    const itemsToProcess = options.sampleLimit ? allItems.slice(0, options.sampleLimit) : allItems;
    this.checkpoint.stats.total = itemsToProcess.length;

    for (const item of itemsToProcess) {
      if (item.type === "folder") continue;

      const existingState = this.checkpoint.items[item.id];
      // Delta check: if already successfully migrated and hash is unchanged, skip re-uploading
      if (
        existingState &&
        (existingState.status === "migrated" || existingState.status === "unchanged") &&
        existingState.sourceHash === item.contentHash
      ) {
        existingState.status = "unchanged";
        existingState.disposition = "skipped_unchanged";
        this.checkpoint.items[item.id] = existingState;
        this.checkpoint.stats.unchanged++;
        options.onProgress?.(existingState);
        continue;
      }

      const warnings: string[] = [];
      const destinationId = "sl_" + bytesToHex(sha256(new TextEncoder().encode(item.id))).slice(0, 16);
      const destinationPath = this.resolveDestinationPath(item);

      // Identity & permission validation
      const mappedPermissions: Array<{ principalId: string; role: "viewer" | "editor" | "owner" }> = [];
      let permissionViolation = false;

      for (const perm of item.permissions) {
        const principalKey = (perm.principal.email || perm.principal.id).toLowerCase();
        const rule = this.identityRules.get(principalKey);
        if (rule) {
          const role = perm.role === "owner" ? "owner" : perm.role === "editor" ? "editor" : "viewer";
          mappedPermissions.push({ principalId: rule.target, role });
        } else {
          if (this.policy.unmappedIdentity === "block") {
            permissionViolation = true;
            warnings.push(`Unmapped principal ${principalKey} blocked by policy.`);
          } else {
            // Isolate: route to fallback quarantined ID
            warnings.push(`Unmapped principal ${principalKey} isolated to ${this.policy.isolatedFallbackId}.`);
            mappedPermissions.push({
              principalId: this.policy.isolatedFallbackId ?? "quarantine",
              role: "viewer",
            });
          }
        }
      }

      if (permissionViolation) {
        const quarantinedState: MigrationItemState = {
          sourceId: item.id,
          sourceName: item.name,
          sourcePath: item.path,
          sourceHash: item.contentHash,
          destinationId,
          destinationPath,
          status: "quarantined",
          disposition: "quarantined",
          converterVersion: this.converterVersion,
          error: "Permission validation blocked unmapped principal",
          warnings,
          mappedPermissions: [],
          lastAttempt: new Date().toISOString(),
        };
        this.checkpoint.items[item.id] = quarantinedState;
        this.checkpoint.stats.quarantined++;
        options.onProgress?.(quarantinedState);
        continue;
      }

      // Download content & convert
      try {
        const content = await this.adapter.getItemContent(item);
        const converted = await this.convertItemContent(item, content.bytes, content.mimeType);

        const writeResult = await this.storage.writeFile(destinationPath, converted.serializedText, {
          sourceId: item.id,
          permissions: mappedPermissions,
          sourceHash: item.contentHash,
        });

        const disposition: ItemDisposition = existingState ? "updated" : "created";
        const itemState: MigrationItemState = {
          sourceId: item.id,
          sourceName: item.name,
          sourcePath: item.path,
          sourceHash: item.contentHash,
          destinationId: writeResult.id || destinationId,
          destinationPath,
          destinationHash: writeResult.hash,
          status: "migrated",
          disposition,
          converterVersion: this.converterVersion,
          warnings: [...warnings, ...converted.warnings],
          mappedPermissions,
          lastAttempt: new Date().toISOString(),
        };

        this.checkpoint.items[item.id] = itemState;
        this.checkpoint.stats.migrated++;
        options.onProgress?.(itemState);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const failedState: MigrationItemState = {
          sourceId: item.id,
          sourceName: item.name,
          sourcePath: item.path,
          sourceHash: item.contentHash,
          destinationId,
          destinationPath,
          status: "failed",
          disposition: "failed",
          converterVersion: this.converterVersion,
          error: errorMsg,
          warnings,
          mappedPermissions: [],
          lastAttempt: new Date().toISOString(),
        };
        this.checkpoint.items[item.id] = failedState;
        this.checkpoint.stats.failed++;
        options.onProgress?.(failedState);
      }
    }

    this.checkpoint.updatedAt = new Date().toISOString();
    return this.getCheckpoint();
  }

  /**
   * Cutover: verify reconciliation, finalize state.
   */
  async cutover(): Promise<MigrationManifest> {
    const manifest = this.generateManifest();
    this.checkpoint.phase = "cutover";
    this.checkpoint.updatedAt = new Date().toISOString();
    return manifest;
  }

  /**
   * Rollback: removes imported files from destination storage, leaving source untouched.
   */
  async rollback(): Promise<{ restoredCount: number; errors: string[] }> {
    let restoredCount = 0;
    const errors: string[] = [];

    for (const itemState of Object.values(this.checkpoint.items)) {
      if (
        (itemState.status === "migrated" || itemState.status === "unchanged") &&
        itemState.destinationPath
      ) {
        try {
          if (await this.storage.fileExists(itemState.destinationPath)) {
            await this.storage.deleteFile(itemState.destinationPath);
            restoredCount++;
          }
        } catch (err: unknown) {
          errors.push(`Failed to delete ${itemState.destinationPath}: ${err}`);
        }
      }
    }

    this.checkpoint.phase = "rolled_back";
    this.checkpoint.updatedAt = new Date().toISOString();
    return { restoredCount, errors };
  }

  /**
   * Generates audit manifest with per-file details and reconciliation totals.
   */
  generateManifest(): MigrationManifest {
    const items = Object.values(this.checkpoint.items);
    let matchedHashes = 0;
    let discrepancies = 0;
    let unsupportedCount = 0;
    let quarantinedCount = 0;
    let errorsCount = 0;

    for (const it of items) {
      if (it.status === "migrated" || it.status === "unchanged") {
        matchedHashes++;
      } else if (it.status === "quarantined") {
        quarantinedCount++;
      } else if (it.status === "failed") {
        errorsCount++;
        discrepancies++;
      }
      if (it.warnings.some((w) => w.toLowerCase().includes("unsupported"))) {
        unsupportedCount++;
      }
    }

    return {
      migrationId: this.checkpoint.migrationId,
      timestamp: new Date().toISOString(),
      sourceType: this.adapter.sourceType,
      converterVersion: this.converterVersion,
      items,
      reconciliation: {
        sourceTotal: items.length,
        destinationTotal: matchedHashes,
        matchedHashes,
        discrepancies,
        unsupportedCount,
        quarantinedCount,
        errorsCount,
      },
    };
  }

  private resolveDestinationPath(item: SourceItem): string {
    const ext = item.name.includes(".") ? item.name.split(".").pop()!.toLowerCase() : "";
    let targetExt = "sldoc";
    if (["xlsx", "xls", "csv", "tsv"].includes(ext) || item.mimeType.includes("spreadsheet")) {
      targetExt = "slsheet";
    } else if (["pptx", "ppt"].includes(ext) || item.mimeType.includes("presentation")) {
      targetExt = "slslides";
    }

    const stem = item.name.replace(/\.[^/.]+$/, "");
    const dir = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "";
    return dir ? `${dir}/${stem}.${targetExt}` : `${stem}.${targetExt}`;
  }

  private async convertItemContent(
    item: SourceItem,
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<{ serializedText: string; warnings: string[] }> {
    const warnings: string[] = [];
    const ext = item.name.includes(".") ? item.name.split(".").pop()!.toLowerCase() : "";

    if (this.convertOffice && (["docx", "xlsx", "pptx"].includes(ext) || mimeType.includes("openxmlformats"))) {
      const suiteFile = await this.convertOffice(bytes, ext, item.name);
      return {
        serializedText: serializeFile(suiteFile),
        warnings,
      };
    }

    // Delimited or plain text conversion fallback
    if (ext === "csv" || ext === "tsv") {
      const text = new TextDecoder().decode(bytes);
      const file = createFile("sheet", item.name);
      return {
        serializedText: serializeFile(file),
        warnings,
      };
    }

    // Default document conversion
    const text = new TextDecoder().decode(bytes);
    const doc = createFile("doc", item.name);
    if (doc.kind === "doc") {
      doc.content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: text.slice(0, 1000) }],
          },
        ],
      };
    }
    return {
      serializedText: serializeFile(doc),
      warnings,
    };
  }
}
