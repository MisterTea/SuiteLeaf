import { capacityDecision, phasesBlockedByCapacity } from "./sheet-capacity";
import { cellAddress } from "./sheet-audit";

/**
 * A cancellable pass over a saved workbook, plus a record of that pass.
 * The elapsed time is this pass only. It is not a spreadsheet recalculation
 * time and it is not a speedup claim.
 */

export type BenchmarkRecord = {
  dataset: string;
  hardware: string;
  runtime: string;
  version: string;
  elapsedMs: number;
  cancelled: boolean;
};

function note(value: string): string {
  const text = value.trim();
  return text || "not recorded";
}

/**
 * Run `steps` copies. A stop returns the workbook that was saved before the
 * pass, not a partly applied copy. `apply` must return a new workbook.
 */
export function runCancellable<T>(input: {
  saved: T;
  dataset: string;
  hardware: string;
  runtime: string;
  version: string;
  steps: number;
  shouldStop?: () => boolean;
  apply: (workbook: T, step: number) => T;
}): { workbook: T; benchmark: BenchmarkRecord } {
  const started = Date.now();
  const benchmark = (cancelled: boolean): BenchmarkRecord => ({
    dataset: note(input.dataset),
    hardware: note(input.hardware),
    runtime: note(input.runtime),
    version: note(input.version),
    elapsedMs: Date.now() - started,
    cancelled,
  });
  let current = input.saved;
  const steps = Number.isFinite(input.steps) && input.steps > 0 ? Math.floor(input.steps) : 0;
  for (let step = 0; step < steps; step += 1) {
    if (input.shouldStop?.()) return { workbook: input.saved, benchmark: benchmark(true) };
    current = input.apply(current, step);
  }
  return { workbook: current, benchmark: benchmark(false) };
}

/**
 * Keep the saved workbook when an import is cancelled.
 * The loader may still finish. Its result is discarded when stop is true
 * before that result is kept. This does not interrupt the Excel parser.
 */
export async function importKeepingSaved<T>(input: {
  saved: T;
  shouldStop?: () => boolean;
  load: () => Promise<T>;
}): Promise<{ workbook: T; cancelled: boolean }> {
  if (input.shouldStop?.()) return { workbook: input.saved, cancelled: true };
  const loaded = await input.load();
  if (input.shouldStop?.()) return { workbook: input.saved, cancelled: true };
  return { workbook: loaded, cancelled: false };
}

/**
 * A later completed pass on the same dataset and version regressed when it
 * took more than twice as long. A cancelled pass is not a regression.
 * A shorter pass is not reported as a speedup.
 */
export function benchmarkRegression(
  previous: BenchmarkRecord,
  next: BenchmarkRecord,
): { regressed: boolean; reason: string } {
  if (previous.cancelled || next.cancelled) {
    return { regressed: false, reason: "A cancelled pass is not a regression." };
  }
  if (
    previous.dataset !== next.dataset ||
    previous.version !== next.version ||
    previous.hardware !== next.hardware ||
    previous.runtime !== next.runtime
  ) {
    return { regressed: false, reason: "The passes are not the same measurement." };
  }
  if (previous.elapsedMs > 0 && next.elapsedMs > previous.elapsedMs * 2) {
    return {
      regressed: true,
      reason: `This pass took ${next.elapsedMs} ms after ${previous.elapsedMs} ms.`,
    };
  }
  return { regressed: false, reason: "This pass is not more than twice as long." };
}

export const WORKBOOK_PHASES = [
  "load",
  "parse",
  "recalculate",
  "render",
  "serialize",
  "save",
  "refresh",
] as const;

export type WorkbookPhase = (typeof WORKBOOK_PHASES)[number];

export type PhaseTiming = {
  name: WorkbookPhase;
  elapsedMs: number;
  skipped: boolean;
  failed: boolean;
};

/** The slowest phase that actually ran. A failed, skipped, or unnamed phase is left out. */
export function slowestPhaseNote(
  phases: readonly { name: string; elapsedMs: number; skipped?: boolean; failed?: boolean }[],
): string {
  const measured = phases.filter(
    (phase) =>
      (WORKBOOK_PHASES as readonly string[]).includes(phase.name) &&
      !phase.skipped &&
      !phase.failed &&
      Number.isInteger(phase.elapsedMs) &&
      phase.elapsedMs >= 0 &&
      phase.elapsedMs <= 86_400_000,
  );
  if (!measured.length) return "No phase time was measured.";
  const slow = measured.reduce((best, item) => (item.elapsedMs > best.elapsedMs ? item : best));
  return `The longest measured phase is ${slow.name} at ${slow.elapsedMs} ms. This is not a speedup claim.`;
}

/**
 * Time each workbook phase the caller supplies. A missing phase is skipped.
 * Stopping skips the phases that have not started. A thrown error is a failed
 * phase, later phases are skipped, and the error text is not stored. Return values are not stored.
 */
export async function timeWorkbookPhases(input: {
  phases: Partial<Record<WorkbookPhase, () => void | Promise<void>>>;
  shouldStop?: () => boolean;
  /** When set, a workbook past the limit skips recalculation, painting, and refresh. */
  cells?: number;
}): Promise<{ phases: PhaseTiming[]; stopped: boolean; notice: string }> {
  const decision = input.cells == null ? null : capacityDecision(input.cells);
  const blocked = new Set(decision && !decision.allowed ? phasesBlockedByCapacity(input.cells ?? 0) : []);
  const phases: PhaseTiming[] = [];
  let stopped = false;
  let failedEarlier = false;
  for (const name of WORKBOOK_PHASES) {
    if (blocked.has(name)) {
      phases.push({ name, elapsedMs: 0, skipped: true, failed: false });
      continue;
    }
    if (input.shouldStop?.()) {
      stopped = true;
      phases.push({ name, elapsedMs: 0, skipped: true, failed: false });
      continue;
    }
    const run = input.phases[name];
    if (failedEarlier || !run) {
      phases.push({ name, elapsedMs: 0, skipped: true, failed: false });
      continue;
    }
    const started = Date.now();
    try {
      await run();
      phases.push({ name, elapsedMs: Date.now() - started, skipped: false, failed: false });
    } catch {
      failedEarlier = true;
      phases.push({ name, elapsedMs: Date.now() - started, skipped: false, failed: true });
    }
  }
  return { phases, stopped, notice: decision?.notice ?? "" };
}

export type FormulaCost = { address: string; refs: number };

function columnNumber(letters: string): number {
  let value = 0;
  for (const char of letters) value = value * 26 + (char.charCodeAt(0) - 64);
  return value;
}

/** How many cells a formula names. Quoted text is not counted. */
export function formulaRefs(formula: string): number {
  const bare = formula.replace(/"(?:[^"]|"")*"/g, " ");
  let count = 0;
  let rest = bare;
  for (const match of bare.matchAll(/\$?([A-Z]{1,3}):\$?\1/gi)) {
    count += 10_000;
    rest = rest.replace(match[0], " ");
  }
  for (const match of bare.matchAll(/(?<![A-Z])\$?(\d+):\$?(\d+)(?!\d)/gi)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start < 1 || end < 1 || start > 1_048_576 || end > 1_048_576) continue;
    count += 10_000;
    rest = rest.replace(match[0], " ");
  }
  for (const match of bare.matchAll(/\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/gi)) {
    const width = Math.abs(columnNumber(match[3].toUpperCase()) - columnNumber(match[1].toUpperCase())) + 1;
    const height = Math.abs(Number(match[4]) - Number(match[2])) + 1;
    const cells = width * height;
    count += cells > 10_000 ? 10_000 : cells;
    rest = rest.replace(match[0], " ");
  }
  count += rest.match(/\$?[A-Z]+\$?\d+/gi)?.length ?? 0;
  return count;
}

/**
 * Formulas that name at least 64 cells, widest first. The formula text is not
 * returned. This does not calculate the formulas.
 */
export function expensiveFormulas(
  cells: Record<string, Record<string, { f?: string | null } | null>>,
  limit = 5,
): FormulaCost[] {
  const found: FormulaCost[] = [];
  for (const [rowKey, row] of Object.entries(cells)) {
    const rowIndex = Number(rowKey);
    if (!Number.isInteger(rowIndex) || !row) continue;
    for (const [columnKey, cell] of Object.entries(row)) {
      const columnIndex = Number(columnKey);
      const formula = cell?.f;
      if (!Number.isInteger(columnIndex) || typeof formula !== "string") continue;
      const refs = formulaRefs(formula);
      if (refs < 64) continue;
      const address = cellAddress(rowIndex, columnIndex);
      if (address) found.push({ address, refs });
    }
  }
  found.sort((left, right) => right.refs - left.refs || left.address.localeCompare(right.address));
  return found.slice(0, Math.max(0, limit));
}
