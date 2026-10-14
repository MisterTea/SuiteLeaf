import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { DOMSerializer, Node, Schema } from "@tiptap/pm/model";
import { createFile, type JsonNode } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  linkedChartDom,
  linkedChartHtml,
  missingSpreadsheetText,
} from "../packages/core/src/linked-chart";
import { documentPlainText } from "../apps/web/src/editors/doc-text";

const paragraph = (value: string): JsonNode => ({
  type: "paragraph",
  content: [{ type: "text", text: value }],
});

const fees = {
  sourceId: "plot-fees",
  sourceTitle: "Plot fees",
  labels: ["Dues", "Compost"],
  values: [40, 15],
  missing: false,
};

function chartNode(missing = false): JsonNode {
  return {
    type: "linkedChart",
    attrs: { ...fees, values: [...fees.values], missing },
  };
}

function minutes(withChart: boolean, missing = false) {
  const file = createFile("doc", "October meeting");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: withChart
      ? [paragraph("October meeting"), chartNode(missing)]
      : [paragraph("October meeting")],
  };
  return file;
}

async function wordText(file: ReturnType<typeof minutes>) {
  const zip = await JSZip.loadAsync(await exportDocx(file));
  const xml = await zip.file("word/document.xml")!.async("string");
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((match) =>
    match[1]
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">"),
  );
}

describe("linked chart export", () => {
  it("writes each bar and the source name as plain text, and a document without a chart gains no From line", () => {
    const plain = documentPlainText({
      type: "doc",
      content: [paragraph("October meeting"), chartNode()],
    });
    expect(plain).toContain("October meeting");
    expect(plain.indexOf("From Plot fees")).toBeGreaterThan(
      plain.indexOf("October meeting"),
    );
    expect(plain.indexOf("Dues\t40")).toBeGreaterThan(
      plain.indexOf("From Plot fees"),
    );
    expect(plain.indexOf("Compost\t15")).toBeGreaterThan(plain.indexOf("Dues\t40"));
    expect(plain).not.toContain(missingSpreadsheetText);

    const bare = documentPlainText({
      type: "doc",
      content: [paragraph("October meeting")],
    });
    expect(bare).toBe("\ufeffOctober meeting");
    expect(bare).not.toContain("From");
  });

  it("keeps the last bars and the missing sentence in plain text", () => {
    const plain = documentPlainText({
      type: "doc",
      content: [chartNode(true)],
    });
    expect(plain).toContain("From Plot fees");
    expect(plain).toContain("Dues\t40");
    expect(plain).toContain("Compost\t15");
    expect(plain).toContain(missingSpreadsheetText);
  });

  it("writes the same words as HTML table cells", () => {
    const html = linkedChartHtml(fees);
    expect(html).toContain(">From Plot fees<");
    expect(html).toContain(">Dues<");
    expect(html).toContain(">40<");
    expect(html).toContain(">Compost<");
    expect(html).toContain(">15<");
    expect(html).toContain("<table");
    expect(html).not.toContain(missingSpreadsheetText);

    const missing = linkedChartHtml({ ...fees, missing: true });
    expect(missing).toContain(">Dues<");
    expect(missing).toContain(">40<");
    expect(missing).toContain(">Compost<");
    expect(missing).toContain(">15<");
    expect(missing).toContain(`>${missingSpreadsheetText}<`);

    const { window } = new JSDOM("<!doctype html><body></body>");
    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: {
          group: "block",
          content: "inline*",
          toDOM: () => ["p", 0],
        },
        text: { group: "inline" },
        linkedChart: {
          group: "block",
          atom: true,
          attrs: {
            sourceId: { default: "" },
            sourceTitle: { default: "" },
            labels: { default: null },
            values: { default: null },
            missing: { default: false },
          },
          toDOM: (node) => linkedChartDom(node.attrs),
        },
      },
    });
    const holder = window.document.createElement("div");
    holder.appendChild(
      DOMSerializer.fromSchema(schema).serializeFragment(
        Node.fromJSON(schema, {
          type: "doc",
          content: [chartNode()],
        }).content,
        { document: window.document },
      ),
    );
    expect(holder.textContent).toContain("From Plot fees");
    expect(holder.textContent).toContain("Dues");
    expect(holder.textContent).toContain("40");
    expect(holder.textContent).toContain("Compost");
    expect(holder.textContent).toContain("15");
    expect(holder.querySelector("table")).toBeTruthy();
  });

  it("puts the fees in word/document.xml as text and leaves a chartless document without them", async () => {
    const withChart = minutes(true);
    const before = JSON.stringify(withChart);
    const texts = await wordText(withChart);
    expect(JSON.stringify(withChart)).toBe(before);
    expect(texts).toContain("October meeting");
    expect(texts).toContain("From Plot fees");
    expect(texts).toContain("Dues");
    expect(texts).toContain("40");
    expect(texts).toContain("Compost");
    expect(texts).toContain("15");
    expect(texts.indexOf("From Plot fees")).toBeLessThan(texts.indexOf("Dues"));
    expect(texts.indexOf("Dues")).toBeLessThan(texts.indexOf("40"));
    expect(texts.indexOf("40")).toBeLessThan(texts.indexOf("Compost"));
    expect(texts.indexOf("Compost")).toBeLessThan(texts.indexOf("15"));

    const gone = minutes(true, true);
    const missingTexts = await wordText(gone);
    expect(missingTexts).toContain("40");
    expect(missingTexts).toContain("15");
    expect(missingTexts).toContain(missingSpreadsheetText);

    const bare = await wordText(minutes(false));
    expect(bare).toContain("October meeting");
    expect(bare.join("\n")).not.toContain("From");
    expect(bare).not.toContain("Dues");
    expect(bare).not.toContain("40");
    expect(bare).not.toContain("Compost");
    expect(bare).not.toContain("15");
  });
});
