/** Shared types for the Office compatibility run (WP-012). */

export type CompatFormat = "docx" | "xlsx" | "pptx";

/** Each dimension is reported on its own. One loss never hides inside an overall pass. */
export const DIMENSIONS = ["content", "formulas", "review", "objects", "fonts", "layout", "media"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** The order a file goes through. `reference` is a separate application reopening the export. */
export const STAGES = ["source", "import", "edit", "native", "export", "reimport", "reference"] as const;
export type Stage = (typeof STAGES)[number];

export type Probe =
  | { dimension: Dimension; kind: "text"; value: string }
  | { dimension: Dimension; kind: "notes"; value: string }
  | { dimension: Dimension; kind: "comment"; value: string }
  | { dimension: Dimension; kind: "revision"; value: string }
  | { dimension: Dimension; kind: "font"; value: string }
  | { dimension: Dimension; kind: "table"; count: number }
  | { dimension: Dimension; kind: "image"; sha256: string }
  | { dimension: Dimension; kind: "pages"; count: number }
  | { dimension: Dimension; kind: "formula"; sheet: string; cell: string; formula: string; value: number };

/** What one stage shows. A field left undefined was not measured at that stage. */
export interface View {
  text?: string;
  notes?: string;
  comments?: string[];
  revisions?: string[];
  fonts?: string[];
  tables?: number;
  images?: string[];
  pages?: number;
  formulas?: Record<string, { formula?: string; value?: unknown }>;
}

/**
 * - `pass`: every probe for the dimension survived every measured stage.
 * - `loss`: a probe that the source had was missing at a later stage.
 * - `not-measured`: no probe for this dimension, or no stage could see it.
 * - `unavailable-reference`: only the reference application could see it, and none ran.
 * - `incomplete`: the source itself did not show the probe, so the fixture proves nothing.
 */
export type DimensionOutcome = "pass" | "loss" | "not-measured" | "unavailable-reference" | "incomplete";

export interface ProbeResult {
  probe: Probe;
  /** The first stage that did not show the probe, if any. */
  lostAt?: Stage;
  /** Stages that could not measure this probe. */
  unmeasured: Stage[];
}

export interface DimensionResult {
  dimension: Dimension;
  outcome: DimensionOutcome;
  probes: ProbeResult[];
}

/** A reference application's view of the exported file. */
export interface ReferenceResult {
  status: "opened" | "failed" | "timed-out" | "unavailable";
  application?: string;
  view?: View;
  detail?: string;
}

export interface CompatResult {
  fixture: string;
  format: CompatFormat;
  sha256: string;
  specHash: string;
  /** Converter fingerprint. A result from another fingerprint is stale. */
  fingerprint: string;
  /** `rejected`: SuiteLeaf refused the source. `timed-out`: a stage ran past its limit. */
  outcome: "completed" | "rejected" | "timed-out";
  code?: string;
  reference: Omit<ReferenceResult, "view">;
  dimensions: DimensionResult[];
}
