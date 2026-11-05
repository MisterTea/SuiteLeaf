/**
 * Team workflows: notifications, inbox, actionable tasks, outbox delivery,
 * and permission-aware content redaction.
 */

export type NotificationEventType =
  | "mention"
  | "assignment"
  | "review_request"
  | "share_change"
  | "form_submission"
  | "approval_action";

export interface NotificationEvent {
  id: string; // Idempotency key
  type: NotificationEventType;
  actorId: string;
  actorName: string;
  targetUserId: string;
  fileId: string;
  fileName: string;
  versionId?: string;
  anchorId?: string; // slide id, comment id, cell coord
  snippet: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ActionableTask {
  taskId: string;
  eventId: string;
  title: string;
  assignedToUserId: string;
  assignedByUserId: string;
  fileId: string;
  fileName: string;
  status: "open" | "resolved" | "reopened";
  dueDate?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface UserNotificationItem {
  id: string;
  event: NotificationEvent;
  read: boolean;
  task?: ActionableTask;
  snippetRestricted?: boolean;
}

export interface NotificationPermissionChecker {
  canRead(userId: string, fileId: string): boolean | Promise<boolean>;
}

export class TransactionalOutbox {
  private queue = new Map<string, NotificationEvent>(); // id -> event
  private delivered = new Set<string>(); // set of delivered event IDs

  /**
   * Queue event with idempotency deduplication.
   * Duplicate attempts with the same ID are ignored without error.
   */
  enqueue(event: NotificationEvent): boolean {
    if (this.delivered.has(event.id) || this.queue.has(event.id)) {
      return false; // deduplicated
    }
    this.queue.set(event.id, { ...event });
    return true;
  }

  /**
   * Deliver pending events through a delivery channel (e.g. inbox, email, chat).
   * Retries on failure without duplicating successful items.
   */
  async flush(
    deliver: (event: NotificationEvent) => Promise<boolean>,
  ): Promise<{ delivered: number; failed: number }> {
    let successCount = 0;
    let failCount = 0;

    for (const [id, event] of Array.from(this.queue.entries())) {
      try {
        const ok = await deliver(event);
        if (ok) {
          this.queue.delete(id);
          this.delivered.add(id);
          successCount += 1;
        } else {
          failCount += 1;
        }
      } catch {
        failCount += 1;
      }
    }

    return { delivered: successCount, failed: failCount };
  }

  getPendingCount(): number {
    return this.queue.size;
  }
}

export class TeamWorkflowInbox {
  private notifications = new Map<string, UserNotificationItem[]>(); // userId -> items
  private tasks = new Map<string, ActionableTask>(); // taskId -> ActionableTask
  private seenEventIds = new Set<string>();

  /**
   * Ingest a notification event into the user's inbox, creating a task if assignment.
   */
  receiveEvent(event: NotificationEvent): { notification: UserNotificationItem; taskCreated: boolean } {
    if (this.seenEventIds.has(event.id)) {
      const userItems = this.notifications.get(event.targetUserId) ?? [];
      const existing = userItems.find((n) => n.event.id === event.id)!;
      return { notification: existing, taskCreated: false };
    }

    this.seenEventIds.add(event.id);
    let task: ActionableTask | undefined;
    let taskCreated = false;

    if (event.type === "assignment") {
      const taskId = `task-${event.id}`;
      task = {
        taskId,
        eventId: event.id,
        title: event.snippet || `Task in ${event.fileName}`,
        assignedToUserId: event.targetUserId,
        assignedByUserId: event.actorId,
        fileId: event.fileId,
        fileName: event.fileName,
        status: "open",
        dueDate: event.metadata?.dueDate as string | undefined,
        createdAt: event.createdAt,
      };
      this.tasks.set(taskId, task);
      taskCreated = true;
    }

    const item: UserNotificationItem = {
      id: `notif-${event.id}`,
      event: { ...event },
      read: false,
      task,
    };

    const userList = this.notifications.get(event.targetUserId) ?? [];
    userList.unshift(item);
    this.notifications.set(event.targetUserId, userList);

    return { notification: item, taskCreated };
  }

  /**
   * Retrieve notifications for a user, filtering by permissions and redacting restricted file content.
   */
  async listInbox(
    userId: string,
    permissions: NotificationPermissionChecker,
    filter: { unreadOnly?: boolean; taskStatus?: "all" | "open" | "resolved" } = {},
  ): Promise<UserNotificationItem[]> {
    const items = this.notifications.get(userId) ?? [];
    const results: UserNotificationItem[] = [];

    for (const item of items) {
      if (filter.unreadOnly && item.read) continue;
      if (filter.taskStatus && filter.taskStatus !== "all" && item.task) {
        if (filter.taskStatus === "open" && item.task.status === "resolved") continue;
        if (filter.taskStatus === "resolved" && item.task.status !== "resolved") continue;
      }

      // Check current file permission
      const canAccess = await permissions.canRead(userId, item.event.fileId);
      if (!canAccess) {
        // Redact file snippet to prevent exfiltration through stale notifications
        results.push({
          ...item,
          snippetRestricted: true,
          event: {
            ...item.event,
            snippet: "[Restricted Content - You no longer have access to this document]",
          },
        });
      } else {
        results.push(item);
      }
    }

    return results;
  }

  markRead(userId: string, notificationId: string): boolean {
    const list = this.notifications.get(userId) ?? [];
    const item = list.find((n) => n.id === notificationId);
    if (item) {
      item.read = true;
      return true;
    }
    return false;
  }

  resolveTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (task && task.status !== "resolved") {
      task.status = "resolved";
      task.resolvedAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  reopenTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (task && task.status === "resolved") {
      task.status = "reopened";
      task.resolvedAt = undefined;
      return true;
    }
    return false;
  }

  getTask(taskId: string): ActionableTask | undefined {
    return this.tasks.get(taskId);
  }
}
