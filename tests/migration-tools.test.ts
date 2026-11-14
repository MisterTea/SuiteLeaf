import { describe, expect, it, vi } from "vitest";
import { GoogleDriveAdapter, SharePointAdapter, LocalDirectoryAdapter, MigrationEngine, type IdentityMappingRule, type MigrationStorageAdapter, type SourceItem } from "../packages/core/src/migration";
import { importDirectory } from "../apps/desktop/src/directory-import";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

class InMemoryStorageAdapter implements MigrationStorageAdapter {
  files: Map<string, { content: string | Uint8Array; metadata?: Record<string, unknown> }> = new Map();

  async writeFile(
    destinationPath: string,
    content: string | Uint8Array,
    metadata?: Record<string, unknown>,
  ): Promise<{ id: string; hash: string }> {
    this.files.set(destinationPath, { content, metadata });
    return {
      id: "dest_" + destinationPath.replace(/[^a-zA-Z0-9]/g, "_"),
      hash: "hash_" + destinationPath,
    };
  }

  async deleteFile(destinationPath: string): Promise<void> {
    this.files.delete(destinationPath);
  }

  async fileExists(destinationPath: string): Promise<boolean> {
    return this.files.has(destinationPath);
  }

  async readFile(destinationPath: string): Promise<Uint8Array | string> {
    const entry = this.files.get(destinationPath);
    if (!entry) throw new Error("File not found");
    return entry.content;
  }
}

describe("WP-028: Migration Adapters & Engine", () => {
  it("handles Google Drive pagination, rate limits, and token refresh", async () => {
    const adapter = new GoogleDriveAdapter({
      clientId: "test-client",
      clientSecret: "test-secret",
      refreshToken: "test-refresh",
      tokenExpiresAt: Date.now() - 1000, // expired to test auto-refresh
    });

    const items: Array<{ item: SourceItem; data: Uint8Array }> = [];
    for (let i = 1; i <= 65; i++) {
      items.push({
        item: {
          id: `gdrive_file_${i}`,
          name: `Doc_${i}.docx`,
          path: `work/Doc_${i}.docx`,
          type: "file",
          mimeType: "application/vnd.google-apps.document",
          size: 1024,
          contentHash: `hash_${i}`,
          modifiedTime: "2026-11-01T00:00:00Z",
          permissions: [
            {
              principal: { id: "p1", email: "alice@acme.com", type: "user" },
              role: "owner",
              inherited: false,
            },
          ],
        },
        data: new TextEncoder().encode(`Content for file ${i}`),
      });
    }
    adapter.setMockFiles(items);

    // Page 1
    const page1 = await adapter.listInventory();
    expect(page1.items).toHaveLength(50);
    expect(page1.nextCursor).toBe("50");

    // Page 2
    const page2 = await adapter.listInventory(page1.nextCursor);
    expect(page2.items).toHaveLength(15);
    expect(page2.nextCursor).toBeUndefined();

    // Rate limit handling with retry
    adapter.setRateLimitTrigger(true);
    const content = await adapter.getItemContent(items[0].item);
    expect(new TextDecoder().decode(content.bytes)).toBe("Content for file 1");
    // Google Doc export converts to docx mimeType
    expect(content.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    // Test Google Spreadsheet and Presentation export mime conversion
    const sheetItem: SourceItem = {
      ...items[0].item,
      id: "g_sheet",
      mimeType: "application/vnd.google-apps.spreadsheet",
    };
    const slideItem: SourceItem = {
      ...items[0].item,
      id: "g_slide",
      mimeType: "application/vnd.google-apps.presentation",
    };
    adapter.setMockFiles([
      ...items,
      { item: sheetItem, data: new Uint8Array() },
      { item: slideItem, data: new Uint8Array() },
    ]);
    const sheetContent = await adapter.getItemContent(sheetItem);
    expect(sheetContent.mimeType).toContain("spreadsheetml.sheet");
    const slideContent = await adapter.getItemContent(slideItem);
    expect(slideContent.mimeType).toContain("presentationml.presentation");

    const perms = await adapter.getPermissions(sheetItem.id);
    expect(perms).toHaveLength(1);

    await expect(
      adapter.getItemContent({
        ...sheetItem,
        id: "nonexistent",
      }),
    ).rejects.toThrow("not found");
  });

  it("handles SharePoint / OneDrive pagination and throttle retries", async () => {
    const adapter = new SharePointAdapter({
      tenantId: "tenant-123",
      clientId: "client-abc",
      clientSecret: "secret-xyz",
      driveId: "drive-main",
    });

    const items: Array<{ item: SourceItem; data: Uint8Array }> = [
      {
        item: {
          id: "sp_1",
          name: "Report.xlsx",
          path: "finance/Report.xlsx",
          type: "file",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: 2048,
          contentHash: "sp_hash_1",
          modifiedTime: "2026-11-01T10:00:00Z",
          permissions: [
            {
              principal: { id: "user_bob", email: "bob@acme.com", type: "user" },
              role: "editor",
              inherited: false,
            },
          ],
        },
        data: new TextEncoder().encode("Spreadsheet content"),
      },
    ];
    adapter.setMockFiles(items);

    const page = await adapter.listInventory();
    expect(page.items).toHaveLength(1);

    adapter.setThrottleTrigger(true);
    const content = await adapter.getItemContent(items[0].item);
    expect(new TextDecoder().decode(content.bytes)).toBe("Spreadsheet content");

    const spPerms = await adapter.getPermissions("sp_1");
    expect(spPerms).toHaveLength(1);

    await expect(
      adapter.getItemContent({
        ...items[0].item,
        id: "missing_sp",
      }),
    ).rejects.toThrow("not found");
  });

  it("produces preflight report identifying duplicate names, unmapped identities, and macro risks", async () => {
    const adapter = new GoogleDriveAdapter({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
    });

    const items: Array<{ item: SourceItem; data: Uint8Array }> = [
      {
        item: {
          id: "doc1",
          name: "Annual Plan.docx",
          path: "plans/Annual Plan.docx",
          type: "file",
          mimeType: "application/vnd.google-apps.document",
          size: 5000,
          contentHash: "h1",
          modifiedTime: "2026-11-01T00:00:00Z",
          permissions: [
            {
              principal: { id: "u1", email: "alice@acme.com", type: "user" },
              role: "owner",
              inherited: false,
            },
            {
              principal: { id: "u2", email: "charlie_unmapped@acme.com", type: "user" },
              role: "viewer",
              inherited: false,
            },
          ],
        },
        data: new Uint8Array(),
      },
      {
        item: {
          id: "doc2",
          name: "Annual Plan.docx", // duplicate filename in same folder
          path: "plans/Annual Plan.docx",
          type: "file",
          mimeType: "application/vnd.google-apps.document",
          size: 6000,
          contentHash: "h2",
          modifiedTime: "2026-11-01T01:00:00Z",
          permissions: [],
        },
        data: new Uint8Array(),
      },
      {
        item: {
          id: "doc3",
          name: "Macros.docm",
          path: "tools/Macros.docm",
          type: "file",
          mimeType: "application/vnd.ms-word.document.macroEnabled.12",
          size: 3000,
          contentHash: "h3",
          modifiedTime: "2026-11-01T02:00:00Z",
          permissions: [],
        },
        data: new Uint8Array(),
      },
      {
        item: {
          id: "doc4",
          name: "Archive.rar", // unsupported format
          path: "files/Archive.rar",
          type: "file",
          mimeType: "application/x-rar-compressed",
          size: 10000,
          contentHash: "h4",
          modifiedTime: "2026-11-01T03:00:00Z",
          permissions: [],
        },
        data: new Uint8Array(),
      },
    ];
    adapter.setMockFiles(items);

    const storage = new InMemoryStorageAdapter();
    const identityRules: IdentityMappingRule[] = [
      { source: "alice@acme.com", target: "suiteleaf_user_alice", targetType: "user" },
    ];

    const engine = new MigrationEngine({
      adapter,
      storage,
      identityRules,
      policy: { unmappedIdentity: "block" },
    });

    const preflight = await engine.runPreflight();
    expect(preflight.totalFiles).toBe(4);
    expect(preflight.totalBytes).toBe(24000);
    // Identifies duplicate filename
    expect(preflight.conversionLossRisks.some((r) => r.warning.includes("Duplicate filename"))).toBe(true);
    // Identifies macro warning
    expect(preflight.conversionLossRisks.some((r) => r.warning.includes("VBA macros"))).toBe(true);
    // Identifies unsupported format
    expect(preflight.unsupportedFormats.some((f) => f.extension === "rar")).toBe(true);
    // Identifies unmapped identity
    expect(preflight.unmappedIdentities.some((u) => u.email === "charlie_unmapped@acme.com")).toBe(true);
    expect(preflight.valid).toBe(false); // block policy fails valid flag when unmapped identities exist
  });

  it("enforces permission policy: isolates or blocks unmapped identities instead of broadening access", async () => {
    const adapter = new GoogleDriveAdapter({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
    });

    const items: Array<{ item: SourceItem; data: Uint8Array }> = [
      {
        item: {
          id: "item_p1",
          name: "Confidential.docx",
          path: "legal/Confidential.docx",
          type: "file",
          mimeType: "application/vnd.google-apps.document",
          size: 1000,
          contentHash: "hash_p1",
          modifiedTime: "2026-11-01T00:00:00Z",
          permissions: [
            {
              principal: { id: "unmapped_external", email: "stranger@external.com", type: "user" },
              role: "editor",
              inherited: false,
            },
          ],
        },
        data: new TextEncoder().encode("Legal text"),
      },
    ];
    adapter.setMockFiles(items);

    // Test 1: Policy = "block" -> item is quarantined and not written
    const storage1 = new InMemoryStorageAdapter();
    const engine1 = new MigrationEngine({
      adapter,
      storage: storage1,
      policy: { unmappedIdentity: "block" },
    });

    const checkpoint1 = await engine1.runMigration();
    expect(checkpoint1.stats.quarantined).toBe(1);
    expect(checkpoint1.items["item_p1"].status).toBe("quarantined");
    expect(storage1.files.size).toBe(0); // Not written

    // Test 2: Policy = "isolate" -> item is migrated but permission is restricted to admin quarantine
    const storage2 = new InMemoryStorageAdapter();
    const engine2 = new MigrationEngine({
      adapter,
      storage: storage2,
      policy: { unmappedIdentity: "isolate", isolatedFallbackId: "admin_vault" },
    });

    const checkpoint2 = await engine2.runMigration();
    expect(checkpoint2.stats.migrated).toBe(1);
    expect(checkpoint2.items["item_p1"].mappedPermissions).toEqual([
      { principalId: "admin_vault", role: "viewer" },
    ]);
    expect(storage2.files.size).toBe(1);
  });

  it("resumes interrupted migration without duplicate files and supports delta reruns", async () => {
    const adapter = new GoogleDriveAdapter({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
    });

    const files: Array<{ item: SourceItem; data: Uint8Array }> = [
      {
        item: {
          id: "file_a",
          name: "FileA.docx",
          path: "dept/FileA.docx",
          type: "file",
          mimeType: "application/vnd.google-apps.document",
          size: 100,
          contentHash: "hash_a_v1",
          modifiedTime: "2026-11-01T00:00:00Z",
          permissions: [],
        },
        data: new TextEncoder().encode("Content A"),
      },
      {
        item: {
          id: "file_b",
          name: "FileB.docx",
          path: "dept/FileB.docx",
          type: "file",
          mimeType: "application/vnd.google-apps.document",
          size: 200,
          contentHash: "hash_b_v1",
          modifiedTime: "2026-11-01T00:00:00Z",
          permissions: [],
        },
        data: new TextEncoder().encode("Content B"),
      },
    ];
    adapter.setMockFiles(files);

    const storage = new InMemoryStorageAdapter();
    const engine = new MigrationEngine({ adapter, storage });

    // Step 1: Run with sample limit = 1 to simulate interruption after 1 file
    const partialCheckpoint = await engine.runMigration({ sampleLimit: 1 });
    expect(partialCheckpoint.stats.migrated).toBe(1);
    expect(partialCheckpoint.items["file_a"].status).toBe("migrated");
    expect(partialCheckpoint.items["file_b"]).toBeUndefined();
    expect(storage.files.size).toBe(1);

    // Step 2: Resume migration using the existing checkpoint
    const resumedEngine = new MigrationEngine({
      adapter,
      storage,
      checkpoint: partialCheckpoint,
    });
    const resumedCheckpoint = await resumedEngine.runMigration();

    // file_a was already migrated with same hash -> skipped_unchanged
    // file_b is newly migrated
    expect(resumedCheckpoint.items["file_a"].status).toBe("unchanged");
    expect(resumedCheckpoint.items["file_b"].status).toBe("migrated");
    expect(storage.files.size).toBe(2);

    // Step 3: Delta pass with modified file_b
    files[1].item.contentHash = "hash_b_v2";
    files[1].data = new TextEncoder().encode("Updated Content B");
    adapter.setMockFiles(files);

    const deltaEngine = new MigrationEngine({
      adapter,
      storage,
      checkpoint: resumedCheckpoint,
    });
    const deltaCheckpoint = await deltaEngine.runMigration({ deltaOnly: true });

    expect(deltaCheckpoint.items["file_a"].status).toBe("unchanged");
    expect(deltaCheckpoint.items["file_b"].status).toBe("migrated");
    expect(deltaCheckpoint.items["file_b"].disposition).toBe("updated");
    expect(storage.files.size).toBe(2); // No extra duplicate copies created!

    // Step 4: Cutover and Manifest inspection
    const manifest = await deltaEngine.cutover();
    expect(manifest.reconciliation.sourceTotal).toBe(2);
    expect(manifest.reconciliation.matchedHashes).toBe(2);
    expect(manifest.reconciliation.discrepancies).toBe(0);

    // Step 5: Rollback
    const rollback = await deltaEngine.rollback();
    expect(rollback.restoredCount).toBe(2);
    expect(storage.files.size).toBe(0); // Cleanly rolled back destination
  });

  it("supports LocalDirectoryAdapter inventory, permissions, and reading", async () => {
    const rawData = new TextEncoder().encode("Hello local file");
    const adapter = new LocalDirectoryAdapter([
      {
        path: "sub/test.txt",
        name: "test.txt",
        data: rawData,
        mimeType: "text/plain",
      },
    ]);

    expect(await adapter.authenticate()).toBe(true);
    const page = await adapter.listInventory();
    expect(page.items).toHaveLength(1);
    expect(page.items[0].name).toBe("test.txt");

    const content = await adapter.getItemContent(page.items[0]);
    expect(content.bytes).toEqual(rawData);

    const perms = await adapter.getPermissions(page.items[0].id);
    expect(perms).toHaveLength(1);
    expect(perms[0].role).toBe("owner");

    // Missing item error check
    await expect(
      adapter.getItemContent({
        id: "missing_id",
        name: "none",
        path: "none",
        type: "file",
        mimeType: "text/plain",
        size: 0,
        contentHash: "",
        modifiedTime: "",
        permissions: [],
      }),
    ).rejects.toThrow("not found");
  });

  it("handles custom convertOffice and CSV conversions with folder items", async () => {
    const adapter = new GoogleDriveAdapter({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
    });

    const csvData = new TextEncoder().encode("col1,col2\nval1,val2");
    const docxData = new TextEncoder().encode("fake docx");

    const items: Array<{ item: SourceItem; data: Uint8Array }> = [
      {
        item: {
          id: "folder_1",
          name: "My Folder",
          path: "My Folder",
          type: "folder",
          mimeType: "application/vnd.google-apps.folder",
          size: 0,
          contentHash: "folder_hash",
          modifiedTime: "2026-11-01T00:00:00Z",
          permissions: [],
        },
        data: new Uint8Array(),
      },
      {
        item: {
          id: "sheet_csv",
          name: "data.csv",
          path: "data.csv",
          type: "file",
          mimeType: "text/csv",
          size: csvData.byteLength,
          contentHash: "csv_hash",
          modifiedTime: "2026-11-01T00:00:00Z",
          permissions: [],
        },
        data: csvData,
      },
      {
        item: {
          id: "office_doc",
          name: "doc.docx",
          path: "doc.docx",
          type: "file",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: docxData.byteLength,
          contentHash: "docx_hash",
          modifiedTime: "2026-11-01T00:00:00Z",
          permissions: [],
        },
        data: docxData,
      },
    ];
    adapter.setMockFiles(items);

    const storage = new InMemoryStorageAdapter();
    const mockConvertOffice = vi.fn().mockImplementation(async (_bytes, _format, name) => {
      const { createFile } = await import("../packages/core/src/native-file");
      return createFile("doc", name);
    });

    const engine = new MigrationEngine({
      adapter,
      storage,
      convertOffice: mockConvertOffice,
    });

    const checkpoint = await engine.runMigration();
    // folder is skipped, csv and office_doc are migrated
    expect(checkpoint.stats.migrated).toBe(2);
    expect(mockConvertOffice).toHaveBeenCalledTimes(1);
    expect(storage.files.has("data.slsheet")).toBe(true);
    expect(storage.files.has("doc.sldoc")).toBe(true);
  });

  it("desktop directory import with --idempotent avoids creating duplicate copies on rerun", async () => {
    const root = await mkdtemp(join(tmpdir(), "suiteleaf-idempotent-"));
    const src = join(root, "source");
    const dst = join(root, "dest");
    await mkdir(src);
    await mkdir(dst);

    try {
      await writeFile(join(src, "doc1.txt"), "Version 1 text");

      // First run: imports doc1
      const res1 = await importDirectory(src, dst, { idempotent: true });
      expect(res1.imported).toBe(1);
      expect(res1.skipped).toBe(0);

      // Second run: doc1 unchanged -> skipped, no (1) copy created!
      const res2 = await importDirectory(src, dst, { idempotent: true });
      expect(res2.imported).toBe(0);
      expect(res2.skipped).toBe(1);

      // Modify doc1: rerun imports updated file without creating duplicate copy
      await writeFile(join(src, "doc1.txt"), "Version 2 updated text");
      const res3 = await importDirectory(src, dst, { idempotent: true });
      expect(res3.imported).toBe(1);
      expect(res3.skipped).toBe(0);

      const destFile = await readFile(join(dst, "doc1.sldoc"), "utf8");
      expect(destFile).toContain("Version 2 updated text");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
