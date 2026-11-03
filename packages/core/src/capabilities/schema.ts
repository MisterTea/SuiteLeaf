import { z } from "zod";

/** How far a claim is allowed to reach. These tiers stay separate. */
export const PARITY_TIERS = [
  "everyday-editor",
  "professional-desktop",
  "enterprise-workspace",
] as const;

/** Absent means no product behavior. Verified means a recorded pass, not a menu. */
export const CAPABILITY_STATUSES = ["absent", "partial", "implemented", "verified"] as const;

export const PLATFORMS = ["web", "desktop", "node"] as const;
export const RUNTIME_MODES = ["serverless", "single-node", "cluster"] as const;

/** Release reports keep these apart from passes. */
export const EVIDENCE_RESULTS = [
  "pass",
  "fail",
  "skipped",
  "unavailable-reference",
  "inconclusive",
] as const;

export const EVIDENCE_KINDS = ["unit", "rust", "browser", "manual", "documentation"] as const;

export const evidenceSchema = z.object({
  kind: z.enum(EVIDENCE_KINDS),
  ref: z.string().min(1),
  result: z.enum(EVIDENCE_RESULTS),
  note: z.string().min(1),
});

export const competitorSchema = z.object({
  product: z.string().min(1),
  edition: z.string().min(1),
  platform: z.string().min(1),
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const capabilitySchema = z.object({
  id: z.string().regex(/^cap-[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  summary: z.string().min(1),
  parity: z.enum(PARITY_TIERS),
  status: z.enum(CAPABILITY_STATUSES),
  platforms: z.array(z.enum(PLATFORMS)).min(1),
  modes: z.array(z.enum(RUNTIME_MODES)).min(1),
  ui: z.array(z.string().min(1)),
  formats: z.array(z.string().min(1)),
  limits: z.array(z.string().min(1)),
  evidence: z.array(evidenceSchema),
  workPackages: z.array(z.string().regex(/^WP-\d{3}$/)).min(1),
});

export const workflowSchema = z.object({
  id: z.string().regex(/^flow-[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  summary: z.string().min(1),
  capabilityIds: z.array(z.string()).min(1),
  evidence: evidenceSchema,
});

export const releaseGateSchema = z.object({
  id: z.string().regex(/^gate-phase-[1-4]$/),
  phase: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  summary: z.string().min(1),
  workPackages: z.array(z.string().regex(/^WP-\d{3}$/)).min(1),
});

export const coverageInventorySchema = z.object({
  command: z.string().min(1),
  runner: z.literal("vitest"),
  provider: z.string().min(1),
  policy: z.string().min(1),
  /** Paths this inventory refuses to drop from measurement. */
  mustInclude: z.array(z.string().min(1)).min(1),
  /** Patterns that must not appear in a coverage exclude list. */
  mustNotExclude: z.array(z.string().min(1)).min(1),
});

export const baselineCaseSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  result: z.enum(EVIDENCE_RESULTS),
  detail: z.string().min(1),
});

export const catalogSchema = z.object({
  id: z.literal("suiteleaf-capabilities"),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  competitor: competitorSchema,
  capabilities: z.array(capabilitySchema).min(1),
  /** Features named in the README "What works" section. */
  advertisedIds: z.array(z.string()).min(1),
  workflows: z.array(workflowSchema).min(1),
  gates: z.array(releaseGateSchema).length(4),
  coverage: coverageInventorySchema,
  baseline: z.array(baselineCaseSchema),
});

export type Evidence = z.infer<typeof evidenceSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type ReleaseGate = z.infer<typeof releaseGateSchema>;
export type CapabilityCatalog = z.infer<typeof catalogSchema>;
export type EvidenceResult = (typeof EVIDENCE_RESULTS)[number];
