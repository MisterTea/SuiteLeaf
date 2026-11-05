import type { DataClassificationLabel, LegalHold, RetentionSchedule } from "./types";

export interface GovernanceItem {
  id: string;
  name: string;
  custodianId: string;
  label: DataClassificationLabel;
  createdAt: string;
  deletedAt?: string;
}

export class RetentionEngine {
  private legalHolds: Map<string, LegalHold> = new Map();
  private retentionSchedules: Map<string, RetentionSchedule> = new Map();

  addLegalHold(hold: LegalHold) {
    this.legalHolds.set(hold.id, hold);
  }

  releaseLegalHold(holdId: string) {
    const hold = this.legalHolds.get(holdId);
    if (!hold) throw new Error(`Legal hold ${holdId} not found.`);
    hold.status = "released";
    hold.releasedAt = new Date().toISOString();
  }

  addRetentionSchedule(schedule: RetentionSchedule) {
    this.retentionSchedules.set(schedule.id, schedule);
  }

  /**
   * Check if an item or custodian is under any active legal hold.
   */
  getActiveHoldsForItem(fileId: string, custodianId: string): LegalHold[] {
    const active: LegalHold[] = [];
    for (const hold of this.legalHolds.values()) {
      if (hold.status !== "active") continue;
      if (hold.fileIds.includes(fileId) || hold.custodianIds.includes(custodianId)) {
        active.push(hold);
      }
    }
    return active;
  }

  /**
   * Verify whether a file can be deleted or purged.
   * Active legal holds fail closed and block deletion even if the account is removed.
   */
  canDeleteItem(fileId: string, custodianId: string): { allowed: boolean; reason?: string } {
    const holds = this.getActiveHoldsForItem(fileId, custodianId);
    if (holds.length > 0) {
      const holdNames = holds.map((h) => `'${h.name}'`).join(", ");
      return {
        allowed: false,
        reason: `Item cannot be deleted: active legal hold(s) apply (${holdNames}).`,
      };
    }
    return { allowed: true };
  }

  /**
   * Generates a dry-run impact report for a retention schedule.
   */
  generateRetentionDryRun(
    items: GovernanceItem[],
    scheduleId: string,
    now = Date.now(),
  ): {
    schedule: RetentionSchedule;
    totalEvaluated: number;
    eligibleForDisposition: GovernanceItem[];
    blockedByLegalHold: GovernanceItem[];
  } {
    const schedule = this.retentionSchedules.get(scheduleId);
    if (!schedule) throw new Error(`Retention schedule ${scheduleId} not found.`);

    const eligibleForDisposition: GovernanceItem[] = [];
    const blockedByLegalHold: GovernanceItem[] = [];

    const retentionMs = schedule.retentionDays * 24 * 3600 * 1000;

    for (const item of items) {
      if (!schedule.appliesToLabels.includes(item.label)) continue;

      const createdTime = new Date(item.createdAt).getTime();
      const ageMs = now - createdTime;

      if (ageMs >= retentionMs) {
        const canDelete = this.canDeleteItem(item.id, item.custodianId);
        if (canDelete.allowed) {
          eligibleForDisposition.push(item);
        } else {
          blockedByLegalHold.push(item);
        }
      }
    }

    return {
      schedule,
      totalEvaluated: items.length,
      eligibleForDisposition,
      blockedByLegalHold,
    };
  }
}
