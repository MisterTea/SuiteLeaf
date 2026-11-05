/**
 * What blocks a release, what is tolerated, and the summary a run prints.
 *
 * For a `supported` fixture, these block a release:
 * - a dimension with a `loss` or `incomplete` outcome that no tolerated entry covers;
 * - a SuiteLeaf refusal or timeout;
 * - a reference application that failed or timed out on the export.
 *
 * `unavailable-reference` and `not-measured` never count as passes. They are
 * listed so a run without a reference application cannot look complete.
 */
import type { FixtureSpec } from "./fixtures";
import { DIMENSIONS, type CompatResult, type Dimension } from "./types";

export interface Tolerated {
  fixture: string;
  dimension: Dimension;
  /** The work package that owns the repair. */
  owner: string;
  limitation: string;
  /** The user documentation that states this limit. */
  documentedIn: string;
}

/** Empty since WP-014 kept DOCX run fonts on 2026-11-04. Add an entry only with an owner and a documented limit. */
export const TOLERATED: Tolerated[] = [];

export function toleratedFor(result: CompatResult, dimension: Dimension, list: Tolerated[] = TOLERATED): Tolerated | undefined {
  return list.find((entry) => entry.fixture === result.fixture && entry.dimension === dimension);
}

export interface Blocking {
  fixture: string;
  reason: string;
}

export function blockingIssues(results: CompatResult[], specs: FixtureSpec[], list: Tolerated[] = TOLERATED): Blocking[] {
  const supported = new Set(specs.filter((spec) => spec.classification === "supported").map((spec) => spec.id));
  const out: Blocking[] = [];
  for (const result of results) {
    if (!supported.has(result.fixture)) continue;
    if (result.outcome !== "completed") {
      out.push({ fixture: result.fixture, reason: `SuiteLeaf ${result.outcome} (${result.code ?? "no code"})` });
      continue;
    }
    if (result.reference.status === "failed" || result.reference.status === "timed-out") {
      out.push({ fixture: result.fixture, reason: `${result.reference.application ?? "Reference"} ${result.reference.status}` });
    }
    for (const dimension of result.dimensions) {
      if (dimension.outcome !== "loss" && dimension.outcome !== "incomplete") continue;
      if (toleratedFor(result, dimension.dimension, list)) continue;
      const lost = dimension.probes.filter((p) => p.lostAt).map((p) => `${p.probe.kind} lost at ${p.lostAt}`);
      out.push({ fixture: result.fixture, reason: `${dimension.dimension} ${dimension.outcome}${lost.length ? `: ${lost.join(", ")}` : ""}` });
    }
  }
  return out;
}

/** Tolerated entries that no longer match a loss. Each should be removed once its repair lands. */
export function unusedTolerated(results: CompatResult[], list: Tolerated[] = TOLERATED): Tolerated[] {
  return list.filter(
    (entry) =>
      !results.some(
        (result) =>
          result.fixture === entry.fixture &&
          result.dimensions.some((d) => d.dimension === entry.dimension && (d.outcome === "loss" || d.outcome === "incomplete")),
      ),
  );
}

/** A result from another converter fingerprint or fixture spec is stale and is run again. */
export function isCurrent(result: Pick<CompatResult, "fingerprint" | "specHash">, fingerprint: string, specHash: string): boolean {
  return result.fingerprint === fingerprint && result.specHash === specHash;
}

const SHORT: Record<string, string> = {
  pass: "pass",
  loss: "LOSS",
  "not-measured": "–",
  "unavailable-reference": "no ref",
  incomplete: "INCOMPLETE",
};

export function summaryMarkdown(results: CompatResult[], specs: FixtureSpec[], list: Tolerated[] = TOLERATED): string {
  const lines = [
    `| Fixture | Run | Reference | ${DIMENSIONS.join(" | ")} |`,
    `| --- | --- | --- | ${DIMENSIONS.map(() => "---").join(" | ")} |`,
  ];
  for (const result of results) {
    const cells = DIMENSIONS.map((name) => {
      const found = result.dimensions.find((d) => d.dimension === name);
      const label = SHORT[found?.outcome ?? "not-measured"]!;
      return found?.outcome === "loss" && toleratedFor(result, name, list) ? `${label} (tolerated)` : label;
    });
    lines.push(`| ${result.fixture} | ${result.outcome} | ${result.reference.status} | ${cells.join(" | ")} |`);
  }
  const counts = new Map<string, number>();
  for (const result of results) for (const d of result.dimensions) counts.set(d.outcome, (counts.get(d.outcome) ?? 0) + 1);
  lines.push(
    "",
    `Dimensions: ${["pass", "loss", "incomplete", "unavailable-reference", "not-measured"].map((k) => `${counts.get(k) ?? 0} ${k}`).join(", ")}.`,
  );
  const blocking = blockingIssues(results, specs, list);
  lines.push("", blocking.length ? `Release-blocking: ${blocking.length}` : "Release-blocking: none");
  for (const item of blocking) lines.push(`- ${item.fixture}: ${item.reason}`);
  const tolerated = list.filter((entry) => results.some((r) => r.fixture === entry.fixture));
  if (tolerated.length) {
    lines.push("", "Tolerated:");
    for (const entry of tolerated) lines.push(`- ${entry.fixture} ${entry.dimension} (${entry.owner}): ${entry.limitation}`);
  }
  return lines.join("\n");
}
