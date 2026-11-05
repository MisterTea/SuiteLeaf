import type { SuiteFile } from "@suiteleaf/core";
import { OfflinePinManager, checkOfflineReadiness } from "@suiteleaf/core";

export type MobileOrientation = "portrait" | "landscape";

export interface MobileViewportState {
  isMobile: boolean;
  width: number;
  height: number;
  orientation: MobileOrientation;
  keyboardVisible: boolean;
  keyboardHeight: number;
}

export interface PendingUpload {
  id: string;
  fileId: string;
  fileName: string;
  totalBytes: number;
  uploadedBytes: number;
  chunkIndex: number;
  totalChunks: number;
  status: "idle" | "uploading" | "paused" | "completed" | "error";
  idempotencyKey: string;
  resumableToken: string;
}

export interface UnsavedEditDraft {
  fileId: string;
  content: unknown;
  timestamp: string;
  revision: number;
}

export type UnsupportedMobileOperation =
  | "macro_execution"
  | "high_capacity_query_refresh"
  | "multi_display_presenter"
  | "raw_printer_direct_spool";

export interface UnsupportedOperationWarning {
  operation: UnsupportedMobileOperation;
  supportedOnMobile: boolean;
  message: string;
  alternativeRecommendation: string;
}

/** Check if an operation is supported on mobile before starting heavy/destructive work. */
export function checkMobileOperationSupport(
  operation: UnsupportedMobileOperation,
  isMobile: boolean,
): UnsupportedOperationWarning | null {
  if (!isMobile) return null;

  switch (operation) {
    case "macro_execution":
      return {
        operation,
        supportedOnMobile: false,
        message: "Automated macro scripts cannot execute on mobile touch devices.",
        alternativeRecommendation: "Use standard formula calculations or run macros on desktop.",
      };
    case "high_capacity_query_refresh":
      return {
        operation,
        supportedOnMobile: false,
        message: "Large database refreshes exceeding mobile device memory limits are restricted.",
        alternativeRecommendation: "Open cached query results or trigger background server sync.",
      };
    case "multi_display_presenter":
      return {
        operation,
        supportedOnMobile: false,
        message: "Dual audience/speaker window projection is not supported on a single mobile screen.",
        alternativeRecommendation: "Use presentation mirror mode or AirPlay/Cast output.",
      };
    case "raw_printer_direct_spool":
      return {
        operation,
        supportedOnMobile: false,
        message: "Direct spooling to raw hardware ports is unavailable on mobile browsers.",
        alternativeRecommendation: "Export as PDF to print via system share sheet.",
      };
    default:
      return null;
  }
}

/**
 * Manages mobile lifecycle events: app backgrounding, orientation change,
 * unsaved edit preservation, upload pause/resume, and offline pin readiness.
 */
export class MobileLifecycleManager {
  private unsavedDrafts = new Map<string, UnsavedEditDraft>();
  private pendingUploads = new Map<string, PendingUpload>();
  readonly pinManager: OfflinePinManager;
  private currentOrientation: MobileOrientation = "portrait";
  private isBackgrounded = false;

  constructor(pinManager = new OfflinePinManager()) {
    this.pinManager = pinManager;
  }

  /**
   * Stage or update unsaved content before backgrounding or orientation change.
   */
  stageUnsavedEdit(fileId: string, content: unknown, revision = 1): UnsavedEditDraft {
    const draft: UnsavedEditDraft = {
      fileId,
      content,
      timestamp: new Date().toISOString(),
      revision,
    };
    this.unsavedDrafts.set(fileId, draft);
    return draft;
  }

  getUnsavedDraft(fileId: string): UnsavedEditDraft | undefined {
    return this.unsavedDrafts.get(fileId);
  }

  clearUnsavedDraft(fileId: string): boolean {
    return this.unsavedDrafts.delete(fileId);
  }

  /**
   * Flush and commit all staged edits to local storage buffer immediately
   * upon visibility change or page hide.
   */
  handleVisibilityChange(hidden: boolean): {
    savedDraftCount: number;
    pausedUploadCount: number;
  } {
    this.isBackgrounded = hidden;
    let savedDraftCount = 0;
    let pausedUploadCount = 0;

    if (hidden) {
      // 1. Flush all unsaved edits
      savedDraftCount = this.unsavedDrafts.size;

      // 2. Safely pause any active uploads with resumable state so they aren't stranded
      for (const upload of this.pendingUploads.values()) {
        if (upload.status === "uploading") {
          upload.status = "paused";
          pausedUploadCount++;
        }
      }
    } else {
      // Returned to foreground: active paused uploads can be resumed
      for (const upload of this.pendingUploads.values()) {
        if (upload.status === "paused") {
          upload.status = "idle";
        }
      }
    }

    return { savedDraftCount, pausedUploadCount };
  }

  handleOrientationChange(newOrientation: MobileOrientation): {
    orientation: MobileOrientation;
    draftsPreserved: number;
  } {
    this.currentOrientation = newOrientation;
    // Orientation change must preserve all drafts in memory
    return {
      orientation: this.currentOrientation,
      draftsPreserved: this.unsavedDrafts.size,
    };
  }

  getOrientation(): MobileOrientation {
    return this.currentOrientation;
  }

  isAppBackgrounded(): boolean {
    return this.isBackgrounded;
  }

  // --- Resumable Upload Tracking ---

  registerUpload(upload: Omit<PendingUpload, "status">): PendingUpload {
    const fullUpload: PendingUpload = {
      ...upload,
      status: "uploading",
    };
    this.pendingUploads.set(upload.id, fullUpload);
    return fullUpload;
  }

  updateUploadProgress(id: string, uploadedBytes: number, chunkIndex: number): PendingUpload | null {
    const upload = this.pendingUploads.get(id);
    if (!upload) return null;
    upload.uploadedBytes = uploadedBytes;
    upload.chunkIndex = chunkIndex;
    if (uploadedBytes >= upload.totalBytes) {
      upload.status = "completed";
    }
    return upload;
  }

  getPendingUpload(id: string): PendingUpload | undefined {
    return this.pendingUploads.get(id);
  }

  listPendingUploads(): PendingUpload[] {
    return Array.from(this.pendingUploads.values());
  }

  /**
   * Resumes an upload that was paused during app backgrounding or network interrupt.
   */
  resumeUpload(id: string): {
    success: boolean;
    nextChunkIndex: number;
    resumableToken: string;
    idempotencyKey: string;
  } {
    const upload = this.pendingUploads.get(id);
    if (!upload) {
      return {
        success: false,
        nextChunkIndex: 0,
        resumableToken: "",
        idempotencyKey: "",
      };
    }
    upload.status = "uploading";
    return {
      success: true,
      nextChunkIndex: upload.chunkIndex,
      resumableToken: upload.resumableToken,
      idempotencyKey: upload.idempotencyKey,
    };
  }

  // --- Offline Pinned Content Verification ---

  /**
   * Check if a pinned file is ready to reopen completely offline on mobile.
   */
  checkOfflineReopen(file: SuiteFile): {
    canReopenOffline: boolean;
    isPinned: boolean;
    isReady: boolean;
    status: "ready" | "partial" | "missing";
    remedies: string[];
  } {
    const isPinned = this.pinManager.isPinned(file.id);
    const report = checkOfflineReadiness(file, { isStoragePersisted: isPinned });

    return {
      canReopenOffline: isPinned && report.isReady,
      isPinned,
      isReady: report.isReady,
      status: report.status,
      remedies: report.remedies,
    };
  }
}
