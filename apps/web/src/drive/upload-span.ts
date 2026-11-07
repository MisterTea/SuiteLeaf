import {
  mimeFor,
  nativeFilename,
  serializeFile,
  type DriveLink,
  type SuiteFile,
} from "@suiteleaf/core";
import { contentRangeHeader, sendUploadSpans } from "../upload-queue";
import { DriveConflict, api, drive, type DriveItem } from "../node-client";

/** Send one slice. A finished file is renamed like a full upload. An unfinished slice is not a version. */
export async function uploadDriveSpan(
  file: SuiteFile,
  link: DriveLink,
  start: number,
  end: number,
  body = new TextEncoder().encode(serializeFile(file)),
): Promise<{ done: false; accepted: number } | { done: true; link: DriveLink; accepted: number }> {
  // Ranges count UTF-8 bytes, as the server does, not string characters.
  const range = contentRangeHeader(start, end, body.length);
  if (!range || end > body.length || (body.length > 0 && start >= end)) {
    throw new Error("That upload does not continue the saved part.");
  }
  const headers: Record<string, string> = {
    "content-type": mimeFor(file.kind),
    "content-range": range,
  };
  if (link.versionId) headers["if-match"] = `"${link.versionId}"`;
  const response = await api(`/api/drive/items/${encodeURIComponent(link.itemId)}/content`, {
    method: "PUT",
    headers,
    body: body.subarray(start, end),
  });
  if (response.status === 202) {
    const result = (await response.json()) as { accepted?: unknown };
    if (typeof result.accepted !== "number" || !Number.isInteger(result.accepted)) {
      throw new Error("That upload does not continue the saved part.");
    }
    return { done: false, accepted: result.accepted };
  }
  const result = await response.json();
  if (response.status === 409) throw new DriveConflict(result.item);
  let item = result as DriveItem;
  const name = nativeFilename(file);
  if (item.name !== name) item = await drive.update(link.itemId, { name });
  return {
    done: true,
    accepted: body.length,
    link: {
      ...link,
      versionId: item.headVersionId ?? undefined,
      syncedAt: file.updatedAt,
      name: item.name,
    },
  };
}

/** Upload a new file in bounded requests, including imports on hosted servers. */
export async function uploadDriveChunks(file: SuiteFile, link: DriveLink, onProgress?: (accepted: number, total: number) => void): Promise<DriveLink> {
  const body = new TextEncoder().encode(serializeFile(file));
  onProgress?.(0, body.length);
  let saved: DriveLink | undefined;
  const result = await sendUploadSpans({
    bytes: body.length,
    sent: 0,
    upload: async ({ start, end }) => {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const result = await uploadDriveSpan(file, link, start, end, body);
          onProgress?.(result.accepted, body.length);
          if (result.done) saved = result.link;
          return result;
        } catch (err) {
          lastErr = err;
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          }
        }
      }
      throw lastErr;
    },
  });
  if (!result.done || !saved) throw new Error("That upload does not continue the saved part.");
  return saved;
}
