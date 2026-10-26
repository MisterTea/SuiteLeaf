import JSZip from "jszip";
const posix = {
  normalize(path: string) {
    const parts: string[] = [];
    for (const piece of path.split("/")) {
      if (!piece || piece === ".") continue;
      if (piece === "..") {
        if (parts.length && parts.at(-1) !== "..") parts.pop();
        else parts.push(piece);
      } else parts.push(piece);
    }
    return parts.join("/");
  },
  dirname(path: string) {
    return path.slice(0, path.lastIndexOf("/"));
  },
  basename(path: string) {
    return path.slice(path.lastIndexOf("/") + 1);
  },
  join(...paths: string[]) {
    return posix.normalize(paths.join("/"));
  },
  relative(from: string, to: string) {
    const a = from.split("/"),
      b = to.split("/");
    while (a.length && b.length && a[0] === b[0]) {
      a.shift();
      b.shift();
    }
    return [...a.map(() => ".."), ...b].join("/");
  },
};
const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
};
const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
const encoder = new TextEncoder();
const decoder = new TextDecoder();
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import type { SlideElement, SlideFile } from "./index";

const packagePath = z
  .string()
  .max(1024)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value.split("/").every((p) => p && p !== "." && p !== ".."),
    "Invalid native OOXML part path",
  );
export const nativeDrawingSchema = z
  .object({
    xml: z
      .string()
      .max(4_000_000)
      .refine(
        (value) => !/<!DOCTYPE|<!ENTITY/i.test(value),
        "Unsafe native drawing XML",
      ),
    relationships: z
      .array(
        z.object({
          id: z.string().max(200),
          type: z.string().max(2048),
          target: z.string().max(4096),
          mode: z.enum(["External"]).optional(),
        }),
      )
      .max(2048),
    parts: z
      .array(
        z.object({
          path: packagePath,
          base64: z
            .string()
            .regex(/^[A-Za-z0-9+/]*={0,2}$/)
            .refine((value) => value.length % 4 === 0),
          contentType: z.string().max(300),
        }),
      )
      .max(4096),
  })
  .superRefine((drawing, ctx) => {
    const paths = new Set(drawing.parts.map((p) => p.path));
    if (paths.size !== drawing.parts.length)
      ctx.addIssue({
        code: "custom",
        message: "Duplicate native OOXML part path",
      });
    for (const rel of drawing.relationships)
      if (!rel.mode && !paths.has(rel.target))
        ctx.addIssue({
          code: "custom",
          message: "Missing native OOXML relationship target",
        });
  });
export type NativeDrawing = z.infer<typeof nativeDrawingSchema>;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
});
const attrs = (value: string): Record<string, string> =>
  parser.parse(`<x ${value}/>`).x || {};
const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const resolve = (owner: string, target: string) =>
  target.startsWith("/")
    ? target.slice(1)
    : posix.normalize(posix.join(posix.dirname(owner), target));
const relPath = (owner: string) =>
  posix.join(posix.dirname(owner), "_rels", posix.basename(owner) + ".rels");
function relationships(xml: string) {
  return [...xml.matchAll(/<Relationship\b([^>]*?)\/?\s*>/g)].map((m) =>
    attrs(m[1]),
  );
}

/** Retain one editable native drawing and only its reachable OOXML dependencies. */
export async function gatherNativeDrawing(
  zip: JSZip,
  ownerPath: string,
  frameXml: string,
): Promise<NativeDrawing> {
  const contentTypes =
    (await zip.file("[Content_Types].xml")?.async("string")) || "";
  const defaults = new Map(
    [...contentTypes.matchAll(/<Default\b([^>]*?)\/?\s*>/g)].map((m) => {
      const a = attrs(m[1]);
      return [a.Extension, a.ContentType];
    }),
  );
  const overrides = new Map(
    [...contentTypes.matchAll(/<Override\b([^>]*?)\/?\s*>/g)].map((m) => {
      const a = attrs(m[1]);
      return [a.PartName?.replace(/^\//, ""), a.ContentType];
    }),
  );
  const sourceRels = relationships(
    (await zip.file(relPath(ownerPath))?.async("string")) || "",
  );
  const used = new Set(
    [...frameXml.matchAll(/\br:(?:id|embed|link)="([^"]*)"/g)]
      .map((m) => m[1])
      .filter(Boolean),
  );
  const rootRels = sourceRels
    .filter((r) => used.has(r.Id))
    .map((r) => ({
      id: r.Id,
      type: r.Type,
      target:
        r.TargetMode === "External" ? r.Target : resolve(ownerPath, r.Target),
      ...(r.TargetMode === "External" ? { mode: "External" as const } : {}),
    }));
  const parts: NativeDrawing["parts"] = [];
  const visited = new Set<string>();
  const visit = async (path: string) => {
    if (visited.has(path)) return;
    visited.add(path);
    const file = zip.file(path);
    if (!file) throw Error(`Native OOXML dependency missing: ${path}`);
    packagePath.parse(path);
    const data = await file.async("uint8array");
    parts.push({
      path,
      base64: toBase64(data),
      contentType:
        overrides.get(path) ||
        defaults.get(path.split(".").pop() || "") ||
        "application/octet-stream",
    });
    const rels = zip.file(relPath(path));
    if (rels) {
      const relXml = await rels.async("string");
      await visit(relPath(path));
      for (const r of relationships(relXml))
        if (r.TargetMode !== "External") await visit(resolve(path, r.Target));
    }
  };
  for (const rel of rootRels) if (!rel.mode) await visit(rel.target);
  const ownerXml = (await zip.file(ownerPath)?.async("string")) || "";
  const namespaces = [
    ...(
      /^<[^>]*>/m.exec(ownerXml.replace(/^<\?xml[^>]*>\s*/, ""))?.[0] || ""
    ).matchAll(/\b(xmlns(?::[\w]+)?)="([^"]*)"/g),
  ];
  let xml = frameXml;
  xml = xml.replace(
    /^<([\w:]+)\b/,
    (start) =>
      start +
      namespaces
        .filter(
          (m) =>
            !new RegExp(`\\b${m[1]}=`).test(
              /^<[^>]*>/.exec(frameXml)?.[0] || "",
            ),
        )
        .map((m) => ` ${m[1]}="${escape(m[2])}"`)
        .join(""),
  );
  return nativeDrawingSchema.parse({ xml, relationships: rootRels, parts });
}
export const nativeDrawingMarker = (id: string) => `suiteleaf-native-${id}`;

function movedDrawing(xml: string, element: SlideElement) {
  const emu = (n: number) => String(Math.round(n * 9525));
  return xml.replace(
    /<(?:a|p):xfrm\b[^>]*>[\s\S]*?<\/(?:a|p):xfrm>/,
    (transform) =>
      transform
        .replace(
          /<(a|p):off\b[^>]*\/?\s*>/,
          (_, prefix) =>
            `<${prefix}:off x="${emu(element.x)}" y="${emu(element.y)}"/>`,
        )
        .replace(
          /<(a|p):ext\b[^>]*\/?\s*>/,
          (_, prefix) =>
            `<${prefix}:ext cx="${emu(element.width)}" cy="${emu(element.height)}"/>`,
        ),
  );
}

/** Replace marked fallback objects with editable original native shapes, remapping every dependency. */
export async function graftNativeDrawings(
  bytes: Uint8Array,
  file: SlideFile,
): Promise<Uint8Array> {
  if (
    !Object.values(file.content.slides).some((slide) =>
      slide.elements.some((el) => el.nativeDrawing),
    )
  )
    return bytes;
  const zip = await JSZip.loadAsync(bytes);
  let types = await zip.file("[Content_Types].xml")!.async("string");
  let serial = 0;
  for (let i = 0; i < file.content.slideOrder.length; i++) {
    const slide = file.content.slides[file.content.slideOrder[i]];
    if (!slide) continue;
    const path = `ppt/slides/slide${i + 1}.xml`;
    let xml = await zip.file(path)!.async("string");
    const rp = relPath(path);
    let rels = await zip.file(rp)!.async("string");
    let shapeId = Math.max(
      0,
      ...[...xml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)].map((m) =>
        Number(m[1]),
      ),
    );
    for (const element of slide.elements) {
      if (!element.nativeDrawing) continue;
      const drawing = nativeDrawingSchema.parse(element.nativeDrawing);
      const marker = nativeDrawingMarker(element.id);
      const placeholder = [
        ...xml.matchAll(/<p:pic\b[\s\S]*?<\/p:pic>|<p:sp\b[\s\S]*?<\/p:sp>/g),
      ].find((m) => m[0].includes(marker));
      if (!placeholder)
        throw Error(`Native drawing export marker missing: ${marker}`);
      const prefix = `ppt/nativeObjects/object${++serial}/`;
      const mapped = new Map(
        drawing.parts.map((part) => [part.path, prefix + part.path]),
      );
      for (const part of drawing.parts) {
        const destination = mapped.get(part.path)!;
        let data = fromBase64(part.base64);
        if (part.path.endsWith(".rels")) {
          const owner = part.path
            .replace("/_rels/", "/")
            .replace(/\.rels$/, "");
          data = encoder.encode(
            decoder
              .decode(data)
              .replace(/<Relationship\b([^>]*?)\/?\s*>/g, (tag, raw) => {
                const a = attrs(raw);
                if (a.TargetMode === "External") return tag;
                const target = mapped.get(resolve(owner, a.Target));
                if (!target)
                  throw Error(`Native dependency not retained: ${a.Target}`);
                const relative = posix.relative(
                  posix.dirname(prefix + owner),
                  target,
                );
                return tag.replace(
                  /\bTarget="[^"]*"/,
                  `Target="${escape(relative)}"`,
                );
              }),
          );
        }
        zip.file(destination, data);
        if (!destination.endsWith(".rels"))
          types = types.replace(
            "</Types>",
            `<Override PartName="/${escape(destination)}" ContentType="${escape(part.contentType)}"/></Types>`,
          );
      }
      let native = movedDrawing(drawing.xml, element);
      const remappedIds = new Map<string, string>();
      for (const rel of drawing.relationships) {
        let id = 1;
        while (new RegExp(`\\bId="rId${id}"`).test(rels)) id++;
        const newId = `rId${id}`;
        const target = rel.mode
          ? rel.target
          : posix.relative("ppt/slides", mapped.get(rel.target)!);
        rels = rels.replace(
          "</Relationships>",
          `<Relationship Id="${newId}" Type="${escape(rel.type)}" Target="${escape(target)}"${rel.mode ? ' TargetMode="External"' : ""}/></Relationships>`,
        );
        remappedIds.set(rel.id, newId);
      }
      native = native.replace(
        /\br:(id|embed|link)="([^"]*)"/g,
        (tag, attribute, value) =>
          remappedIds.has(value)
            ? `r:${attribute}="${remappedIds.get(value)}"`
            : tag,
      );
      const originalRootId = /<p:cNvPr\b[^>]*\bid="(\d+)"/.exec(
        placeholder[0],
      )?.[1];
      let first = true;
      native = native.replace(
        /(<p:cNvPr\b[^>]*\bid=")\d+("[\s>])/g,
        (_, start, end) => {
          const id =
            first && originalRootId ? originalRootId : String(++shapeId);
          first = false;
          return start + id + end;
        },
      );
      xml = xml.replace(placeholder[0], native);
    }
    zip.file(path, xml);
    zip.file(rp, rels);
  }
  zip.file("[Content_Types].xml", types);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
