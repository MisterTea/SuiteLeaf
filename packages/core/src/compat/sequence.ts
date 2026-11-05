/**
 * The full compatibility sequence for one Office file:
 * source → import → representative edit → native save and reopen → Office
 * export → SuiteLeaf reimport → reference application. Each probe is checked
 * at every stage that can see it, and each dimension is scored on its own.
 */
import { exportDocx } from "../docx-export";
import { OfficeImportError, importOffice } from "../office";
import { parseFile, serializeFile } from "../native-file";
import { exportPptx } from "../pptx-export";
import { parsePowerPoint } from "../pptx";
import { exportXlsx } from "../xlsx-export";
import type { SheetFile, SlideFile, SuiteFile } from "../index";
import { EDIT_MARKER } from "./fixtures";
import {
  DIMENSIONS,
  STAGES,
  type CompatFormat,
  type CompatResult,
  type DimensionResult,
  type Probe,
  type ProbeResult,
  type ReferenceResult,
  type Stage,
  type View,
} from "./types";
import { modelView, norm, packageView } from "./views";

export interface CompatCase {
  id: string;
  format: CompatFormat;
  bytes: Uint8Array;
  sha256: string;
  specHash: string;
  probes: Probe[];
}

export interface CompatOptions {
  fingerprint: string;
  /** Reopens the exported file in another application. Without it, the reference stage is unavailable. */
  reference?: (bytes: Uint8Array, format: CompatFormat) => Promise<ReferenceResult>;
  /** Limit for the SuiteLeaf stages. */
  timeoutMs?: number;
  /** Changes the reopened file before export. Tests use it to plant a loss and check where it is reported. */
  beforeExport?: (file: SuiteFile) => SuiteFile;
}

/** The marker added by the representative edit. It is checked from the edit stage onward. */
export const EDIT_PROBE: Probe = { dimension: "content", kind: "text", value: EDIT_MARKER };

const includes = (haystack: string | undefined, needle: string) =>
  haystack === undefined ? undefined : norm(haystack).includes(norm(needle));
const anyIncludes = (list: string[] | undefined, needle: string) =>
  list === undefined ? undefined : list.some((item) => norm(item).includes(norm(needle)));

function sameFormula(left: string, right: string): boolean {
  const clean = (value: string) => value.replace(/^=/, "").replace(/\s+/g, "").toUpperCase();
  return clean(left) === clean(right);
}

/** `true` the stage shows the probe, `false` it does not, `undefined` the stage cannot measure it. */
export function probeSeen(probe: Probe, view: View | undefined): boolean | undefined {
  if (!view) return undefined;
  switch (probe.kind) {
    case "text":
      return includes(view.text, probe.value);
    case "notes":
      return includes(view.notes, probe.value);
    case "comment":
      return anyIncludes(view.comments, probe.value);
    case "revision":
      return anyIncludes(view.revisions, probe.value);
    case "internal-link":
      return view.internalLinks === undefined ? undefined : view.internalLinks.some((text) => norm(text) === norm(probe.value));
    case "citation":
      return view.citations === undefined ? undefined : view.citations.includes(probe.value);
    case "source":
      return view.sources === undefined ? undefined : view.sources.includes(probe.value);
    case "cell":
      return anyIncludes(view.cells, probe.value);
    case "header":
      return anyIncludes(view.headers, probe.value);
    case "footnote":
      return anyIncludes(view.footnotes, probe.value);
    case "numbered":
      return view.numbered === undefined ? undefined : view.numbered.split("\n").some((line) => norm(line) === norm(probe.value));
    case "sections":
      return view.sections === undefined ? undefined : view.sections === probe.count;
    case "font":
      return view.fonts === undefined ? undefined : view.fonts.some((font) => font.toLowerCase() === probe.value.toLowerCase());
    case "table":
      return view.tables === undefined ? undefined : view.tables >= probe.count;
    case "image":
      return view.images === undefined ? undefined : view.images.includes(probe.sha256);
    case "pages":
      return view.pages === undefined ? undefined : view.pages === probe.count;
    case "formula": {
      if (view.formulas === undefined) return undefined;
      const cell = view.formulas[`${probe.sheet}!${probe.cell}`];
      if (!cell) return false;
      if (cell.formula !== undefined && !sameFormula(cell.formula, probe.formula)) return false;
      if (cell.value === undefined || cell.value === "") return cell.formula !== undefined ? true : undefined;
      return Math.abs(Number(cell.value) - probe.value) < 1e-9;
    }
  }
}

/** The stages a probe is checked at, in order. The edit marker does not exist before the edit. */
function stagesFor(probe: Probe): Stage[] {
  return probe === EDIT_PROBE ? STAGES.filter((stage) => stage !== "source" && stage !== "import") : [...STAGES];
}

export function scoreProbe(probe: Probe, views: Partial<Record<Stage, View>>): ProbeResult & { incomplete: boolean } {
  const unmeasured: Stage[] = [];
  let lostAt: Stage | undefined;
  let incomplete = false;
  for (const stage of stagesFor(probe)) {
    const seen = probeSeen(probe, views[stage]);
    if (seen === undefined) {
      unmeasured.push(stage);
      continue;
    }
    if (seen) continue;
    if (stage === "source") {
      incomplete = true;
      break;
    }
    lostAt = stage;
    break;
  }
  return { probe, lostAt, unmeasured, incomplete };
}

export function scoreDimensions(probes: Probe[], views: Partial<Record<Stage, View>>, reference: ReferenceResult["status"]): DimensionResult[] {
  return DIMENSIONS.map((dimension) => {
    const scored = probes.filter((probe) => probe.dimension === dimension).map((probe) => scoreProbe(probe, views));
    // A probe is covered when a stage after the source measured it, so a loss could have shown.
    const covered = (p: ProbeResult) => stagesFor(p.probe).some((stage) => stage !== "source" && !p.unmeasured.includes(stage));
    let outcome: DimensionResult["outcome"];
    if (!scored.length) outcome = "not-measured";
    else if (scored.some((p) => p.incomplete)) outcome = "incomplete";
    else if (scored.some((p) => p.lostAt)) outcome = "loss";
    else if (scored.every(covered)) outcome = "pass";
    else outcome = reference === "opened" ? "not-measured" : "unavailable-reference";
    return { dimension, outcome, probes: scored.map(({ probe, lostAt, unmeasured }) => ({ probe, lostAt, unmeasured })) };
  });
}

async function importAny(bytes: Uint8Array, format: CompatFormat, name: string): Promise<SuiteFile> {
  if (format === "pptx") return parsePowerPoint(bytes, name);
  return (await importOffice(bytes, format, `${name}.${format}`)).file;
}

async function exportAny(file: SuiteFile): Promise<Uint8Array> {
  if (file.kind === "doc") return exportDocx(file);
  if (file.kind === "sheet") return exportXlsx(file as SheetFile);
  return exportPptx(file as SlideFile);
}

/** The representative edit: one new paragraph, cell, or text box holding the marker. The file passed in is not changed. */
export function applyEdit(file: SuiteFile): SuiteFile {
  const next = structuredClone(file);
  if (next.kind === "doc") {
    next.content.content = [...(next.content.content ?? []), { type: "paragraph", content: [{ type: "text", text: EDIT_MARKER }] }];
    return next;
  }
  if (next.kind === "sheet") {
    const book = (next as SheetFile).content.workbook as { sheetOrder: string[]; sheets: Record<string, { cellData?: Record<string, Record<string, unknown>> }> };
    const sheet = book.sheets[book.sheetOrder[0]!]!;
    const cells = (sheet.cellData ??= {});
    const row = Math.max(-1, ...Object.keys(cells).map(Number)) + 2;
    cells[String(row)] = { "0": { v: EDIT_MARKER, t: 1 } };
    return next;
  }
  const deck = (next as SlideFile).content;
  const slide = deck.slides[deck.slideOrder[deck.slideOrder.length - 1]!]!;
  slide.elements.push({
    id: "suiteleaf-edit-marker",
    type: "text",
    x: 48,
    y: 400,
    width: 600,
    height: 60,
    content: EDIT_MARKER,
    fontSize: 18,
    color: "#000000",
  } as (typeof slide.elements)[number]);
  return next;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CompatTimeout()), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

class CompatTimeout extends Error {}

/** Run one file through every stage. A refusal or a timeout is reported as such, never as a pass. */
export async function runCompatCase(item: CompatCase, options: CompatOptions): Promise<CompatResult> {
  const probes = [...item.probes, EDIT_PROBE];
  const base = { fixture: item.id, format: item.format, sha256: item.sha256, specHash: item.specHash, fingerprint: options.fingerprint };
  const views: Partial<Record<Stage, View>> = {};
  let exported: Uint8Array;
  try {
    exported = await withTimeout(
      (async () => {
        views.source = await packageView(item.bytes, item.format);
        const imported = await importAny(item.bytes, item.format, item.id);
        views.import = modelView(imported);
        const edited = applyEdit(imported);
        views.edit = modelView(edited);
        const reopened = parseFile(serializeFile(edited), edited.kind);
        views.native = modelView(reopened);
        const bytes = await exportAny(options.beforeExport ? options.beforeExport(reopened) : reopened);
        views.export = await packageView(bytes, item.format);
        views.reimport = modelView(await importAny(bytes, item.format, item.id));
        return bytes;
      })(),
      options.timeoutMs ?? 60_000,
    );
  } catch (error) {
    const timedOut = error instanceof CompatTimeout;
    return {
      ...base,
      outcome: timedOut ? "timed-out" : "rejected",
      code: timedOut ? "timeout" : error instanceof OfficeImportError ? error.code : "conversion-error",
      reference: { status: "unavailable" },
      dimensions: scoreDimensions(probes, views, "unavailable"),
    };
  }
  const reference: ReferenceResult = options.reference
    ? await options.reference(exported, item.format)
    : { status: "unavailable", detail: "No reference application was configured." };
  if (reference.status === "opened") views.reference = reference.view ?? {};
  const summary: CompatResult["reference"] = { status: reference.status, application: reference.application, detail: reference.detail };
  return { ...base, outcome: "completed", reference: summary, dimensions: scoreDimensions(probes, views, reference.status) };
}
