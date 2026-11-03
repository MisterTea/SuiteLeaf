/**
 * Master alt text, slide overrides, and reading order.
 * Ids are the identity. The lists are plain JSON.
 */

export type SlidePiece = {
  id: string;
  type: "text" | "image" | "shape" | "table" | "video" | "audio";
  alt?: string;
  /** When true, a master change does not replace `alt`. */
  altOverride?: boolean;
  /** When true, the object is not read and does not need alternative text. */
  decorative?: boolean;
};

export type MasterPiece = {
  id: string;
  alt?: string;
};

export type SlideNote = {
  id: string;
  rule: "missing-alt" | "missing-object";
  message: string;
};

/** Copy master alt onto pieces that have not overridden it. The inputs are not changed. */
export function applyMaster(
  pieces: SlidePiece[],
  master: MasterPiece[],
): SlidePiece[] {
  const byId = new Map(master.map((piece) => [piece.id, piece]));
  return pieces.map((piece) => {
    if (piece.altOverride) return { ...piece };
    const fromMaster = byId.get(piece.id);
    if (!fromMaster || fromMaster.alt === undefined) return { ...piece };
    return { ...piece, alt: fromMaster.alt };
  });
}

/**
 * Reading order is the given ids that exist on the slide, then any piece the
 * list left out, in slide order. Ids that are not on the slide are `missing`.
 */
export function readingOrder(
  pieces: SlidePiece[],
  order?: string[],
): { ids: string[]; missing: string[] } {
  const known = new Set(pieces.map((piece) => piece.id));
  const decorative = new Set(pieces.filter((piece) => piece.decorative).map((piece) => piece.id));
  const listed = order ?? pieces.map((piece) => piece.id);
  const ids: string[] = [];
  const missing: string[] = [];
  for (const id of listed) {
    if (!known.has(id)) missing.push(id);
    else if (!decorative.has(id) && !ids.includes(id)) ids.push(id);
  }
  for (const piece of pieces) {
    if (!piece.decorative && !ids.includes(piece.id)) ids.push(piece.id);
  }
  return { ids, missing };
}

/**
 * Move one object earlier or later in reading order. The first object cannot
 * move earlier, and the last cannot move later. An id that is not on the
 * slide is left out. The lists passed in are not changed.
 */
export function moveReadingOrder(
  pieces: SlidePiece[],
  order: string[] | undefined,
  id: string,
  direction: "earlier" | "later",
): string[] {
  const ids = [...readingOrder(pieces, order).ids];
  const index = ids.indexOf(id);
  if (index < 0) return ids;
  const next = direction === "earlier" ? index - 1 : index + 1;
  if (next < 0 || next >= ids.length) return ids;
  const [item] = ids.splice(index, 1);
  ids.splice(next, 0, item);
  return ids;
}

/** Images with no alt text, and reading-order ids that are not on the slide. */
export function slideAccessNotes(
  pieces: SlidePiece[],
  order?: string[],
): SlideNote[] {
  const notes: SlideNote[] = [];
  const { ids, missing } = readingOrder(pieces, order);
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  for (const id of ids) {
    const piece = byId.get(id);
    if (piece?.type === "image" && !piece.alt?.trim()) {
      notes.push({
        id,
        rule: "missing-alt",
        message: "This image needs alternative text.",
      });
    }
    if ((piece?.type === "video" || piece?.type === "audio") && !piece.alt?.trim()) {
      notes.push({
        id,
        rule: "missing-alt",
        message:
          piece.type === "video"
            ? "This video needs alternative text."
            : "This audio needs alternative text.",
      });
    }
  }
  for (const id of missing) {
    notes.push({
      id,
      rule: "missing-object",
        message: "Reading order names an object that is not on this slide.",
    });
  }
  return notes;
}

export type SlideObjectLine = {
  id: string;
  type: SlidePiece["type"];
  text: string;
};

/** One line per object, in reading order. Images and shapes show their alt text. */
export function slideObjectLines(
  pieces: SlidePiece[],
  texts: Record<string, string> = {},
  order?: string[],
): SlideObjectLine[] {
  const byId = new Map(pieces.map((piece) => [piece.id, piece]));
  return readingOrder(pieces, order).ids.flatMap((id) => {
    const piece = byId.get(id);
    if (!piece) return [];
    const described =
      piece.type === "image" ||
      piece.type === "shape" ||
      piece.type === "video" ||
      piece.type === "audio";
    const text = described ? (piece.alt ?? "") : (texts[id] ?? "");
    return [{ id, type: piece.type, text }];
  });
}

/** The words in a table, one row per line and one tab between cells. */
export function tableFieldText(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.join("\t")).join("\n");
}

/**
 * Read a table field back into rows. A different column count is refused.
 * The message does not include the typed text.
 */
export function tableFieldRows(
  text: string,
  columns: number,
): { rows: string[][] } | { error: string } {
  if (!Number.isInteger(columns) || columns < 1) return { error: "This table has no columns." };
  const rows = text.split("\n").map((line) => line.split("\t"));
  if (rows.some((row) => row.length !== columns)) return { error: "Keep the same number of columns." };
  return { rows };
}

/**
 * Change one object's text or alternative text. Other objects stay as they were.
 * The inputs are not changed.
 */
export function editSlideObject(
  pieces: SlidePiece[],
  texts: Record<string, string>,
  id: string,
  next: string,
): { pieces: SlidePiece[]; texts: Record<string, string> } {
  const piece = pieces.find((item) => item.id === id);
  if (!piece) return { pieces: pieces.map((item) => ({ ...item })), texts: { ...texts } };
  if (
    piece.type === "image" ||
    piece.type === "shape" ||
    piece.type === "video" ||
    piece.type === "audio"
  ) {
    return {
      pieces: pieces.map((item) =>
        item.id === id ? { ...item, alt: next, altOverride: true } : { ...item },
      ),
      texts: { ...texts },
    };
  }
  return {
    pieces: pieces.map((item) => ({ ...item })),
    texts: { ...texts, [id]: next },
  };
}

export type SlideAccessWrite =
  | { id: string; alt: string | undefined }
  | { id: string; decorative: true | undefined }
  | { id: string; content: string }
  | { id: string; rows: string[][] };

type StoredAccessObject = {
  id: string;
  alt?: string;
  content?: string;
  decorative?: boolean;
  rows?: string[][];
};

/** Changes the accessibility panel should store. The slide passed in is not changed. */
export function slideAccessWrites(
  stored: readonly StoredAccessObject[],
  pieces: readonly SlidePiece[],
  texts: Readonly<Record<string, string>>,
): SlideAccessWrite[] {
  const writes: SlideAccessWrite[] = [];
  for (const piece of pieces) {
    const current = stored.find((element) => element.id === piece.id);
    if (!current) continue;
    if (
      (piece.type === "image" ||
        piece.type === "shape" ||
        piece.type === "video" ||
        piece.type === "audio") &&
      piece.alt !== current.alt
    ) {
      writes.push({ id: piece.id, alt: piece.alt });
    }
    if (Boolean(piece.decorative) !== Boolean(current.decorative)) {
      writes.push({ id: piece.id, decorative: piece.decorative ? true : undefined });
    }
    if (
      piece.type === "text" &&
      texts[piece.id] !== undefined &&
      texts[piece.id] !== (current.content ?? "")
    ) {
      writes.push({ id: piece.id, content: texts[piece.id] });
    }
    if (piece.type === "table" && texts[piece.id] !== undefined) {
      const columns = current.rows?.[0]?.length ?? 0;
      const parsed = tableFieldRows(texts[piece.id], columns);
      if (!("error" in parsed)) writes.push({ id: piece.id, rows: parsed.rows });
    }
  }
  return writes;
}

export type SlideCheck = {
  rule: "missing-title" | "low-contrast" | "bad-color";
  message: string;
};

function channel(hex: string, start: number): number {
  const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string): number {
  const body = color.startsWith("#") ? color.slice(1) : color;
  if (!/^[0-9a-fA-F]{6}$/.test(body)) return Number.NaN;
  return 0.2126 * channel(body, 0) + 0.7152 * channel(body, 2) + 0.0722 * channel(body, 4);
}

function sixDigit(color: string): string {
  const trimmed = color.trim();
  const body = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-fA-F]{3}$/.test(body)) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  return trimmed;
}

/** Contrast of two hex colors. A three-digit color is expanded. Anything else is not a ratio. */
export function contrastRatio(background: string, foreground: string): number {
  const left = luminance(sixDigit(background));
  const right = luminance(sixDigit(foreground));
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.NaN;
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

export type TitleColorBox = {
  type?: string;
  content?: string;
  color?: string;
  decorative?: boolean;
  runs?: { color?: string }[];
};

/** The title box color, or the first text box, or the editor's default black. A decorative box is skipped. */
export function titleTextColor(elements: TitleColorBox[], title: string): string {
  const named = title.trim();
  const texts = elements.filter((element) => element.type === "text" && !element.decorative);
  const match =
    named.length > 0
      ? texts.find((element) => (element.content ?? "").trim() === named)
      : undefined;
  const box = match ?? texts[0];
  const run = box?.runs?.map((item) => item.color?.trim()).find((color) => color);
  return run || box?.color?.trim() || "#111111";
}

/**
 * A blank title, and title text that is below 4.5:1 against the slide background.
 * The messages do not repeat the title or the color text. This is not a WCAG claim.
 */
function visibleTitle(title: string): string {
  return title.replace(/^[\s\u200B-\u200D\uFEFF\u2060]+|[\s\u200B-\u200D\uFEFF\u2060]+$/g, "");
}

export function slideChecks(input: { title: string; background: string; text: string }): SlideCheck[] {
  const notes: SlideCheck[] = [];
  if (!visibleTitle(input.title)) {
    notes.push({ rule: "missing-title", message: "This slide needs a title." });
  }
  const ratio = contrastRatio(input.background, input.text);
  if (!Number.isFinite(ratio)) {
    notes.push({ rule: "bad-color", message: "The slide colors are not hex colors." });
  } else if (ratio < 4.5) {
    notes.push({
      rule: "low-contrast",
      message: "The title color does not contrast with the slide background.",
    });
  }
  return notes;
}

/** A video or audio clip with no caption text. The address is not in the note. */
export function mediaCaptionNotes(
  elements: readonly { type?: string; caption?: string; src?: string }[],
): string[] {
  const notes: string[] = [];
  for (const element of elements) {
    if (element.type !== "video" && element.type !== "audio") continue;
    if (element.caption?.trim()) continue;
    notes.push(element.type === "video" ? "This video has no captions." : "This audio has no captions.");
  }
  return notes;
}

const EMBEDDED_POSTER = /^data:image\/(png|jpeg|gif|webp|bmp|svg\+xml);base64,/i;

/** A still picture on a video or audio clip. The picture address is not in the note. */
export function mediaPictureNotes(
  elements: readonly { type?: string; poster?: string; alt?: string; src?: string }[],
): string[] {
  const notes: string[] = [];
  for (const element of elements) {
    if (element.type !== "video" && element.type !== "audio") continue;
    const poster = element.poster?.trim() ?? "";
    if (!poster) continue;
    const video = element.type === "video";
    if (!EMBEDDED_POSTER.test(poster)) {
      notes.push(video ? "This video's picture is not an embedded image." : "This audio's picture is not an embedded image.");
      continue;
    }
    if (!element.alt?.trim()) {
      notes.push(video ? "This video's picture needs alternative text." : "This audio's picture needs alternative text.");
    }
  }
  return notes;
}
