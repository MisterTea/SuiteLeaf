/** Comparable content. Text is kept only long enough to match runs, then dropped from the report. */
export interface OfficeDigest {
  texts: string[];
  bold: string[];
  italic: string[];
  underline: string[];
  formulas: string[];
  notes: string[];
  images: number;
  tables: number;
  /** Features the SuiteLeaf schema does not store. */
  limits: string[];
  /** Features this side still has, so a source limit is not a loss. */
  kept: string[];
  /** Features a third-party reader or generator does not provide. */
  thirdParty: string[];
}

export type DiffOwner = "suiteleaf" | "third-party" | "model-limit";

export interface RoundTripDifference {
  feature: string;
  owner: DiffOwner;
  description: string;
}

export function emptyDigest(): OfficeDigest {
  return {
    texts: [],
    bold: [],
    italic: [],
    underline: [],
    formulas: [],
    notes: [],
    images: 0,
    tables: 0,
    limits: [],
    kept: [],
    thirdParty: [],
  };
}

export function norm(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function bag(values: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const value of values) {
    const text = norm(value);
    if (text.length < 2) continue;
    out.set(text, (out.get(text) ?? 0) + 1);
  }
  return out;
}

/** Spaces from tabs and line breaks are not a different sentence. */
function foldSpace(value: string): string {
  return norm(value).replace(/ /g, "");
}

/** A heading bullet or number written in front of the heading words. */
function listLabel(prefix: string): boolean {
  if (prefix.length < 2 || prefix.length > 32 || !prefix.endsWith(" ")) return false;
  const body = prefix.slice(0, -1);
  if ([...body].length === 1 && body.charCodeAt(0) > 127) return true;
  if (/^(\d+|[A-Za-z])([.)](\d+|[A-Za-z]))*[.)]?$/.test(body)) return true;
  return /^\S+ (\d+|[A-Za-z])([.)](\d+|[A-Za-z]))*[.)]?$/.test(body);
}

function missingCount(need: string[], have: string[], substringAt = 4): number {
  const bagHave = bag(have);
  const leftovers: string[] = [];
  for (const [text, times] of bag(need)) {
    const got = bagHave.get(text) ?? 0;
    for (let i = got; i < times; i++) leftovers.push(text);
  }
  const hay = have.map(norm).filter((text) => text.length >= 2);
  const foldedHay = hay.map(foldSpace);
  let count = 0;
  for (const text of leftovers) {
    const folded = foldSpace(text);
    if (text.length >= substringAt && hay.some((item) => item.includes(text) || text.includes(item)))
      continue;
    if (foldedHay.some((item) => item === folded && folded.length >= 1)) continue;
    if (
      folded.length >= substringAt &&
      foldedHay.some((item) => item.includes(folded) || folded.includes(item))
    )
      continue;
    if (
      hay.some(
        (item) =>
          item.length > text.length &&
          item.endsWith(text) &&
          listLabel(item.slice(0, item.length - text.length)),
      )
    )
      continue;
    count += 1;
  }
  return count;
}

function thirdPartyDescription(feature: string): string {
  if (feature === "doc.legacy-formatting")
    return "The legacy DOC extractor returns text and paragraph breaks only.";
  if (feature === "sheet.binary-formatting")
    return "SheetJS does not preserve every binary Excel formatting detail.";
  if (feature === "slide.legacy-formatting")
    return "The legacy PPT parser returns text only.";
  if (feature === "slide.position")
    return "officeparser does not provide shape positions.";
  if (feature === "slide.comment" || feature === "slide.transition" || feature === "slide.animation")
    return "PptxGenJS does not write this presentation feature.";
  if (feature === "reader.text")
    return "The third-party reader omitted source text.";
  if (feature === "reader.image")
    return "The third-party reader omitted a picture.";
  if (feature === "reader.chart")
    return "The third-party reader returned an embedded chart instead of a picture.";
  if (feature === "reader.warning")
    return "The third-party reader reported a conversion warning.";
  return "The third-party reader or generator does not provide this feature.";
}

function push(
  diffs: RoundTripDifference[],
  feature: string,
  owner: DiffOwner,
  description: string,
) {
  if (diffs.some((diff) => diff.feature === feature && diff.owner === owner))
    return;
  diffs.push({ feature, owner, description });
}

/**
 * Compare the format reader, the SuiteLeaf model, and the export opened again.
 * Descriptions name the feature and a count. They do not include document text.
 */
export function classifyRoundTrip(
  reader: OfficeDigest,
  model: OfficeDigest,
  again: OfficeDigest,
): RoundTripDifference[] {
  const diffs: RoundTripDifference[] = [];
  for (const feature of reader.limits) {
    if (model.kept.includes(feature) && again.kept.includes(feature)) continue;
    push(
      diffs,
      feature,
      "model-limit",
      feature === "doc.nesting"
        ? "Tables nested deeper than the editor allows are flattened to paragraphs."
        : feature === "slide.table-format"
          ? "Bold and italic in a slide table are outside the slide schema."
          : "This feature is outside the SuiteLeaf schema.",
    );
  }
  for (const feature of [...reader.thirdParty, ...model.thirdParty])
    push(diffs, feature, "third-party", thirdPartyDescription(feature));
  const pairs: [string, string[], string[], string, number][] = [
    ["text", reader.texts, model.texts, "Import dropped text", 4],
    ["bold", reader.bold, model.bold, "Import dropped bold", 2],
    ["italic", reader.italic, model.italic, "Import dropped italic", 2],
    ["underline", reader.underline, model.underline, "Import dropped underline", 2],
    ["formula", reader.formulas, model.formulas, "Import dropped a formula", 4],
    ["notes", reader.notes, model.notes, "Import dropped speaker notes", 4],
  ];
  for (const [name, from, to, label, substringAt] of pairs) {
    const count = missingCount(from, to, substringAt);
    if (count)
      push(
        diffs,
        `import.${name}`,
        "suiteleaf",
        `${label} on ${count} item${count === 1 ? "" : "s"}.`,
      );
  }
  if (reader.images > model.images)
    push(
      diffs,
      "import.image",
      "suiteleaf",
      `Import dropped ${reader.images - model.images} image${reader.images - model.images === 1 ? "" : "s"}.`,
    );
  if (reader.tables > model.tables)
    push(
      diffs,
      "import.table",
      "suiteleaf",
      `Import dropped ${reader.tables - model.tables} table${reader.tables - model.tables === 1 ? "" : "s"}.`,
    );
  const exported: [string, string[], string[], string, number][] = [
    ["text", model.texts, again.texts, "Export dropped text", 4],
    ["bold", model.bold, again.bold, "Export dropped bold", 2],
    ["italic", model.italic, again.italic, "Export dropped italic", 2],
    ["underline", model.underline, again.underline, "Export dropped underline", 2],
    ["formula", model.formulas, again.formulas, "Export dropped a formula", 4],
    ["notes", model.notes, again.notes, "Export dropped speaker notes", 4],
  ];
  for (const [name, from, to, label, substringAt] of exported) {
    const count = missingCount(from, to, substringAt);
    if (count)
      push(
        diffs,
        `export.${name}`,
        "suiteleaf",
        `${label} on ${count} item${count === 1 ? "" : "s"}.`,
      );
  }
  if (model.images > again.images)
    push(
      diffs,
      "export.image",
      "suiteleaf",
      `Export dropped ${model.images - again.images} image${model.images - again.images === 1 ? "" : "s"}.`,
    );
  if (model.tables > again.tables)
    push(
      diffs,
      "export.table",
      "suiteleaf",
      `Export dropped ${model.tables - again.tables} table${model.tables - again.tables === 1 ? "" : "s"}.`,
    );
  return diffs.slice(0, 8);
}
