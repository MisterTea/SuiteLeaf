import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { AppendOnlyAuditRecord } from "./types";

export class AppendOnlyAuditLogger {
  private chain: AppendOnlyAuditRecord[] = [];
  private genesisHash = "0".repeat(64);

  getChain(): AppendOnlyAuditRecord[] {
    return [...this.chain];
  }

  append(actorId: string, action: string, targetId: string, details: Record<string, unknown> = {}): AppendOnlyAuditRecord {
    const sequence = this.chain.length + 1;
    const previousHash = this.chain.length > 0 ? this.chain[this.chain.length - 1].hash : this.genesisHash;
    const timestamp = new Date().toISOString();

    const dataToHash = `${previousHash}|${sequence}|${timestamp}|${actorId}|${action}|${targetId}|${JSON.stringify(details)}`;
    const hash = bytesToHex(sha256(new TextEncoder().encode(dataToHash)));

    const record: AppendOnlyAuditRecord = {
      sequence,
      previousHash,
      hash,
      timestamp,
      actorId,
      action,
      targetId,
      details,
    };

    this.chain.push(record);
    return record;
  }

  /**
   * Verifies the entire cryptographic hash chain for integrity.
   */
  static verifyChain(chain: AppendOnlyAuditRecord[]): {
    valid: boolean;
    brokenSequence?: number;
    error?: string;
  } {
    let expectedPrev = "0".repeat(64);

    for (let i = 0; i < chain.length; i++) {
      const rec = chain[i];
      if (rec.sequence !== i + 1) {
        return {
          valid: false,
          brokenSequence: rec.sequence,
          error: `Sequence discontinuity at position ${i}: expected ${i + 1}, got ${rec.sequence}`,
        };
      }

      if (rec.previousHash !== expectedPrev) {
        return {
          valid: false,
          brokenSequence: rec.sequence,
          error: `Broken hash chain at sequence ${rec.sequence}: previousHash mismatch`,
        };
      }

      const dataToHash = `${rec.previousHash}|${rec.sequence}|${rec.timestamp}|${rec.actorId}|${rec.action}|${rec.targetId}|${JSON.stringify(rec.details)}`;
      const expectedHash = bytesToHex(sha256(new TextEncoder().encode(dataToHash)));

      if (expectedHash !== rec.hash) {
        return {
          valid: false,
          brokenSequence: rec.sequence,
          error: `Hash verification failure at sequence ${rec.sequence}: record contents were altered`,
        };
      }

      expectedPrev = rec.hash;
    }

    return { valid: true };
  }
}
