import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parser } from "stream-json";
import { filter } from "stream-json/filters/filter.js";
import {
  NATIVE_FILE_LIMIT,
  kindFromName,
  type SuiteFile,
} from "@suiteleaf/core";

const keys = [
  "format",
  "version",
  "id",
  "title",
  "kind",
  "createdAt",
  "updatedAt",
] as const;
const metadataPath = /^(format|version|id|title|kind|createdAt|updatedAt)$/;

/** Catalogs never own document bodies, embedded media, tabs or edit history. */
export function catalogFile(file: SuiteFile): SuiteFile {
  return Object.fromEntries(
    keys.map((key) => [key, file[key]]),
  ) as unknown as SuiteFile;
}

export async function fileSignature(path: string) {
  const info = await stat(path);
  if (!info.isFile() || info.size > NATIVE_FILE_LIMIT)
    throw new Error("Invalid native file size.");
  return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(":");
}

/** Hash the bytes once and assemble only the small fields used by the library. */
export async function readCatalogFile(path: string) {
  const hash = createHash("sha256");
  const metadata: Record<string, unknown> = {};
  let bytes = 0;
  let metadataSize = 0;
  let key = "",
    value = "",
    depth = 0;
  await pipeline(
    createReadStream(path),
    new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        if (bytes > NATIVE_FILE_LIMIT)
          return done(new Error("Native file is too large."));
        hash.update(chunk);
        done(null, chunk);
      },
    }),
    parser.asStream({
      packValues: false,
      packKeys: true,
      streamKeys: false,
      maxPackedLength: 4096,
    }),
    filter.asStream({ filter: metadataPath }),
    new Writable({
      objectMode: true,
      write(token, _encoding, done) {
        metadataSize +=
          typeof token.value === "string" ? token.value.length : 1;
        if (metadataSize > 8192)
          return done(new Error("Native metadata is too large."));
        switch (token.name) {
          case "startObject":
            if (++depth > 1) return done(new Error("Invalid metadata value."));
            break;
          case "endObject":
            depth--;
            break;
          case "startArray":
            return done(new Error("Invalid metadata value."));
          case "keyValue":
            key = token.value;
            break;
          case "startString":
          case "startNumber":
            value = "";
            break;
          case "stringChunk":
          case "numberChunk":
            value += token.value;
            break;
          case "endString":
            metadata[key] = value;
            break;
          case "endNumber":
            metadata[key] = Number(value);
            break;
          case "nullValue":
          case "trueValue":
          case "falseValue":
            metadata[key] = token.value;
            break;
        }
        done();
      },
    }),
  );
  const expected = kindFromName(path);
  if (
    metadata.format !== "suiteleaf" ||
    metadata.version !== 1 ||
    typeof metadata.id !== "string" ||
    !metadata.id ||
    typeof metadata.title !== "string" ||
    !metadata.title ||
    metadata.title.length > 200 ||
    !["doc", "sheet", "slide", "form", "drawing"].includes(
      String(metadata.kind),
    ) ||
    (expected && metadata.kind !== expected) ||
    ![metadata.createdAt, metadata.updatedAt].every(
      (value) =>
        typeof value === "string" && Number.isFinite(Date.parse(value)),
    )
  )
    throw new Error("Invalid native file metadata.");
  return { file: metadata as SuiteFile, hash: hash.digest("hex") };
}
