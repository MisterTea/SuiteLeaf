/**
 * A review record inside a Word file, as `word/suiteleaf-review.json`.
 * The paragraph text is not written into that part.
 */

import JSZip from "jszip";
import type { JsonNode } from "./index";
import type { StoredReview } from "./review-store";
import { readReview, reviewPayload } from "./review-store";

async function bytesOf(input: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(await input.arrayBuffer());
}

/** The Word download used by the editor. A stored review is added to the file. */
export async function exportReviewedDocx(file: {
  title: string;
  content: JsonNode;
  sections?: { title?: string; content: JsonNode }[];
}): Promise<Uint8Array> {
  const { exportDocx } = await import("./docx-export");
  const bytes = await exportDocx(file);
  const review = readReview(file.content);
  if ("reason" in review) return bytes;
  return stampReview(bytes, review);
}

/** Add the review part. The bytes passed in are not changed. */
export async function stampReview(input: Blob | ArrayBuffer | Uint8Array, review: StoredReview): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await bytesOf(input));
  zip.file("word/suiteleaf-review.json", JSON.stringify(reviewPayload(review)));
  return zip.generateAsync({ type: "uint8array" });
}

/** The review part, or null when the file has none or it cannot be read. */
export async function reviewFromDocx(input: Blob | ArrayBuffer | Uint8Array): Promise<StoredReview | null> {
  const zip = await JSZip.loadAsync(await bytesOf(input));
  const part = zip.file("word/suiteleaf-review.json");
  if (!part) return null;
  try {
    const parsed: unknown = JSON.parse(await part.async("string"));
    const read = readReview({ type: "doc", attrs: { review: parsed } });
    return "reason" in read ? null : read;
  } catch {
    return null;
  }
}
