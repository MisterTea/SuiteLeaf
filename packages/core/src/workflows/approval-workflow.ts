/**
 * Multi-reviewer document approval engine.
 * Binds approvals to immutable document versions and detects invalidation on edits.
 */

export type ApprovalState = "pending" | "approved" | "rejected" | "invalidated";

export interface ApprovalDecision {
  reviewerId: string;
  decision: "approved" | "rejected";
  timestamp: string;
  notes?: string;
}

export interface ReviewApproval {
  approvalId: string;
  fileId: string;
  fileName: string;
  versionId: string;
  documentHash: string; // SHA-256 of document content at time of request
  requiredReviewers: string[];
  decisions: ApprovalDecision[];
  status: ApprovalState;
  createdAt: string;
  completedAt?: string;
  invalidatedAt?: string;
}

export class ApprovalWorkflowManager {
  private approvals = new Map<string, ReviewApproval>(); // approvalId -> ReviewApproval

  /**
   * Request a new review approval for a specific document version and hash.
   */
  requestApproval(params: {
    approvalId?: string;
    fileId: string;
    fileName: string;
    versionId: string;
    documentHash: string;
    requiredReviewers: string[];
  }): ReviewApproval {
    if (!params.requiredReviewers.length) {
      throw new Error("Approval requires at least one reviewer.");
    }
    if (!params.documentHash.trim()) {
      throw new Error("Document content hash is required for immutable approval binding.");
    }

    const approvalId = params.approvalId ?? `appr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const approval: ReviewApproval = {
      approvalId,
      fileId: params.fileId,
      fileName: params.fileName,
      versionId: params.versionId,
      documentHash: params.documentHash,
      requiredReviewers: [...params.requiredReviewers],
      decisions: [],
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    this.approvals.set(approvalId, approval);
    return approval;
  }

  /**
   * Record a reviewer's decision.
   * Idempotent: duplicate calls by the same reviewer update their decision without duplication.
   */
  recordDecision(
    approvalId: string,
    reviewerId: string,
    decision: "approved" | "rejected",
    notes?: string,
  ): ReviewApproval {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      throw new Error(`Approval ${approvalId} not found.`);
    }

    if (!approval.requiredReviewers.includes(reviewerId)) {
      throw new Error(`Reviewer ${reviewerId} is not in required reviewer list for this approval.`);
    }

    if (approval.status === "invalidated") {
      throw new Error("Cannot decide an invalidated approval. Document has changed.");
    }

    // Upsert decision
    const existingIdx = approval.decisions.findIndex((d) => d.reviewerId === reviewerId);
    const decisionRecord: ApprovalDecision = {
      reviewerId,
      decision,
      timestamp: new Date().toISOString(),
      notes,
    };

    if (existingIdx !== -1) {
      approval.decisions[existingIdx] = decisionRecord;
    } else {
      approval.decisions.push(decisionRecord);
    }

    // Evaluate overall status
    if (approval.decisions.some((d) => d.decision === "rejected")) {
      approval.status = "rejected";
      approval.completedAt = new Date().toISOString();
    } else if (
      approval.requiredReviewers.every((r) =>
        approval.decisions.some((d) => d.reviewerId === r && d.decision === "approved"),
      )
    ) {
      approval.status = "approved";
      approval.completedAt = new Date().toISOString();
    } else {
      approval.status = "pending";
    }

    return approval;
  }

  /**
   * Check whether an approved document remains valid or has been modified.
   * If current content hash diverges from the approved hash, marks status as invalidated.
   */
  validateDocumentFidelity(approvalId: string, currentDocumentHash: string): {
    isValid: boolean;
    status: ApprovalState;
    notice?: string;
  } {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      return { isValid: false, status: "rejected", notice: "Approval record not found." };
    }

    if (approval.documentHash !== currentDocumentHash) {
      approval.status = "invalidated";
      approval.invalidatedAt = new Date().toISOString();
      return {
        isValid: false,
        status: "invalidated",
        notice: "Document has been edited since approval was requested. A new review is required.",
      };
    }

    return {
      isValid: approval.status === "approved",
      status: approval.status,
    };
  }

  getApproval(approvalId: string): ReviewApproval | undefined {
    return this.approvals.get(approvalId);
  }
}
