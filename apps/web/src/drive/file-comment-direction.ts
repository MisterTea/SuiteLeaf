/** Writing direction for comments beside a file. A form or drawing stays left to right. */

import type { JsonNode } from "@suiteleaf/core";
import { readProofing } from "../editors/doc-word-count";
import { proofingLanguage, proofingTextDirection } from "../editors/proofing-language";

export function fileCommentDirection(file: {
  kind: string;
  content?: unknown;
}): "ltr" | "rtl" {
  if (!file.content || typeof file.content !== "object") return "ltr";
  const content = file.content as { proofingLanguage?: unknown };
  if (file.kind === "sheet" || file.kind === "slide") {
    return proofingTextDirection(proofingLanguage(content.proofingLanguage));
  }
  if (file.kind === "doc") return proofingTextDirection(readProofing(file.content as JsonNode).language);
  return "ltr";
}
