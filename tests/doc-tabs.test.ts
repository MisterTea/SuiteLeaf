import { describe, expect, it } from "vitest";
import {
  createFile,
  parseFile,
  serializeFile,
  type DocFile,
} from "../packages/core/src";

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("document tabs", () => {
  it("parses and serializes a document saved before tabs existed", () => {
    const raw = {
      format: "suiteleaf",
      version: 1,
      id: "old-notes",
      kind: "doc",
      title: "Notes",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      content: { type: "doc", content: [paragraph("Unchanged")] },
    };
    const opened = parseFile(JSON.stringify(raw));
    expect(opened.version).toBe(1);
    expect(opened.kind).toBe("doc");
    if (opened.kind !== "doc") return;
    expect(opened.tabTitle).toBeUndefined();
    expect(opened.tabs).toBeUndefined();
    expect(JSON.stringify(opened.content)).toContain("Unchanged");
    const saved = JSON.parse(serializeFile(opened)) as DocFile & {
      tabTitle?: string;
      tabs?: unknown;
    };
    expect(saved.version).toBe(1);
    expect(saved).not.toHaveProperty("tabTitle");
    expect(saved).not.toHaveProperty("tabs");
    expect(JSON.stringify(saved.content)).toContain("Unchanged");
  });

  it("round-trips two tabs and keeps the first tab's text in content", () => {
    const file = createFile("doc", "October meeting") as DocFile;
    file.tabTitle = "Agenda";
    file.content = {
      type: "doc",
      content: [paragraph("Call to order. Treasurer's report.")],
    };
    file.tabs = [
      {
        id: "minutes",
        title: "Minutes",
        content: {
          type: "doc",
          content: [paragraph("Voted to buy compost.")],
        },
      },
    ];
    const again = parseFile(serializeFile(file));
    expect(again.version).toBe(1);
    if (again.kind !== "doc") throw new Error("expected a document");
    expect(again.tabTitle).toBe("Agenda");
    expect(again.tabs).toEqual(file.tabs);
    expect(JSON.stringify(again.content)).toContain(
      "Call to order. Treasurer's report.",
    );
    expect(JSON.stringify(again.content)).not.toContain("compost");
    expect(JSON.stringify(again.tabs?.[0]?.content)).toContain(
      "Voted to buy compost.",
    );
    expect(JSON.stringify(again)).toContain("Call to order. Treasurer's report.");
    expect(JSON.stringify(again)).toContain("Voted to buy compost.");
  });
});
