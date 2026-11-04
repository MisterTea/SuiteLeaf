/**
 * An approval is tied to one revision of a document.
 * A later edit keeps that approved copy and makes the current revision unapproved.
 * The document passed in is not changed. This is not an e-signature.
 */

import type { JsonNode } from "./index";

export type ApprovedRevision = { version: string; doc: JsonNode };

export type ApprovalRecord = {
  approved?: ApprovedRevision;
  current: JsonNode;
  version: string;
};

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function versionProblem(version: string): string | null {
  const trimmed = version.trim();
  if (!trimmed || /secret|password|token|api[_-]?key/i.test(trimmed)) return "Name a revision.";
  return null;
}

/** Store this document as the approved revision. */
export function approveDocument(doc: JsonNode, version: string): ApprovalRecord | { reason: string } {
  const problem = versionProblem(version);
  if (problem) return { reason: problem };
  if (doc.type !== "doc") return { reason: "Approval applies to a document." };
  const copy = structuredClone(doc);
  return { approved: { version: version.trim(), doc: structuredClone(copy) }, current: copy, version: version.trim() };
}

/** The approved copy, unchanged by later edits. */
export function readApproved(record: ApprovalRecord): JsonNode | { reason: string } {
  if (!record.approved) return { reason: "This document is not approved." };
  return structuredClone(record.approved.doc);
}

/** True only when the current revision is the approved one. */
export function isApproved(record: ApprovalRecord): boolean {
  return Boolean(record.approved && record.approved.version === record.version && same(record.approved.doc, record.current));
}

/**
 * A different document becomes the current revision and is not approved.
 * The approved copy stays. An unchanged document stays on the approved revision.
 */
export function editApproved(record: ApprovalRecord, next: JsonNode, version: string): ApprovalRecord | { reason: string } {
  const problem = versionProblem(version);
  if (problem) return { reason: problem };
  if (next.type !== "doc") return { reason: "Approval applies to a document." };
  if (same(record.current, next)) return structuredClone(record);
  return {
    approved: record.approved ? structuredClone(record.approved) : undefined,
    current: structuredClone(next),
    version: version.trim(),
  };
}
