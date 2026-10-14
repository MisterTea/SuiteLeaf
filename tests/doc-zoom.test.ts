import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { createFile, type JsonNode } from "@suiteleaf/core";
import { exportDocx } from "@suiteleaf/core/docx-export";
import {
  attachDocumentZoom,
  documentZoom,
  rememberDocumentZoom,
} from "../apps/web/src/editors/doc-zoom";

function paragraph(text: string): JsonNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function texts(node: JsonNode): string[] {
  const own =
    node.type === "text" && typeof node.text === "string" ? [node.text] : [];
  return [...own, ...(node.content ?? []).flatMap(texts)];
}

describe("document zoom", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    // A previous test may have held a zoom for a document with no id.
    rememberDocumentZoom("reset", "100%");
    store.clear();
  });

  it("keeps 150% on file A and leaves file B at the default", () => {
    expect(documentZoom("file-a", 1280)).toBe("100%");
    expect(documentZoom("file-b", 640)).toBe("Fit");

    rememberDocumentZoom("file-a", "150%");

    expect(documentZoom("file-a", 1280)).toBe("150%");
    expect(documentZoom("file-a", 640)).toBe("150%");
    expect(documentZoom("file-b", 1280)).toBe("100%");
    expect(documentZoom("file-b", 640)).toBe("Fit");

    rememberDocumentZoom("file-b", "Fit");
    expect(documentZoom("file-b", 1280)).toBe("Fit");
    expect(documentZoom("file-a", 1280)).toBe("150%");
  });

  it("holds zoom in memory until an unsaved document receives an id", () => {
    rememberDocumentZoom("", "150%");
    expect(documentZoom("", 1280)).toBe("150%");
    expect(documentZoom("file-b", 1280)).toBe("100%");

    attachDocumentZoom("file-a");

    expect(documentZoom("file-a", 1280)).toBe("150%");
    expect(documentZoom("file-b", 1280)).toBe("100%");
    expect(documentZoom("", 1280)).toBe("100%");
  });

  it("does not write 150% into a document paragraph or the Word file", async () => {
    const file = createFile("doc", "Market minutes");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      content: [paragraph("Apples were four dollars.")],
    };
    const before = JSON.stringify(file);

    rememberDocumentZoom(file.id, "150%");

    expect(JSON.stringify(file)).toBe(before);
    expect(texts(file.content)).toEqual(["Apples were four dollars."]);
    expect(before).not.toContain("150%");
    expect(documentZoom(file.id, 1280)).toBe("150%");

    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("Apples were four dollars.");
    expect(xml).not.toContain("150%");
  });
});
