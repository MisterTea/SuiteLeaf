import { describe, expect, it } from "vitest";
import { createFile, parseFile, serializeFile, type SlideFile, type DocFile, type SheetFile, type FileRecord, checkOfflineReadiness, OfflinePinManager, createPortableSlideBundle, verifyPortableSlideBundle, evaluateOfflinePolicy, explainOfflineRevocation } from "../packages/core/src";

describe("WP-006 Verified offline work and portable presentation bundles", () => {
  it("prevents a misleading ready label when assets are missing and lists explicit remedies", () => {
    const file = createFile("slide", "Sales Pitch") as SlideFile;
    const slideId = file.content.slideOrder[0];
    file.content.slides[slideId].elements = [
      {
        id: "hero-photo",
        type: "image",
        x: 10,
        y: 10,
        width: 300,
        height: 200,
        src: "https://example.com/assets/unpinned-hero.png",
      },
      {
        id: "custom-brand-heading",
        type: "text",
        x: 10,
        y: 220,
        width: 400,
        height: 60,
        content: "Custom Typography Title",
        fontFamily: "BrandCustomNonStandardFont",
      },
    ];

    // Check readiness when cache does not contain the remote URL
    const report = checkOfflineReadiness(file, {
      localCacheUrls: new Set(["https://example.com/other.png"]),
      installedFonts: new Set(["Calibri", "Arial"]),
      isStoragePersisted: false,
    });

    // Required image is missing, so report must NOT be ready!
    expect(report.isReady).toBe(false);
    expect(report.status).toBe("missing");
    expect(report.missingAssets.length).toBeGreaterThanOrEqual(1);

    const missingMedia = report.missingAssets.find((a) => a.type === "media");
    expect(missingMedia).toBeDefined();
    expect(missingMedia?.remedy).toContain("unpinned-hero.png");

    const fontAsset = report.assets.find((a) => a.type === "font");
    expect(fontAsset?.status).toBe("missing");
    expect(fontAsset?.remedy).toContain("BrandCustomNonStandardFont");

    // Eviction risk flagged because storage is not persistent
    expect(report.evictionRisk.level).toBe("high");
    expect(report.evictionRisk.persisted).toBe(false);
    expect(report.evictionRisk.recommendation).toContain("persistent browser storage");
  });

  it("verifies offline readiness when all assets are embedded or cached and storage is persisted", () => {
    const file = createFile("slide", "Offline Safe Deck") as SlideFile;
    const slideId = file.content.slideOrder[0];
    file.content.slides[slideId].elements = [
      {
        id: "embedded-logo",
        type: "image",
        x: 20,
        y: 20,
        width: 100,
        height: 100,
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
      {
        id: "heading",
        type: "text",
        x: 20,
        y: 130,
        width: 400,
        height: 50,
        content: "Standard Willow Typography",
        fontFamily: "SuiteLeaf Willow",
      },
    ];

    const report = checkOfflineReadiness(file, {
      isStoragePersisted: true,
    });

    expect(report.isReady).toBe(true);
    expect(report.status).toBe("ready");
    expect(report.missingAssets).toEqual([]);
    expect(report.remedies).toEqual([]);
    expect(report.evictionRisk.level).toBe("low");
    expect(report.evictionRisk.persisted).toBe(true);
  });

  it("manages offline pins for files and folders", () => {
    const pinMgr = new OfflinePinManager();
    const doc = createFile("doc", "Pinned Quarterly Report");

    const pin = pinMgr.pinFile(doc, "folder", "folder-finance-123");
    expect(pin.fileId).toBe(doc.id);
    expect(pin.pinScope).toBe("folder");
    expect(pin.folderId).toBe("folder-finance-123");
    expect(pinMgr.isPinned(doc.id)).toBe(true);
    expect(pinMgr.listPins()).toHaveLength(1);

    expect(pinMgr.unpinFile(doc.id)).toBe(true);
    expect(pinMgr.isPinned(doc.id)).toBe(false);
    expect(pinMgr.listPins()).toHaveLength(0);
  });

  it("creates a self-contained portable slide bundle that passes integrity and network isolation checks", async () => {
    const file = createFile("slide", "Keynote Deck") as SlideFile;
    const slideId = file.content.slideOrder[0];
    file.content.slides[slideId].notes = "Remember to pause after slide intro.";
    file.content.slides[slideId].elements = [
      {
        id: "title",
        type: "text",
        x: 50,
        y: 50,
        width: 800,
        height: 80,
        content: "Keynote 2026",
        fontFamily: "Arial",
        bold: true,
      },
      {
        id: "key-metric-table",
        type: "table",
        x: 50,
        y: 150,
        width: 400,
        height: 150,
        rows: [["Year", "Revenue"], ["2025", "$50M"], ["2026", "$120M"]],
      },
      {
        id: "hero-icon",
        type: "image",
        x: 500,
        y: 150,
        width: 200,
        height: 200,
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
    ];

    const bundleBytes = await createPortableSlideBundle(file);
    expect(bundleBytes).toBeInstanceOf(Uint8Array);

    const verification = await verifyPortableSlideBundle(bundleBytes);
    expect(verification.valid).toBe(true);
    expect(verification.networkIsolated).toBe(true);
    expect(verification.errors).toEqual([]);
    expect(verification.manifest.offlineSelfContained).toBe(true);
    expect(verification.verifiedFiles).toContain("deck.json");
    expect(verification.verifiedFiles).toContain("index.html");
    expect(verification.verifiedFiles).toContain("LICENSE_NOTICES.txt");
  });

  it("enforces managed offline policy leases without silently deleting unsynchronized edits", () => {
    const baseFile = createFile("sheet", "Revenue Model") as SheetFile;
    const pastTime = new Date("2026-11-01T10:00:00.000Z");
    const currentTime = new Date("2026-11-04T12:00:00.000Z");

    // Case 1: Unmanaged local file (no SuiteDrive link) -> editing always permitted
    const unmanagedRecord: FileRecord = { file: baseFile };
    const unmanagedDecision = evaluateOfflinePolicy(unmanagedRecord, null, currentTime);
    expect(unmanagedDecision.allowed).toBe(true);
    expect(unmanagedDecision.action).toBe("allow-edit");

    // Case 2: Managed file with active lease
    const managedRecord: FileRecord = {
      file: baseFile,
      drive: {
        serverUrl: "https://drive.example.com",
        remoteId: "drive-rev-99",
        syncedAt: pastTime.toISOString(),
      },
    };

    const activeLease = {
      userId: "user-alice@example.com",
      leaseExpiresAt: "2026-11-05T00:00:00.000Z", // future
      lastAuthenticatedAt: pastTime.toISOString(),
      policy: {
        requireAuthentication: true,
        maxOfflineHours: 72,
        allowOfflineExport: true,
        preventSilentDeletion: true,
      },
    };

    const activeDecision = evaluateOfflinePolicy(managedRecord, activeLease, currentTime);
    expect(activeDecision.allowed).toBe(true);
    expect(activeDecision.action).toBe("allow-edit");

    // Case 3: Managed file whose lease has expired BUT has local unsynchronized edits
    const expiredLease = {
      ...activeLease,
      leaseExpiresAt: "2026-11-02T00:00:00.000Z", // expired before currentTime
    };

    // User made offline edits (file.updatedAt > drive.syncedAt)
    const editedFile = {
      ...baseFile,
      updatedAt: "2026-11-03T15:00:00.000Z",
    };
    const recordWithUnsyncedEdits: FileRecord = {
      file: editedFile,
      drive: managedRecord.drive,
    };

    const expiredDecision = evaluateOfflinePolicy(recordWithUnsyncedEdits, expiredLease, currentTime);
    expect(expiredDecision.allowed).toBe(false);
    expect(expiredDecision.action).toBe("unsynced-preserved");
    expect(expiredDecision.unsyncedEditsRetained).toBe(true);
    expect(expiredDecision.notice).toContain("unsynchronized edits remain safely preserved");

    // Case 4: Access-revocation boundary explanation
    const explanation = explainOfflineRevocation(managedRecord);
    expect(explanation.serverScope).toContain("SuiteDrive immediately denies future sync");
    expect(explanation.localScope).toContain("cannot be remotely retracted or erased over the network");
    expect(explanation.limitations).toContain("local device encryption");
  });

  it("a verified file serializes, deserializes, and re-edits offline cleanly", () => {
    const file = createFile("doc", "Field Inspection Notes") as DocFile;
    file.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Initial offline observation." }],
        },
      ],
    } as any;

    // Simulate closing app / restart by serializing and deserializing
    const serialized = serializeFile(file);
    const restored = parseFile(serialized) as DocFile;

    expect(restored.id).toBe(file.id);
    expect(restored.title).toBe("Field Inspection Notes");

    // Edit restored file offline
    restored.title = "Field Inspection Notes (Updated Offline)";
    restored.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Appended offline observation at 14:00." }],
        },
      ],
    } as any;

    const reSaved = serializeFile(restored);
    const reParsed = parseFile(reSaved);
    expect(reParsed.title).toBe("Field Inspection Notes (Updated Offline)");
  });
});
