import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parser } from "stream-json";
import { filter } from "stream-json/filters/filter.js";
import {
  NATIVE_FILE_LIMIT,
  isSuitePackageBytes,
  kindFromName,
  readZipCentralDirectory,
  readZipEntry,
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
  // Fast check for v2 ZIP packages (.slslides, .slsheet, .sldoc)
  const info = await stat(path);
  if (info.size > NATIVE_FILE_LIMIT) {
    throw new Error("Native file is too large.");
  }
  if (info.size >= 4) {
    const handle = await open(path, "r");
    try {
      const magic = Buffer.allocUnsafe(4);
      await handle.read(magic, 0, 4, 0);
      if (isSuitePackageBytes(magic)) {
        const readRange = async (offset: number, length: number) => {
          const buf = Buffer.allocUnsafe(length);
          const { bytesRead } = await handle.read(buf, 0, length, offset);
          return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
        };
        const cd = await readZipCentralDirectory(info.size, readRange);
        const manifestEntry = cd.get("manifest.json");
        if (!manifestEntry) {
          throw new Error("SuiteLeaf package is missing manifest.json.");
        }
        const manifestBytes = await readZipEntry(manifestEntry, readRange);
        const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Record<
          string,
          unknown
        >;
        const expected = kindFromName(path);
        if (
          manifest.format !== "suiteleaf" ||
          manifest.version !== 2 ||
          typeof manifest.id !== "string" ||
          !manifest.id ||
          typeof manifest.title !== "string" ||
          !manifest.title ||
          manifest.title.length > 200 ||
          !["doc", "sheet", "slide"].includes(String(manifest.kind)) ||
          (expected && manifest.kind !== expected) ||
          typeof manifest.createdAt !== "string" ||
          typeof manifest.updatedAt !== "string"
        ) {
          throw new Error("Invalid native package manifest.");
        }
        const hash = createHash("sha256");
        await pipeline(
          createReadStream(path),
          new Writable({
            write(chunk: Buffer, _enc, done) {
              hash.update(chunk);
              done();
            },
          }),
        );
        return {
          file: {
            format: "suiteleaf",
            version: 1,
            id: manifest.id,
            title: manifest.title,
            kind: manifest.kind,
            createdAt: manifest.createdAt,
            updatedAt: manifest.updatedAt,
          } as unknown as SuiteFile,
          hash: hash.digest("hex"),
        };
      }
    } finally {
      await handle.close();
    }
  }

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
