import { describe, expect, it } from "vitest";
import type { SuiteFile } from "@suiteleaf/core";
import {
  MobileLifecycleManager,
  checkMobileOperationSupport,
} from "../apps/web/src/mobile-workflow";

describe("Mobile and touch workflows (WP-030)", () => {
  const sampleDoc: SuiteFile = {
    id: "doc-mobile-1",
    title: "Mobile Report",
    kind: "document",
    createdAt: "2026-11-04T00:00:00Z",
    updatedAt: "2026-11-04T00:00:00Z",
    content: {
      paragraphs: [{ text: "Hello mobile world" }],
    },
  };

  it("identifies unsupported mobile operations before users begin destructive or expensive work", () => {
    // When on desktop, no warning
    expect(checkMobileOperationSupport("macro_execution", false)).toBeNull();

    // When on mobile, reports clear warning and non-destructive alternative
    const macroCheck = checkMobileOperationSupport("macro_execution", true);
    expect(macroCheck).not.toBeNull();
    expect(macroCheck?.supportedOnMobile).toBe(false);
    expect(macroCheck?.message).toContain("macro scripts cannot execute on mobile");
    expect(macroCheck?.alternativeRecommendation).toContain("run macros on desktop");

    const queryCheck = checkMobileOperationSupport("high_capacity_query_refresh", true);
    expect(queryCheck?.supportedOnMobile).toBe(false);
    expect(queryCheck?.alternativeRecommendation).toContain("background server sync");

    const presenterCheck = checkMobileOperationSupport("multi_display_presenter", true);
    expect(presenterCheck?.supportedOnMobile).toBe(false);
    expect(presenterCheck?.alternativeRecommendation).toContain("mirror mode");

    const spoolCheck = checkMobileOperationSupport("raw_printer_direct_spool", true);
    expect(spoolCheck?.supportedOnMobile).toBe(false);
    expect(spoolCheck?.alternativeRecommendation).toContain("Export as PDF");
  });

  it("preserves unsaved edits across app backgrounding and orientation changes", () => {
    const manager = new MobileLifecycleManager();

    // Stage unsaved content
    manager.stageUnsavedEdit("doc-mobile-1", { text: "Unsaved mobile notes" }, 2);
    expect(manager.getUnsavedDraft("doc-mobile-1")?.content).toEqual({ text: "Unsaved mobile notes" });

    // Orientation change from portrait to landscape
    const orientResult = manager.handleOrientationChange("landscape");
    expect(orientResult.orientation).toBe("landscape");
    expect(orientResult.draftsPreserved).toBe(1);
    expect(manager.getOrientation()).toBe("landscape");

    // App backgrounding (user switches apps or locks screen)
    const bgResult = manager.handleVisibilityChange(true);
    expect(bgResult.savedDraftCount).toBe(1);
    expect(manager.isAppBackgrounded()).toBe(true);

    // Draft remains intact and can be retrieved
    const draftAfterBg = manager.getUnsavedDraft("doc-mobile-1");
    expect(draftAfterBg).toBeDefined();
    expect(draftAfterBg?.content).toEqual({ text: "Unsaved mobile notes" });
    expect(draftAfterBg?.revision).toBe(2);

    // App returns to foreground
    manager.handleVisibilityChange(false);
    expect(manager.isAppBackgrounded()).toBe(false);

    // Clear draft on successful save
    manager.clearUnsavedDraft("doc-mobile-1");
    expect(manager.getUnsavedDraft("doc-mobile-1")).toBeUndefined();
  });

  it("pauses active uploads upon backgrounding and resumes cleanly without stranding", () => {
    const manager = new MobileLifecycleManager();

    // Register active upload
    manager.registerUpload({
      id: "upl-101",
      fileId: "doc-mobile-1",
      fileName: "site-photo.jpg",
      totalBytes: 10000,
      uploadedBytes: 4000,
      chunkIndex: 4,
      totalChunks: 10,
      idempotencyKey: "idem-key-999",
      resumableToken: "resume-token-abc",
    });

    const activeUpl = manager.getPendingUpload("upl-101");
    expect(activeUpl?.status).toBe("uploading");

    // Backgrounding pauses active upload
    const bg = manager.handleVisibilityChange(true);
    expect(bg.pausedUploadCount).toBe(1);
    expect(manager.getPendingUpload("upl-101")?.status).toBe("paused");

    // Foregrounding marks upload ready to resume
    manager.handleVisibilityChange(false);
    expect(manager.getPendingUpload("upl-101")?.status).toBe("idle");

    // Resume upload proceeds from chunk 4 using resumable token and idempotency key
    const resume = manager.resumeUpload("upl-101");
    expect(resume.success).toBe(true);
    expect(resume.nextChunkIndex).toBe(4);
    expect(resume.resumableToken).toBe("resume-token-abc");
    expect(resume.idempotencyKey).toBe("idem-key-999");

    // Progress updates to completion
    manager.updateUploadProgress("upl-101", 10000, 10);
    expect(manager.getPendingUpload("upl-101")?.status).toBe("completed");

    // Unknown upload resume returns failure
    expect(manager.resumeUpload("non-existent").success).toBe(false);
  });

  it("verifies pinned content reopens offline according to WP-006 readiness state", () => {
    const manager = new MobileLifecycleManager();

    // Unpinned file cannot reopen offline
    const unpinnedCheck = manager.checkOfflineReopen(sampleDoc);
    expect(unpinnedCheck.isPinned).toBe(false);
    expect(unpinnedCheck.canReopenOffline).toBe(false);

    // Pin the file using the OfflinePinManager
    manager.pinManager.pinFile(sampleDoc);
    expect(manager.pinManager.isPinned(sampleDoc.id)).toBe(true);

    // Pinned file evaluates offline readiness and allows reopen
    const pinnedCheck = manager.checkOfflineReopen(sampleDoc);
    expect(pinnedCheck.isPinned).toBe(true);
    expect(pinnedCheck.canReopenOffline).toBe(true);
    expect(pinnedCheck.isReady).toBe(true);
    expect(pinnedCheck.status).toBe("ready");
  });
});
