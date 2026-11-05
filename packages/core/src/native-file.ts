import {
  DRAWING_STARTERS,
  fileSchema,
  type JsonNode,
  type Kind,
  type SuiteFile,
} from "./file-schema";
export type {
  DrawingContent,
  DrawingFormat,
  DrawingFile,
  DocFile,
  FormFile,
  JsonNode,
  Kind,
  SheetFile,
  SlideFile,
  SuiteFile,
} from "./file-schema";
import { safeLink } from "./link-target";
import { packSharedMedia, unpackSharedMedia } from "./shared-media";

/** A slide picture is either embedded, or a relative path filled from the deck's imported files. */
function allowedSlideImage(src: string) {
  if (
    /^data:image\/(png|jpeg|gif|webp|bmp|svg\+xml|tiff|emf|wmf|wdp);base64,/i.test(
      src,
    )
  )
    return true;
  if (
    src.length > 400 ||
    src.includes("..") ||
    src.includes("\\") ||
    src.includes(":")
  )
    return false;
  return /^[A-Za-z0-9._~/+-]+$/.test(src);
}
function validateTree(n: JsonNode, depth = 0) {
  if (depth > 100) throw new Error("Document is nested too deeply.");
  if (
    (n.type === "image" || n.type === "inlineImage") &&
    !/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/i.test(String(n.attrs?.src))
  )
    throw new Error(
      "Native images must be embedded PNG, JPEG, GIF, WebP, or SVG data.",
    );
  for (const m of n.marks ?? [])
    if (m.type === "link" && !safeLink(String(m.attrs?.href)))
      throw new Error("Unsafe document link.");
  for (const c of n.content ?? []) validateTree(c, depth + 1);
}
export const LEGACY_EXTENSION = "suiteleaf";
const nativeExtensions = {
  doc: "sldoc",
  sheet: "slsheet",
  slide: "slslides",
  form: "slform",
  drawing: "sldraw",
} as const satisfies Record<Kind, string>;
const nativeMimes = {
  doc: "application/vnd.suiteleaf.doc+json",
  sheet: "application/vnd.suiteleaf.sheet+json",
  slide: "application/vnd.suiteleaf.slides+json",
  form: "application/vnd.suiteleaf.form+json",
  drawing: "application/vnd.suiteleaf.drawing+json",
} as const satisfies Record<Kind, string>;
export const NATIVE_EXTENSIONS = [
  ...Object.values(nativeExtensions),
  LEGACY_EXTENSION,
];
export function extensionFor(kind: Kind): string {
  return nativeExtensions[kind];
}
export function mimeFor(kind: Kind): string {
  return nativeMimes[kind];
}
/** `null` means a legacy `.suiteleaf` name, which may hold any kind; `undefined` is not native. */
export function kindFromName(name: string): Kind | null | undefined {
  const base = name.split(/[/\\]/).pop() ?? "";
  if (!base.includes(".")) return undefined;
  const ext = base.split(".").pop()?.toLowerCase();
  if (ext === LEGACY_EXTENSION) return null;
  return (Object.keys(nativeExtensions) as Kind[]).find(
    (k) => nativeExtensions[k] === ext,
  );
}
export function isNativeName(name: string): boolean {
  return kindFromName(name) !== undefined;
}
/**
 * Whether `text` takes more than `limit` bytes as UTF-8. A UTF-16 unit is one to
 * three bytes, so only text near the limit is encoded to find out.
 */
export function utf8LongerThan(text: string, limit: number): boolean {
  if (text.length * 3 <= limit) return false;
  if (text.length > limit) return true;
  return new TextEncoder().encode(text).length > limit;
}
/** Editable native JSON. Presentations embed media, so this sits above the old 200 MB cap. */
export const NATIVE_FILE_LIMIT = 1024 * 1024 * 1024;
export function parseFile(text: string, expectedKind?: Kind | null): SuiteFile {
  if (utf8LongerThan(text, NATIVE_FILE_LIMIT))
    throw new Error(
      `Native files must be smaller than ${NATIVE_FILE_LIMIT / (1024 * 1024)} MB.`,
    );
  const raw = unpackSharedMedia(JSON.parse(text));
  if (raw.version !== 1)
    throw new Error("This SuiteLeaf file version is not supported.");
  const file = fileSchema.parse(raw);
  if (expectedKind && file.kind !== expectedKind)
    throw new Error(
      `This .${nativeExtensions[expectedKind]} file contains a ${file.kind}, not a ${expectedKind}.`,
    );
  if (file.kind === "doc") {
    if (file.content.type !== "doc") throw new Error("Invalid document root.");
    validateTree(file.content);
    const ids = new Set<string>();
    for (const tab of file.tabs ?? []) {
      if (ids.has(tab.id))
        throw new Error("Document tabs must have distinct ids.");
      ids.add(tab.id);
      if (tab.content.type !== "doc") throw new Error("Invalid document tab.");
      validateTree(tab.content);
    }
  } else if (file.kind === "sheet") {
    if (
      new Set(file.content.workbook.sheetOrder).size !==
        file.content.workbook.sheetOrder.length ||
      !file.content.workbook.sheetOrder.length
    )
      throw new Error("Workbook must have distinct worksheets.");
    for (const id of file.content.workbook.sheetOrder)
      if (!file.content.workbook.sheets[id])
        throw new Error("Workbook contains a missing worksheet.");
    for (const item of [...file.content.charts, ...file.content.pivots])
      if (
        item.source.endRow < item.source.startRow ||
        item.source.endColumn < item.source.startColumn
      )
        throw new Error("Invalid source range.");
  } else if (file.kind === "slide") {
    if (
      new Set(file.content.slideOrder).size !==
        file.content.slideOrder.length ||
      !file.content.slideOrder.length
    )
      throw new Error("Presentation must have distinct slides.");
    for (const id of file.content.slideOrder)
      if (!file.content.slides[id])
        throw new Error("Presentation contains a missing slide.");
    for (const s of Object.values(file.content.slides)) {
      for (const el of s.elements) {
        if (el.poster && !allowedSlideImage(el.poster))
          throw new Error(
            "Native media posters must be embedded image data or an imported image path.",
          );
        if (el.type === "image" && el.src && !allowedSlideImage(el.src))
          throw new Error(
            "Native images must be embedded PNG, JPEG, GIF, WebP, BMP, SVG, TIFF, EMF, WMF, or JPEG XR data.",
          );
        if (
          el.type === "audio" &&
          el.src &&
          !/^data:audio\/(wav|mpeg|ogg);base64,/i.test(el.src)
        )
          throw new Error(
            "Native audio must be embedded WAV, MP3, or Ogg data.",
          );
        if (
          el.type === "video" &&
          el.src &&
          !/^data:video\/(mp4|webm|quicktime|mpeg);base64,/i.test(el.src)
        )
          throw new Error(
            "Native video must be embedded MP4, WebM, QuickTime, or MPEG data.",
          );
      }
    }
  } else if (file.kind === "form") {
    const ids = file.content.questions.map((q) => q.id);
    if (new Set(ids).size !== ids.length)
      throw new Error("Form questions must have distinct ids.");
    const responseIds = file.content.responses.map((r) => r.id);
    if (new Set(responseIds).size !== responseIds.length)
      throw new Error("Form responses must have distinct ids.");
  }
  return file;
}
export function serializeFile(file: SuiteFile): string {
  let text: string;
  try {
    text = JSON.stringify(file);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    text = JSON.stringify(packSharedMedia(file));
  }
  const parsed = parseFile(text);
  const copy = { ...parsed };
  if (!copy.edits?.length) delete copy.edits;
  if (!copy.versions?.length) delete copy.versions;
  try {
    return JSON.stringify(copy);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return JSON.stringify(packSharedMedia(copy));
  }
}
export function createFile(
  kind: Kind,
  title = kind === "doc"
    ? "Untitled document"
    : kind === "sheet"
      ? "Untitled spreadsheet"
      : kind === "form"
        ? "Untitled form"
        : kind === "drawing"
          ? "Untitled drawing"
          : "Untitled presentation",
): SuiteFile {
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  const base = {
    format: "suiteleaf" as const,
    version: 1 as const,
    id,
    title,
    createdAt: now,
    updatedAt: now,
  };
  if (kind === "doc")
    return {
      ...base,
      kind,
      content: { type: "doc", content: [{ type: "paragraph" }] },
    };
  if (kind === "slide") {
    const slideId = crypto.randomUUID();
    return {
      ...base,
      kind,
      content: {
        id,
        width: 960,
        height: 540,
        slideOrder: [slideId],
        slides: {
          [slideId]: {
            id: slideId,
            layout: "title",
            elements: [
              {
                id: crypto.randomUUID(),
                type: "text",
                x: 100,
                y: 160,
                width: 760,
                height: 100,
                content: "",
                placeholder: "Click to add title",
                fontSize: 44,
                bold: true,
                align: "center",
                color: "#1e293b",
              },
              {
                id: crypto.randomUUID(),
                type: "text",
                x: 100,
                y: 280,
                width: 760,
                height: 60,
                content: "",
                placeholder: "Click to add subtitle",
                fontSize: 22,
                align: "center",
                color: "#64748b",
              },
            ],
            notes: "",
          },
        },
      },
    };
  }
  if (kind === "form")
    return { ...base, kind, content: { questions: [], responses: [] } };
  if (kind === "drawing")
    return {
      ...base,
      kind,
      content: { format: "svg", source: DRAWING_STARTERS.svg },
    };
  const sheetId = crypto.randomUUID();
  return {
    ...base,
    kind,
    content: {
      workbook: {
        id,
        name: title,
        appVersion: "1.0.3",
        locale: "enUS",
        styles: {},
        sheetOrder: [sheetId],
        sheets: {
          [sheetId]: {
            id: sheetId,
            name: "Sheet1",
            rowCount: 1000,
            columnCount: 26,
            cellData: {},
            defaultColumnWidth: 100,
            defaultRowHeight: 24,
          },
        },
      },
      charts: [],
      pivots: [],
    },
  };
}
export function duplicateFile(
  file: SuiteFile,
  title = `${file.title.slice(0, 190)} copy`,
): SuiteFile {
  const copy = structuredClone(file);
  copy.id = crypto.randomUUID();
  copy.title = title;
  copy.createdAt = copy.updatedAt = new Date().toISOString();
  if (copy.kind === "sheet") copy.content.workbook.id = copy.id;
  if (copy.kind === "slide") copy.content.id = copy.id;
  return copy;
}
export function filename(title: string, extension = "suiteleaf") {
  return `${
    title
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .trim()
      .slice(0, 150) || "Untitled"
  }.${extension}`;
}
export function nativeFilename(file: Pick<SuiteFile, "title" | "kind">) {
  return filename(file.title, extensionFor(file.kind));
}
/** Parse a native file using the kind implied by its name. */
export function parseNamedFile(name: string, text: string): SuiteFile {
  const kind = kindFromName(name);
  if (kind === undefined)
    throw new Error(
      `SuiteLeaf files use ${NATIVE_EXTENSIONS.map((e) => `.${e}`).join(", ")}.`,
    );
  return parseFile(text, kind);
}
