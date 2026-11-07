import { officeLineGrid } from "./office-line-grid";
import { OFFICE_TO_SUITELEAF, SUITELEAF_TO_OFFICE } from "./office-font-names";

const VENDOR = /^(?:adobe|itc|monotype|microsoft)$/i;
const STYLE =
  /^(?:pro|regular|bold|italic|oblique|light|medium|semibold|semilight|black|narrow|condensed|book|heavy|thin|ultralight|extralight|extrabold|demibold|mt|ps|std|roman)$/i;

/**
 * A vendor or style around an Office family is still that family.
 * "Adobe Garamond Pro" lays out as Garamond. "Arial (body)" is the theme body face.
 * A name that is not an Office family stays unchanged.
 */
function aliasedOfficeFace(name: string): string | undefined {
  const direct = OFFICE_TO_SUITELEAF[name];
  if (direct) return direct;
  const bare = name.replace(/\s*\((?:body|headings|heading)\)\s*$/i, "").trim();
  if (bare !== name && OFFICE_TO_SUITELEAF[bare]) return OFFICE_TO_SUITELEAF[bare];
  if (/^times$/i.test(name)) return OFFICE_TO_SUITELEAF["Times New Roman"];
  // Windows Office substitutes the Helvetica families with Arial. Preserve that
  // family choice instead of letting an unavailable Mac face fall back to Calibri.
  if (/^helvetica(?: neue)?$/i.test(bare)) return OFFICE_TO_SUITELEAF.Arial;
  const tokens = name.split(/\s+/).filter(Boolean);
  let start = 0;
  let end = tokens.length;
  while (start < end && VENDOR.test(tokens[start])) start += 1;
  while (end > start && STYLE.test(tokens[end - 1])) end -= 1;
  const core = tokens.slice(start, end).join(" ");
  if (!core || core === name) return undefined;
  return OFFICE_TO_SUITELEAF[core];
}

/** The installed family that lays out text the way the named Office font does; other names stay as they are. */
export function suiteLeafFont(name: string): string;
export function suiteLeafFont(name: string | undefined): string | undefined;
export function suiteLeafFont(name: string | undefined) {
  if (name === undefined) return undefined;
  const trimmed = name.trim();
  return aliasedOfficeFace(trimmed) ?? trimmed;
}

/** CSS font-family. A face this app does not ship falls back to Calibri, which is what PowerPoint draws. */
export function paintFontFamily(name: string | undefined): string {
  const raw = (name || "Arial").replace(/["'\\]/g, "").trim() || "Arial";
  const mapped = suiteLeafFont(raw);
  const quote = (face: string) => `'${face.replace(/["'\\]/g, "")}'`;
  if (mapped !== raw) return quote(mapped);
  return `${quote(mapped)}, ${quote(suiteLeafFont("Calibri"))}`;
}

/** The Office font an installed family stands in for, so files written for Office name fonts Office has. */
export function officeFont(name: string): string;
export function officeFont(name: string | undefined): string | undefined;
export function officeFont(name: string | undefined) {
  return name === undefined ? undefined : (SUITELEAF_TO_OFFICE[name.trim()] ?? name);
}

/**
 * Font-dependent line extents for document layout and glyph metrics.
 * PPTX baseline pitch uses pptx-line-spacing instead. A face this app does not ship
 * still uses the grid measured from the deck's embedded font, when it has one.
 * Shipped Office metrics stay ahead of that measurement.
 */
export function officeSingleSpacing(
  font: string | undefined,
  embedded?: ReadonlyMap<string, number>,
): number {
  if (!font) return 1;
  const name = font.trim();
  const mapped = suiteLeafFont(name) ?? "";
  const shipped = officeLineGrid[name] ?? officeLineGrid[mapped];
  if (shipped) return shipped;
  return embedded?.get(name) ?? embedded?.get(mapped) ?? 1;
}
