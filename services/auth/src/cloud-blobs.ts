import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  BlobNotFoundError,
  BlobServiceRateLimited,
  del,
  get,
  head,
  list,
  put,
} from "@vercel/blob";

const prefix = "suiteleaf/objects/";
export function acceptsBridgeToken(
  offered: string | undefined,
  expected: string,
): boolean {
  const a = Buffer.from(offered ?? "");
  const b = Buffer.from(`Bearer ${expected}`);
  return (
    expected.length >= 32 && a.length === b.length && timingSafeEqual(a, b)
  );
}

export function blobPath(hash: string): string | null {
  return /^[a-f0-9]{64}$/.test(hash)
    ? `${prefix}${hash.slice(0, 2)}/${hash.slice(2)}`
    : null;
}

async function exists(path: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await head(path);
      return true;
    } catch (error) {
      if (error instanceof BlobNotFoundError) return false;
      if (
        attempt < 2 &&
        (error instanceof BlobServiceRateLimited ||
          (error as { status?: number })?.status === 429)
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1)),
        );
        continue;
      }
      throw error;
    }
  }
  return false;
}

/** This route is loopback-only and never mounted on the public Axum router. */
export async function cloudBlobRequest(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
): Promise<void> {
  res.setHeader("cache-control", "no-store");
  if (!acceptsBridgeToken(req.headers.authorization, token)) {
    res.writeHead(401).end();
    return;
  }
  const hash = new URL(req.url ?? "/", "http://localhost").pathname.slice(
    "/internal/cloud/blobs/".length,
  );
  if (hash === "usage" && req.method === "GET") {
    let cursor: string | undefined;
    let total = 0;
    do {
      const page = await list({ prefix, cursor });
      total += page.blobs.reduce((sum, blob) => sum + blob.size, 0);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(total));
    return;
  }
  const path = blobPath(hash);
  if (!path) {
    res.writeHead(400).end();
    return;
  }
  if (req.method === "GET") {
    const result = await get(path, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("content-type", "application/octet-stream");
    await pipeline(
      Readable.fromWeb(
        result.stream as import("node:stream/web").ReadableStream,
      ),
      res,
    );
    return;
  }
  if (req.method === "HEAD") {
    res.writeHead((await exists(path)) ? 200 : 404).end();
    return;
  }
  if (req.method === "PUT") {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    if (!(await exists(path))) {
      let lastError: unknown;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await put(path, Buffer.concat(chunks), {
            access: "private",
            addRandomSuffix: false,
            allowOverwrite: false,
            contentType: "application/octet-stream",
          });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          if (await exists(path)) {
            lastError = null;
            break;
          }
          if (attempt < 3) {
            const delay =
              error instanceof BlobServiceRateLimited ||
              (error as { status?: number })?.status === 429
                ? 1500 * (attempt + 1)
                : 400 * (attempt + 1);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
      if (lastError) throw lastError;
    }
    res.writeHead(204).end();
    return;
  }
  if (req.method === "DELETE") {
    await del(path);
    res.writeHead(204).end();
    return;
  }
  res.writeHead(405).end();
}
