import { describe, expect, it } from "vitest";
import { createFile, type DocFile, type JsonNode } from "@suiteleaf/core";
import { historyPreviewFor } from "../apps/web/src/editors/version-compare";

function body(paragraphs: string[]): JsonNode {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
}

function docFile(options: {
  tabTitle?: string;
  paragraphs: string[];
  tabs?: { id: string; title: string; paragraphs: string[] }[];
}): DocFile {
  const file = createFile("doc", "October meeting");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = body(options.paragraphs);
  if (options.tabTitle) file.tabTitle = options.tabTitle;
  if (options.tabs?.length) {
    file.tabs = options.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      content: body(tab.paragraphs),
    }));
  }
  return file;
}

const agenda = "Call to order. Treasurer's report.";

describe("historyPreviewFor document tabs", () => {
  it("reports a paragraph change that exists only on a later tab", () => {
    const before = docFile({
      tabTitle: "Agenda",
      paragraphs: [agenda],
      tabs: [{ id: "minutes", title: "Minutes", paragraphs: ["Voted to buy compost."] }],
    });
    const after = docFile({
      tabTitle: "Agenda",
      paragraphs: [agenda],
      tabs: [{ id: "minutes", title: "Minutes", paragraphs: ["Voted to buy mulch."] }],
    });
    const result = historyPreviewFor(before, after, "current");
    expect(result).not.toBeNull();
    expect(result!.count).toBe(1);
    expect(result!.unit).toBe("paragraph");
    expect(result!.summary).toBe("1 paragraph changes on Minutes");
    expect(result!.summary).not.toContain("Agenda");
    expect(result!.preview.kind).toBe("doc");
    if (result!.preview.kind !== "doc") return;
    const minutes = result!.preview.tabs?.find((tab) => tab.title === "Minutes");
    const agendaTab = result!.preview.tabs?.find((tab) => tab.title === "Agenda");
    expect(minutes?.status).toBe("changed");
    expect(minutes?.changedParagraphs).toBe(1);
    const minutesText = JSON.stringify(minutes?.content);
    expect(minutesText).toContain("compost");
    expect(minutesText).toContain("mulch");
    expect(minutesText).toContain('"type":"strike"');
    expect(minutesText).toContain('"type":"underline"');
    expect(agendaTab?.status).toBe("same");
    expect(agendaTab?.changedParagraphs).toBe(0);
    const agendaText = JSON.stringify(agendaTab?.content);
    expect(agendaText).not.toContain("strike");
    expect(agendaText).not.toContain("compost");
    expect(agendaText).toContain(agenda);
  });

  it("names every tab that changed", () => {
    const before = docFile({
      tabTitle: "Agenda",
      paragraphs: [agenda],
      tabs: [{ id: "minutes", title: "Minutes", paragraphs: ["Voted to buy compost."] }],
    });
    const after = docFile({
      tabTitle: "Agenda",
      paragraphs: ["Call to order. Bring the map."],
      tabs: [{ id: "minutes", title: "Minutes", paragraphs: ["Voted to buy mulch."] }],
    });
    const result = historyPreviewFor(before, after, "current");
    expect(result!.count).toBe(2);
    expect(result!.summary).toBe("2 paragraphs change on Agenda and Minutes");
  });

  it("marks a tab that exists only on one side", () => {
    const before = docFile({
      tabTitle: "Agenda",
      paragraphs: [agenda],
      tabs: [
        { id: "minutes", title: "Minutes", paragraphs: ["Voted to buy compost."] },
        { id: "notes", title: "Notes", paragraphs: ["Bring gloves."] },
      ],
    });
    const after = docFile({
      tabTitle: "Agenda",
      paragraphs: [agenda],
      tabs: [
        { id: "minutes", title: "Minutes", paragraphs: ["Voted to buy compost."] },
        { id: "follow", title: "Follow-up", paragraphs: ["Email the nursery."] },
      ],
    });
    const result = historyPreviewFor(before, after, "current");
    expect(result!.preview.kind).toBe("doc");
    if (result!.preview.kind !== "doc") return;
    expect(result!.preview.tabs?.find((tab) => tab.title === "Follow-up")?.status).toBe("added");
    expect(result!.preview.tabs?.find((tab) => tab.title === "Notes")?.status).toBe("removed");
    expect(result!.summary).toContain("Follow-up");
    expect(result!.summary).toContain("Notes");
    expect(result!.summary).not.toContain("Agenda");
    expect(result!.count).toBeGreaterThan(0);
  });

  it("still reports the first-tab diff for a document with no extra tabs", () => {
    const before = docFile({ paragraphs: ["Hiring is paused."] });
    const after = docFile({ paragraphs: ["Hiring is open."] });
    const result = historyPreviewFor(before, after, "current");
    expect(result).not.toBeNull();
    expect(result!.count).toBe(1);
    expect(result!.summary).toBe("");
    expect(result!.preview.kind).toBe("doc");
    if (result!.preview.kind !== "doc") return;
    expect(result!.preview.tabs).toBeUndefined();
    const text = JSON.stringify(result!.preview.content);
    expect(text).toContain("paused");
    expect(text).toContain("open");
    expect(text).toContain('"type":"strike"');
    expect(text).toContain('"type":"underline"');
  });
});
