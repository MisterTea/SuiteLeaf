/**
 * Named paragraph styles and caption numbers.
 * Identity is the style id and the caption id, not the visible words.
 */

export type StyleDef = {
  id: string;
  name: string;
  basedOn?: string;
  bold?: boolean;
  fontSize?: number;
};

export type DirectFormat = {
  bold?: boolean;
  fontSize?: number;
};

export type ResolvedFormat = {
  bold?: boolean;
  fontSize?: number;
};

export type Caption = {
  id: string;
  kind: "figure" | "table";
  label: string;
  section?: number;
};

export type CaptionNumber = {
  id: string;
  text: string;
};

/** Inherited style values. A direct property, including `false`, wins. Cycles stop at the repeated id. */
export function effectiveFormat(
  styles: StyleDef[],
  styleId: string | undefined,
  direct: DirectFormat = {},
): ResolvedFormat {
  const byId = new Map(styles.map((style) => [style.id, style]));
  const resolved: ResolvedFormat = {};
  const seen = new Set<string>();
  let current = styleId ? byId.get(styleId) : undefined;
  const chain: StyleDef[] = [];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.basedOn ? byId.get(current.basedOn) : undefined;
  }
  for (const style of chain.reverse()) {
    if (style.bold !== undefined) resolved.bold = style.bold;
    if (style.fontSize !== undefined) resolved.fontSize = style.fontSize;
  }
  if (direct.bold !== undefined) resolved.bold = direct.bold;
  if (direct.fontSize !== undefined) resolved.fontSize = direct.fontSize;
  return resolved;
}

/** Number figures and tables separately, in the order they appear. */
export function numberCaptions(captions: Caption[]): CaptionNumber[] {
  const counts = { figure: 0, table: 0 };
  return captions.map((caption) => {
    counts[caption.kind] += 1;
    const title = caption.kind === "figure" ? "Figure" : "Table";
    return { id: caption.id, text: `${title} ${counts[caption.kind]}` };
  });
}

type CaptionTree = {
  type: string;
  attrs?: { captionId?: string; captionKind?: string; captionTarget?: string; kind?: string };
  content?: CaptionTree[];
  text?: string;
};

function captionLabel(node: CaptionTree): string {
  const parts: string[] = [];
  const walk = (current: CaptionTree) => {
    if (current.type === "text" && current.text) parts.push(current.text);
    for (const child of current.content ?? []) walk(child);
  };
  walk(node);
  return parts.join("").trim();
}

function collectCaptions(
  nodes: CaptionTree[],
  out: Caption[],
  section: { n: number; broken: boolean } = { n: 1, broken: false },
) {
  for (const node of nodes) {
    if (node.type === "sectionBreak") {
      section.n += 1;
      section.broken = true;
      continue;
    }
    if (node.type === "figureList" || node.type === "note") continue;
    const id = node.attrs?.captionId;
    const kind = node.attrs?.captionKind;
    if (id && (kind === "figure" || kind === "table")) {
      out.push({ id, kind, label: captionLabel(node), section: section.n });
    }
    if (node.content) collectCaptions(node.content, out, section);
  }
}

/** Figures and tables restart at each section break. A document with no break keeps one sequence. */
function captionNumbers(captions: Caption[], sectional: boolean): CaptionNumber[] {
  if (!sectional) return numberCaptions(captions);
  const counts: Record<string, number> = {};
  return captions.map((caption) => {
    const key = `${caption.section ?? 1}:${caption.kind}`;
    counts[key] = (counts[key] ?? 0) + 1;
    const title = caption.kind === "figure" ? "Figure" : "Table";
    return { id: caption.id, text: `${title} ${caption.section ?? 1}.${counts[key]}` };
  });
}

function captionLookup(
  captions: Caption[],
  targetId: string,
  sectional: boolean,
): { text: string } | { warning: string } {
  const found = captionNumbers(captions, sectional).find((item) => item.id === targetId);
  if (!found) {
    return {
      warning: "That caption is missing. Update or remove this reference.",
    };
  }
  return { text: found.text };
}

/**
 * Rewrite figure and table lists, and caption references, from the captions still in the document.
 * A list stores one paragraph per remaining caption. A missing reference stores the warning.
 * The input document is not changed.
 */
export function refreshCaptions<T extends { content?: CaptionTree[] }>(
  doc: T,
  pages?: Readonly<Record<string, number>>,
): T {
  const copy = structuredClone(doc);
  const captions: Caption[] = [];
  const section = { n: 1, broken: false };
  collectCaptions(copy.content ?? [], captions, section);
  const numbered = captionNumbers(captions, section.broken);
  const walk = (nodes: CaptionTree[]) => {
    for (const node of nodes) {
      if (node.type === "figureList") {
        const kind = node.attrs?.kind;
        node.content = numbered.flatMap((item, index) => {
          const caption = captions[index];
          if (!caption || (kind && caption.kind !== kind)) return [];
          const listed = `${item.text} ${caption.label}`.trim();
          const page = pages?.[caption.id];
          const text =
            typeof page === "number" && Number.isInteger(page) && page >= 1 && page <= 9999
              ? `${listed}, ${page}`
              : listed;
          return [
            {
              type: "paragraph",
              content: [{ type: "text", text }],
            },
          ];
        });
        continue;
      }
      const target = node.attrs?.captionTarget;
      if (target) {
        const result = captionLookup(captions, target, section.broken);
        node.content = [
          { type: "text", text: "text" in result ? result.text : result.warning },
        ];
      }
      if (node.content) walk(node.content);
    }
  };
  walk(copy.content ?? []);
  return copy;
}

/** The visible number for a reference, or a warning when that caption is gone. */
export function captionReference(
  captions: Caption[],
  targetId: string,
): { text: string } | { warning: string } {
  return captionLookup(captions, targetId, false);
}

export type CaptionWarning = {
  path: number[];
  targetId: string;
  message: string;
};

/** Where a reference points at a caption that is no longer in the document. The input is not changed. */
export function captionWarnings(doc: { content?: CaptionTree[] }): CaptionWarning[] {
  const captions: Caption[] = [];
  collectCaptions(doc.content ?? [], captions);
  const known = new Set(captions.map((caption) => caption.id));
  const warnings: CaptionWarning[] = [];
  const walk = (nodes: CaptionTree[], path: number[]) => {
    nodes.forEach((node, index) => {
      const here = [...path, index];
      const target = node.attrs?.captionTarget;
      if (typeof target === "string" && target && !known.has(target)) {
        warnings.push({
          path: here,
          targetId: target,
          message: "That caption is missing. Update or remove this reference.",
        });
      }
      if (node.content) walk(node.content, here);
    });
  };
  walk(doc.content ?? [], []);
  return warnings;
}

export type StyleMark = { type: string; attrs?: Record<string, unknown> };

export type StyleText = {
  type: "text";
  text?: string;
  marks?: StyleMark[];
};

export type StyleBlock = {
  type: string;
  attrs?: { styleId?: string; direct?: DirectFormat };
  content?: StyleText[];
};

function marksFor(text: StyleText, format: ResolvedFormat): StyleMark[] {
  const kept = (text.marks ?? []).filter((mark) => mark.type !== "bold" && mark.type !== "textStyle");
  const previous = (text.marks ?? []).find((mark) => mark.type === "textStyle");
  const attrs = { ...(previous?.attrs ?? {}) };
  if (format.fontSize !== undefined) attrs.fontSize = `${format.fontSize}pt`;
  else delete attrs.fontSize;
  const marks = [...kept];
  if (Object.keys(attrs).length > 0) marks.push({ type: "textStyle", attrs });
  if (format.bold) marks.push({ type: "bold" });
  return marks;
}

/** Named styles stored on a document. A bad entry is left out. */
export function paragraphStyles(doc: {
  attrs?: Record<string, unknown> | null;
}): StyleDef[] {
  const raw = doc.attrs?.paragraphStyles;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isStyle);
}

const WORD_STYLE_ID = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

/** A style id Word can store. Anything else is left out of the style part. */
export function wordStyleId(id: unknown): string | undefined {
  return typeof id === "string" && WORD_STYLE_ID.test(id) ? id : undefined;
}

/**
 * Word paragraph styles for a SuiteLeaf style list.
 * The size is in half-points. A direct override stays on the paragraph, not in this list.
 */
export function wordParagraphStyles(styles: StyleDef[]): {
  id: string;
  name: string;
  basedOn?: string;
  run: { bold?: boolean; size?: number };
}[] {
  const ids = new Set(styles.map((style) => style.id).filter((id) => wordStyleId(id)));
  return styles.flatMap((style) => {
    if (!ids.has(style.id)) return [];
    const basedOn =
      style.basedOn && ids.has(style.basedOn) && style.basedOn !== style.name
        ? style.basedOn
        : undefined;
    const run: { bold?: boolean; size?: number } = {};
    if (style.bold !== undefined) run.bold = style.bold;
    if (style.fontSize !== undefined) run.size = Math.round(style.fontSize * 2);
    return [{ id: style.id, name: style.name, ...(basedOn ? { basedOn } : {}), run }];
  });
}

function isStyle(value: unknown): value is StyleDef {
  if (!value || typeof value !== "object") return false;
  const style = value as Partial<StyleDef>;
  if (typeof style.id !== "string" || !style.id) return false;
  if (typeof style.name !== "string" || !style.name) return false;
  if (style.basedOn !== undefined && typeof style.basedOn !== "string") return false;
  if (style.bold !== undefined && typeof style.bold !== "boolean") return false;
  if (style.fontSize !== undefined && (typeof style.fontSize !== "number" || !Number.isFinite(style.fontSize)))
    return false;
  return true;
}

function acceptedSize(size: number | undefined): number | undefined {
  if (size === undefined) return undefined;
  if (size < 1 || size > 96) return undefined;
  return size;
}

/**
 * Add named styles from a template. A style id already on the document stays
 * as it is. A size outside 1–96 points is left out. A parent that is not
 * imported is omitted. Direct formatting stays on the paragraph. Neither
 * document passed in is changed.
 */
export function importParagraphStyles<
  T extends { attrs?: Record<string, unknown> | null; content?: StyleBlock[] },
>(target: T, template: { attrs?: Record<string, unknown> | null }): T {
  const current = paragraphStyles(target);
  const incoming = paragraphStyles(template).filter(
    (style) => style.fontSize === undefined || acceptedSize(style.fontSize) !== undefined,
  );
  const ids = new Set(current.map((style) => style.id));
  const added: StyleDef[] = [];
  for (const style of incoming) {
    if (ids.has(style.id)) continue;
    const fontSize = acceptedSize(style.fontSize);
    added.push({
      id: style.id,
      name: style.name,
      ...(fontSize !== undefined ? { fontSize } : {}),
      ...(style.bold !== undefined ? { bold: style.bold } : {}),
    });
    ids.add(style.id);
  }
  for (const style of added) {
    const source = incoming.find((item) => item.id === style.id);
    if (source?.basedOn && source.basedOn !== style.id && ids.has(source.basedOn)) {
      style.basedOn = source.basedOn;
    }
  }
  if (!added.length) return structuredClone(target);
  const copy = structuredClone(target);
  const next = [...current, ...added];
  copy.attrs = { ...(copy.attrs ?? {}), paragraphStyles: next };
  return applyStyleFormats(copy, next);
}

/**
 * Change one named style and write that size onto the paragraphs that use it.
 * A paragraph that stores its own size keeps that size. An unknown style id
 * changes nothing. The document passed in is not changed.
 */
export function updateNamedStyle<
  T extends { attrs?: Record<string, unknown> | null; content?: StyleBlock[] },
>(doc: T, styleId: string, patch: { fontSize?: number; bold?: boolean }): T {
  const styles = paragraphStyles(doc);
  const current = styles.find((style) => style.id === styleId);
  if (!current) return structuredClone(doc);
  const nextStyle = { ...current };
  if (
    typeof patch.fontSize === "number" &&
    Number.isFinite(patch.fontSize) &&
    patch.fontSize >= 1 &&
    patch.fontSize <= 96
  ) {
    nextStyle.fontSize = patch.fontSize;
  }
  if (typeof patch.bold === "boolean") nextStyle.bold = patch.bold;
  const nextStyles = styles.map((style) => (style.id === styleId ? nextStyle : style));
  const copy = structuredClone(doc);
  copy.attrs = { ...(copy.attrs ?? {}), paragraphStyles: nextStyles };
  return applyStyleFormats(copy, nextStyles);
}

/**
 * Point one paragraph at a named style and write that style onto its text.
 * A direct format on that paragraph still wins. An unknown style or a missing
 * paragraph changes nothing. The document passed in is not changed.
 */
export function assignParagraphStyle<
  T extends { attrs?: Record<string, unknown> | null; content?: StyleBlock[] },
>(doc: T, index: number, styleId: string): T {
  const styles = paragraphStyles(doc);
  if (!styles.some((style) => style.id === styleId)) return structuredClone(doc);
  const blocks = doc.content ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= blocks.length) return structuredClone(doc);
  const copy = structuredClone(doc);
  const block = copy.content?.[index];
  if (!block) return copy;
  block.attrs = { ...(block.attrs ?? {}), styleId };
  return applyStyleFormats(copy, styles);
}

/**
 * Bold and point size from the selected words. The words themselves are not copied.
 * No selection returns a fixed sentence. A size that is not 1 to 96 points is left out.
 */
export function stylePatchFromMarks(
  marks: StyleMark[] | null,
): { bold: boolean; fontSize?: number } | { error: string } {
  if (!marks) return { error: "Select the words to match." };
  const bold = marks.some((mark) => mark.type === "bold");
  const raw = marks.find((mark) => mark.type === "textStyle")?.attrs?.fontSize;
  let fontSize: number | undefined;
  if (typeof raw === "number" && raw >= 1 && raw <= 96) fontSize = raw;
  if (typeof raw === "string") {
    const match = /^(\d+(?:\.\d+)?)pt$/.exec(raw.trim());
    const size = match ? Number(match[1]) : NaN;
    if (size >= 1 && size <= 96) fontSize = size;
  }
  return fontSize === undefined ? { bold } : { bold, fontSize };
}

/**
 * Apply `paragraphStyles` from the document when that list is present.
 * A document with no list is returned as it was.
 */
export function styledDocument<T>(doc: T): T {
  const styles = paragraphStyles(doc as { attrs?: Record<string, unknown> | null });
  if (!styles.length) return doc;
  return applyStyleFormats(doc as { content?: StyleBlock[] }, styles) as T;
}

/**
 * Write each named style onto the text of the blocks that use it.
 * A block's `direct` format wins. Blocks with no style id are copied unchanged.
 * The input document is not changed.
 */
export function applyStyleFormats<T extends { content?: StyleBlock[] }>(
  doc: T,
  styles: StyleDef[],
): T {
  const copy = structuredClone(doc);
  for (const block of copy.content ?? []) {
    const styleId = block.attrs?.styleId;
    if (!styleId || !block.content) continue;
    const format = effectiveFormat(styles, styleId, block.attrs?.direct ?? {});
    block.content = block.content.map((text) =>
      text.type === "text" ? { ...text, marks: marksFor(text, format) } : text,
    );
  }
  return copy;
}

type HeadingNode = {
  type?: string;
  text?: string;
  attrs?: { id?: string; headingTarget?: string } | null;
  content?: HeadingNode[];
};

function headingText(node: HeadingNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map((child) => headingText(child)).join("");
}

function listedHeading(text: string): string {
  return text.replace(/^[\s\u200B-\u200D\uFEFF\u2060]+|[\s\u200B-\u200D\uFEFF\u2060]+$/g, "");
}

/**
 * Rewrite a heading reference to the heading's text.
 * A missing id stores a fixed warning and does not repeat the id.
 * The input document is not changed.
 */
export function refreshHeadingRefs<T extends { content?: HeadingNode[] }>(doc: T): T {
  const copy = structuredClone(doc);
  const titles = new Map<string, string>();
  const collect = (nodes: HeadingNode[]) => {
    for (const node of nodes) {
      if (node.type === "note") continue;
      const id = node.type === "heading" ? node.attrs?.id : undefined;
      if (id && !titles.has(id)) titles.set(id, listedHeading(headingText(node)));
      if (node.content) collect(node.content);
    }
  };
  collect(copy.content ?? []);
  const walk = (nodes: HeadingNode[]) => {
    for (const node of nodes) {
      const target = node.attrs?.headingTarget;
      if (typeof target === "string" && target) {
        const title = titles.get(target);
        const text =
          title === undefined
            ? "That heading is missing. Update or remove this reference."
            : title || "That heading has no title.";
        node.content = [{ type: "text", text }];
        continue;
      }
      if (node.content) walk(node.content);
    }
  };
  walk(copy.content ?? []);
  return copy;
}

export type CharacterStyle = {
  id: string;
  name: string;
  basedOn?: string;
  bold?: boolean;
  italic?: boolean;
};

type CharacterNode = {
  type?: string;
  text?: string;
  marks?: StyleMark[];
  content?: CharacterNode[];
};

/** Character styles stored on a document. A bad id is left out. */
export function characterStyleList(doc: {
  attrs?: Record<string, unknown> | null;
}): CharacterStyle[] {
  const raw = doc.attrs?.characterStyles;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const style = item as Partial<CharacterStyle>;
    const id = wordStyleId(style.id);
    if (!id || typeof style.name !== "string" || !style.name.trim()) return [];
    const basedOn = wordStyleId(style.basedOn);
    return [
      {
        id,
        name: style.name,
        ...(basedOn && basedOn !== id ? { basedOn } : {}),
        ...(style.bold === true || style.bold === false ? { bold: style.bold } : {}),
        ...(style.italic === true || style.italic === false ? { italic: style.italic } : {}),
      },
    ];
  });
}

/**
 * Add character styles from a template. A style id already on the document stays.
 * A parent that is not imported is omitted. The runs are not changed.
 * Neither document passed in is changed.
 */
export function importCharacterStyles<
  T extends { attrs?: Record<string, unknown> | null },
>(target: T, template: { attrs?: Record<string, unknown> | null }): T {
  const current = characterStyleList(target);
  const incoming = characterStyleList(template);
  const ids = new Set(current.map((style) => style.id));
  const added: CharacterStyle[] = [];
  for (const style of incoming) {
    if (ids.has(style.id)) continue;
    added.push({ ...style });
    ids.add(style.id);
  }
  for (const style of added) {
    if (!style.basedOn || !ids.has(style.basedOn)) delete style.basedOn;
  }
  const copy = structuredClone(target);
  if (!added.length) return copy;
  copy.attrs = { ...(copy.attrs ?? {}), characterStyles: [...current, ...added] };
  return copy;
}

function resolvedCharacter(
  styles: CharacterStyle[],
  id: string,
): { bold?: boolean; italic?: boolean } | undefined {
  const byId = new Map(styles.map((style) => [style.id, style]));
  const seen = new Set<string>();
  let current = byId.get(id);
  if (!current) return undefined;
  const chain: CharacterStyle[] = [];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = current.basedOn ? byId.get(current.basedOn) : undefined;
  }
  const resolved: { bold?: boolean; italic?: boolean } = {};
  for (const style of chain.reverse()) {
    if (style.bold !== undefined) resolved.bold = style.bold;
    if (style.italic !== undefined) resolved.italic = style.italic;
  }
  return resolved;
}

/** Bold and italic from a character style. A parent style contributes first. A direct `false` wins. The document passed in is not changed. */
export function applyCharacterStyles(
  doc: CharacterNode,
  styles: CharacterStyle[],
): { doc: CharacterNode; warnings: { message: string }[] } {
  const warnings: { message: string }[] = [];
  const known = new Set(styles.filter((style) => wordStyleId(style.id)).map((style) => style.id));
  const copy = structuredClone(doc);
  const walk = (node: CharacterNode) => {
    const id = node.marks?.find((mark) => mark.type === "characterStyle")?.attrs?.style;
    if (node.type === "text" && typeof id === "string") {
      const style = known.has(id) ? resolvedCharacter(styles, id) : undefined;
      if (!style) {
        warnings.push({ message: "That character style is not in this document." });
      } else {
        const direct = node.marks?.find((mark) => mark.type === "characterDirect");
        const kept = (node.marks ?? []).filter((mark) => mark.type !== "bold" && mark.type !== "italic");
        node.marks = [
          ...kept,
          ...(style.bold && direct?.attrs?.bold !== false ? [{ type: "bold" }] : []),
          ...(style.italic && direct?.attrs?.italic !== false ? [{ type: "italic" }] : []),
        ];
      }
    }
    node.content?.forEach(walk);
  };
  walk(copy);
  return { doc: copy, warnings };
}
