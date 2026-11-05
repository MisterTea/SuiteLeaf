import { describe, expect, it } from "vitest";
import {
  TeamWorkflowInbox,
  TransactionalOutbox,
  ApprovalWorkflowManager,
  type NotificationEvent,
  type NotificationPermissionChecker,
} from "../packages/core/src";

describe("WP-027 Notifications, assigned work, and approvals", () => {
  it("creates an actionable assignment task, tracks resolve/reopen, and prevents duplicate task creation", () => {
    const inbox = new TeamWorkflowInbox();

    const assignmentEvent: NotificationEvent = {
      id: "evt-assign-101",
      type: "assignment",
      actorId: "manager-rosa",
      actorName: "Rosa Parks",
      targetUserId: "engineer-sam",
      fileId: "file-specs-doc",
      fileName: "Architecture Spec v2.sldoc",
      snippet: "Please review the security section and confirm token rotation schedule.",
      createdAt: "2026-11-04T10:00:00.000Z",
      metadata: { dueDate: "2026-11-06T18:00:00.000Z" },
    };

    // First delivery creates task
    const res1 = inbox.receiveEvent(assignmentEvent);
    expect(res1.taskCreated).toBe(true);
    expect(res1.notification.task).toBeDefined();
    expect(res1.notification.task?.status).toBe("open");
    expect(res1.notification.task?.dueDate).toBe("2026-11-06T18:00:00.000Z");

    const taskId = res1.notification.task!.taskId;

    // Retry delivery with identical event ID is deduplicated and does NOT create duplicate task
    const res2 = inbox.receiveEvent(assignmentEvent);
    expect(res2.taskCreated).toBe(false);

    // Resolve task
    expect(inbox.resolveTask(taskId)).toBe(true);
    expect(inbox.getTask(taskId)?.status).toBe("resolved");
    expect(inbox.getTask(taskId)?.resolvedAt).toBeDefined();

    // Reopen task
    expect(inbox.reopenTask(taskId)).toBe(true);
    expect(inbox.getTask(taskId)?.status).toBe("reopened");
  });

  it("transactional outbox deduplicates event submissions and handles delivery retries without duplicate notifications", async () => {
    const outbox = new TransactionalOutbox();
    const inbox = new TeamWorkflowInbox();

    const event: NotificationEvent = {
      id: "evt-mention-505",
      type: "mention",
      actorId: "author-alice",
      actorName: "Alice",
      targetUserId: "user-bob",
      fileId: "file-doc-1",
      fileName: "Meeting Notes.sldoc",
      snippet: "@bob check the budget numbers on slide 3",
      createdAt: "2026-11-04T11:00:00.000Z",
    };

    // Enqueue event
    expect(outbox.enqueue(event)).toBe(true);
    // Duplicate enqueue is rejected
    expect(outbox.enqueue(event)).toBe(false);
    expect(outbox.getPendingCount()).toBe(1);

    // Simulate transient failure during first flush
    let attempt = 0;
    const deliver = async (evt: NotificationEvent) => {
      attempt += 1;
      if (attempt === 1) return false; // simulated network blip
      inbox.receiveEvent(evt);
      return true;
    };

    const firstFlush = await outbox.flush(deliver);
    expect(firstFlush.failed).toBe(1);
    expect(firstFlush.delivered).toBe(0);
    expect(outbox.getPendingCount()).toBe(1);

    // Retry flush succeeds
    const secondFlush = await outbox.flush(deliver);
    expect(secondFlush.delivered).toBe(1);
    expect(secondFlush.failed).toBe(0);
    expect(outbox.getPendingCount()).toBe(0);

    // Verify inbox received exactly 1 notification
    const allowPermissions: NotificationPermissionChecker = { canRead: () => true };
    const items = await inbox.listInbox("user-bob", allowPermissions);
    expect(items).toHaveLength(1);
    expect(items[0].event.snippet).toBe("@bob check the budget numbers on slide 3");
  });

  it("binds approval to an immutable document hash, supports multi-reviewers, and invalidates upon later edits", () => {
    const mgr = new ApprovalWorkflowManager();

    const docHashRev1 = "a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890";
    const approval = mgr.requestApproval({
      approvalId: "appr-release-1.0",
      fileId: "file-policy-doc",
      fileName: "Company Security Policy.sldoc",
      versionId: "v1.0",
      documentHash: docHashRev1,
      requiredReviewers: ["security-officer", "compliance-lead"],
    });

    expect(approval.status).toBe("pending");

    // Reviewer 1 approves
    mgr.recordDecision("appr-release-1.0", "security-officer", "approved", "Security review passed");
    expect(mgr.getApproval("appr-release-1.0")?.status).toBe("pending");

    // Reviewer 2 approves
    mgr.recordDecision("appr-release-1.0", "compliance-lead", "approved", "Compliance verified");
    expect(mgr.getApproval("appr-release-1.0")?.status).toBe("approved");

    // Validation against unchanged document confirms approval is active
    const check1 = mgr.validateDocumentFidelity("appr-release-1.0", docHashRev1);
    expect(check1.isValid).toBe(true);
    expect(check1.status).toBe("approved");

    // Later edit alters document content (hash changes)
    const docHashRev2 = "changed9999999999999999999999999999999999999999999999999999999999";
    const check2 = mgr.validateDocumentFidelity("appr-release-1.0", docHashRev2);
    expect(check2.isValid).toBe(false);
    expect(check2.status).toBe("invalidated");
    expect(check2.notice).toContain("Document has been edited since approval was requested");
  });

  it("redacts inaccessible document snippets when a user's permissions to the file are revoked", async () => {
    const inbox = new TeamWorkflowInbox();

    inbox.receiveEvent({
      id: "evt-confidential-leak-test",
      type: "mention",
      actorId: "exec",
      actorName: "Executive",
      targetUserId: "contractor-eve",
      fileId: "file-merger-deal",
      fileName: "Project Alpha Acquisition.sldoc",
      snippet: "Target acquisition price agreed at $45M in secret session.",
      createdAt: "2026-11-04T09:00:00.000Z",
    });

    // When user has access: snippet is readable
    const hasAccessPermissions: NotificationPermissionChecker = {
      canRead: (_userId, fileId) => fileId === "file-merger-deal",
    };
    const allowedInbox = await inbox.listInbox("contractor-eve", hasAccessPermissions);
    expect(allowedInbox[0].snippetRestricted).toBeFalsy();
    expect(allowedInbox[0].event.snippet).toContain("Target acquisition price agreed at $45M");

    // When access is revoked on the file: snippet is redacted!
    const revokedPermissions: NotificationPermissionChecker = {
      canRead: () => false,
    };
    const revokedInbox = await inbox.listInbox("contractor-eve", revokedPermissions);
    expect(revokedInbox[0].snippetRestricted).toBe(true);
    expect(revokedInbox[0].event.snippet).toBe(
      "[Restricted Content - You no longer have access to this document]",
    );
    expect(revokedInbox[0].event.snippet).not.toContain("$45M");
  });
});
