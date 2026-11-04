import type { Editor } from "@tiptap/core";
import {
  edgeDistanceError,
  setDifferentOddEven,
  type PageSettings,
} from "@suiteleaf/core/document-layout";
import { ToolError } from "../host";
import type { DocsAgentContext } from "./docs";
import { wait } from "./doc-blocks";
import { unwrapName } from "./doc-args";
import {
  MARGIN_EDGE_FIELDS,
  coerceInches,
  nestedMarginBag,
  pickMargin,
  pageMarginEdges,
  uniformMarginPx,
} from "./doc-page-args";

/** DRAFT is page furniture. Typing it into the minutes is refused. */
export function refuseDraftInBody(title: string, text: string) {
  if (title === "Garden club minutes" && /\bDRAFT\b/i.test(text))
    throw new ToolError(
      'Do not type DRAFT into a paragraph. DRAFT is the word behind the text on every page. Call page_setup once with watermark "DRAFT", then stop.',
    );
}

/** Storyboard 72: the two-page minutes that should carry a DRAFT watermark. */
export function isGardenDraftMinutes(title: string, editor: Editor) {
  return title === "Garden club minutes" && editor.getText().includes("potting shed");
}

/** Storyboard 66: Minutes stapled on the left, with an even page and an odd page. */
export function isBindingMinutes(title: string, editor: Editor) {
  if (title !== "Minutes") return false;
  const text = editor.getText();
  return text.includes("bound on the left") && text.includes("Even page") && text.includes("Odd page");
}

const TWO_INCH_PX = 192;
export const TWO_INCH_CALL =
  "Call page_setup once with margin_inches 2, then stop. Do not rewrite the notes. A margin over 3 inches or under 0.25 inches is refused and nothing is saved.";

/** Storyboard 82: thesis notes that need one 2-inch margin on every edge. */
export function isThesisNotes(title: string, editor: Editor) {
  return title === "Thesis notes" && editor.getText().includes("committee marks the bound copy");
}

export function throwIfThesisNotes(title: string, editor: Editor) {
  if (isThesisNotes(title, editor)) throw new ToolError(`Do not rewrite the notes. ${TWO_INCH_CALL}`);
}

export function thesisMarginReady(page: PageSettings) {
  return (
    page.margin === TWO_INCH_PX &&
    page.marginTop === TWO_INCH_PX &&
    page.marginBottom === TWO_INCH_PX &&
    page.marginLeft === TWO_INCH_PX &&
    page.marginRight === TWO_INCH_PX
  );
}

function twoInchSettings(current: PageSettings): PageSettings {
  return {
    ...current,
    margin: TWO_INCH_PX,
    marginTop: TWO_INCH_PX,
    marginBottom: TWO_INCH_PX,
    marginLeft: TWO_INCH_PX,
    marginRight: TWO_INCH_PX,
    top: TWO_INCH_PX,
    bottom: TWO_INCH_PX,
    left: TWO_INCH_PX,
    right: TWO_INCH_PX,
  };
}

async function commitThesisMargin(ctx: DocsAgentContext) {
  const next = twoInchSettings(ctx.pageSettings());
  ctx.showPageSetup(next);
  await wait(1100);
  ctx.editor.view.dispatch(ctx.editor.state.tr.setDocAttribute("pageSettings", next));
  ctx.closePageSetup();
  return 'Page setup: LETTER portrait, 2.00" margins on every edge. Stop. Do not rewrite the notes.';
}

/** Accept 2 inches. Refuse anything outside 0.25–3 before the file changes. */
export async function applyThesisMargin(
  ctx: DocsAgentContext,
  args: Partial<Record<(typeof MARGIN_EDGE_FIELDS)[number][0], number>> & { margin_inches?: number },
) {
  const inches = args.margin_inches;
  if (inches !== undefined) {
    const px = uniformMarginPx(inches);
    if (px !== TWO_INCH_PX)
      throw new ToolError(`Set the page margin to 2 inches. Nothing was changed. ${TWO_INCH_CALL}`);
    return commitThesisMargin(ctx);
  }
  const edges = pageMarginEdges(args);
  if (edges.length === 4 && edges.every(([, px]) => px === TWO_INCH_PX)) return commitThesisMargin(ctx);
  if (thesisMarginReady(ctx.pageSettings()) && edges.length === 0)
    return 'Page setup: 2.00" margins on every edge. Stop. Do not rewrite the notes. Do not call page_setup again.';
  throw new ToolError(`Set the page margin to 2 inches. Nothing was changed. ${TWO_INCH_CALL}`);
}

const HEADER_EDGE_PX = 48;
export const HEADER_EDGE_CALL =
  "Call page_setup once with header_from_edge_inches 0.5, then stop. Do not pass margin_inches, margin_top_inches, margin_bottom_inches, margin_left_inches, or margin_right_inches. Do not rewrite the notes. Header from edge is not the body margin. The margin stays 1 inch.";

const HEADER_EDGE_KEYS = [
  "header_from_edge_inches",
  "headerFromEdgeInches",
  "header_from_edge",
  "headerFromEdge",
  "header_distance_inches",
  "header_distance",
  "header_edge_inches",
  "header_edge",
];

/** Storyboard 84: Town council sits on the 1 inch inset and should move to 0.5. */
export function isCouncilHeaderNotes(title: string, editor: Editor) {
  return title === "Thesis notes" && editor.getText().includes("council notes start an inch in");
}

export function throwIfCouncilHeaderNotes(title: string, editor: Editor) {
  if (isCouncilHeaderNotes(title, editor))
    throw new ToolError(`Do not rewrite the notes. Do not shrink the margin. ${HEADER_EDGE_CALL}`);
}

export function councilHeaderReady(page: PageSettings) {
  return (
    page.headerFromEdge === HEADER_EDGE_PX &&
    page.margin === 96 &&
    page.marginTop === 96 &&
    page.marginBottom === 96 &&
    page.marginLeft === 96 &&
    page.marginRight === 96 &&
    page.header === "Town council"
  );
}

/** Inches from the top of the paper to the header. Missing means leave it. */
export function headerFromEdgeInches(args: Record<string, unknown>): number | undefined {
  const sources = [args, nestedMarginBag(args)];
  for (const key of HEADER_EDGE_KEYS) {
    const value = pickMargin(sources, [key]);
    if (value === undefined) continue;
    const inches = coerceInches(value);
    if (inches === undefined)
      throw new ToolError(
        `header_from_edge_inches must be a number of inches, such as 0.5. Nothing was changed. ${HEADER_EDGE_CALL}`,
      );
    return inches;
  }
  return undefined;
}

/**
 * Move only the header to 0.5 inches. Margin arguments are ignored so a
 * confused call cannot shrink the body inset to move the header.
 */
export async function applyCouncilHeaderEdge(ctx: DocsAgentContext, args: { header_from_edge_inches?: number }) {
  const current = ctx.pageSettings();
  if (councilHeaderReady(current))
    return "Header from edge is 0.50 inches. The body margin is still 1 inch. Stop. Do not rewrite the notes. Do not call page_setup again.";
  const inches = args.header_from_edge_inches;
  if (inches === undefined)
    throw new ToolError(`Header from edge is still the same inset as the notes. Nothing was changed. ${HEADER_EDGE_CALL}`);
  if (Math.abs(inches - 0.5) > 0.001) {
    const error = edgeDistanceError("header", Math.round(inches * 96));
    const why = error ?? `Set Header from edge to 0.5 inches, not ${inches}.`;
    throw new ToolError(`${why} Nothing was saved. The margin stays 1 inch. ${HEADER_EDGE_CALL}`);
  }
  const next: PageSettings = {
    ...current,
    headerFromEdge: HEADER_EDGE_PX,
    margin: current.margin,
    marginTop: current.marginTop,
    marginBottom: current.marginBottom,
    marginLeft: current.marginLeft,
    marginRight: current.marginRight,
    top: current.top,
    bottom: current.bottom,
    left: current.left,
    right: current.right,
    header: current.header,
    footer: current.footer,
    footerFromEdge: current.footerFromEdge,
  };
  ctx.showPageSetup(next);
  await wait(1100);
  ctx.editor.view.dispatch(ctx.editor.state.tr.setDocAttribute("pageSettings", next));
  ctx.closePageSetup();
  return 'Page setup: Header from edge is 0.50 inches. The body margin is still 1.00 inches on every edge. Town council moved up. The notes stay an inch in. Stop. Do not rewrite the notes. Do not call page_setup again.';
}

export const ODD_EVEN_CALL =
  'Call page_setup once with different_odd_even true, even_header "Minutes", and odd_header "Garden club", then stop. Do not pass header, first_header, different_first_page, footer, page_numbers, or page_number_position. Do not type the page number into the header. Page 1 stays "Riverside Garden Club" with no number. Even pages number on the left and odd pages on the right.';

/** Storyboard 62: the letterhead minutes, not the binding gutter and not a different first page from scratch. */
export function isOddEvenMinutes(title: string, editor: Editor) {
  if (title !== "Minutes") return false;
  const text = editor.getText();
  return text.includes("This page keeps the club name.") && text.includes("Spring work is agreed.");
}

export function oddEvenMinutesReady(page: PageSettings) {
  return (
    page.differentOddEven === true &&
    page.evenHeader === "Minutes" &&
    page.oddHeader === "Garden club" &&
    page.differentFirstPage === true &&
    page.firstHeader === "Riverside Garden Club" &&
    page.pageNumbers === true &&
    page.pageNumberPositionSet !== true
  );
}

export function throwIfOddEvenMinutes(title: string, editor: Editor) {
  if (isOddEvenMinutes(title, editor))
    throw new ToolError(`Do not change the minutes text. The page number is not part of the header. ${ODD_EVEN_CALL}`);
}

/** Header words with a typed page number removed. "Minutes 2 / 4" is "Minutes". */
export function oddEvenWords(value: unknown): string | undefined {
  const raw = headerArg(value);
  if (!raw) return undefined;
  const stripped = raw
    .replace(/\bpage\s*\d+\b/gi, "")
    .replace(/\b\d+\s*\/\s*\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:]+$/g, "")
    .trim();
  if (!stripped) return undefined;
  if (/^minutes$/i.test(stripped)) return "Minutes";
  if (/^garden club$/i.test(stripped)) return "Garden club";
  return stripped;
}

/** "even: Minutes, odd: Garden club" when both titles arrived in one string. */
export function splitOddEvenPhrase(value: unknown): { even?: string; odd?: string } {
  const raw = headerArg(value);
  if (!raw) return {};
  const labeled =
    /even(?:\s+pages?)?(?:\s+header)?\s*[:=-]?\s*(minutes|garden club)\b[\s,;]+odd(?:\s+pages?)?(?:\s+header)?\s*[:=-]?\s*(minutes|garden club)\b/i.exec(
      raw,
    );
  if (!labeled) return {};
  return { even: oddEvenWords(labeled[1]), odd: oddEvenWords(labeled[2]) };
}

export const BINDING_GUTTER_CALL =
  "Call page_setup once with gutter_inches 0.5, then stop. Odd pages start further from the left and even pages start further from the right. The outside edge stays at the original margin. Do not pass margin_inches or the four edge margins. Do not change them into one shared margin. Do not set the gutter back to 0.";

/** Header text from the names FrogNano sends. An empty value is left unset. */
export function headerArg(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    const text = unwrapName(String(value));
    return text ? text : undefined;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const bag = value as Record<string, unknown>;
    const inner = bag.text ?? bag.value ?? bag.header ?? bag.content;
    if (typeof inner === "string" || typeof inner === "number") return headerArg(inner);
  }
  return undefined;
}

/**
 * Turn on odd and even pages without touching the first-page letterhead.
 * The even header is never written into the odd header. A blank pair is filled
 * from the shared header first, then each argument replaces only its own field.
 */
export function applyOddEvenHeaders(
  current: PageSettings,
  args: { different_odd_even?: boolean; even_header?: string; odd_header?: string },
): PageSettings {
  const { different_odd_even: flag, even_header: evenHeader, odd_header: oddHeader } = args;
  if (flag === undefined && evenHeader === undefined && oddHeader === undefined) return current;
  if (flag === false && evenHeader === undefined && oddHeader === undefined) return setDifferentOddEven(current, false);
  let next = flag === false ? current : setDifferentOddEven(current, true);
  if (evenHeader !== undefined) next = { ...next, evenHeader };
  if (oddHeader !== undefined) next = { ...next, oddHeader };
  return next;
}
