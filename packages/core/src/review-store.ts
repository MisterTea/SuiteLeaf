/**
 * Review decisions stored on the document.
 * A saved copy can be read back. Block text is not stored.
 * A note that looks like a credential is replaced.
 */

import type { JsonNode } from "./index";
import type { ReviewDecision } from "./review-combine";

export type StoredChoice = { block: number; side: "left" | "right" };
export type StoredReview = {
  decisions: ReviewDecision[];
  choices: StoredChoice[];
  approvedVersion?: string;
};

function safeNote(block: number, note: string): string {
  const trimmed = note.trim();
  if (!trimmed || trimmed.length > 160 || /secret|password|token|api[_-]?key/i.test(trimmed)) {
    return `Block ${block} needs a choice.`;
  }
  return trimmed;
}

function safeVersion(version: unknown): string | undefined {
  if (typeof version !== "string") return undefined;
  const trimmed = version.trim();
  if (!trimmed || /secret|password|token|api[_-]?key/i.test(trimmed)) return undefined;
  return trimmed;
}

function decisionOf(value: unknown): ReviewDecision | null {
  if (!value || typeof value !== "object") return null;
  const block = (value as { block?: unknown }).block;
  const note = (value as { note?: unknown }).note;
  if (typeof block !== "number" || !Number.isInteger(block) || block < 1) return null;
  if (typeof note !== "string") return null;
  return { block, note: safeNote(block, note) };
}

function choiceOf(value: unknown): StoredChoice | null {
  if (!value || typeof value !== "object") return null;
  const block = (value as { block?: unknown }).block;
  const side = (value as { side?: unknown }).side;
  if (typeof block !== "number" || !Number.isInteger(block) || block < 1) return null;
  if (side !== "left" && side !== "right") return null;
  return { block, side };
}

/** Decisions and choices that are safe to store. A credential-like note is replaced. */
export function reviewPayload(review: StoredReview): StoredReview {
  const decisions = review.decisions.map((item) => decisionOf(item)).filter((item): item is ReviewDecision => item != null);
  const choices = review.choices.map((item) => choiceOf(item)).filter((item): item is StoredChoice => item != null);
  const approvedVersion = safeVersion(review.approvedVersion);
  return approvedVersion ? { decisions, choices, approvedVersion } : { decisions, choices };
}

/** A copy of the document with the review attached. The document passed in is not changed. */
export function writeReview(doc: JsonNode, review: StoredReview): JsonNode | { reason: string } {
  if (doc.type !== "doc") return { reason: "Review is stored on a document." };
  const stored = reviewPayload(review);
  const copy = structuredClone(doc);
  copy.attrs = { ...copy.attrs, review: stored };
  return copy;
}

/** The review on a saved document. A broken record is not copied into the reason. */
export function readReview(doc: JsonNode): StoredReview | { reason: string } {
  const raw = doc.attrs?.review;
  if (!raw || typeof raw !== "object") return { reason: "This document has no stored review." };
  const record = raw as { decisions?: unknown; choices?: unknown; approvedVersion?: unknown };
  if (!Array.isArray(record.decisions) || !Array.isArray(record.choices)) {
    return { reason: "The stored review cannot be read." };
  }
  const decisions = record.decisions.map((item) => decisionOf(item)).filter((item): item is ReviewDecision => item != null);
  const choices = record.choices.map((item) => choiceOf(item)).filter((item): item is StoredChoice => item != null);
  const approvedVersion = safeVersion(record.approvedVersion);
  return approvedVersion ? { decisions, choices, approvedVersion } : { decisions, choices };
}
