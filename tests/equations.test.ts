import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, type JsonNode } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  EQUATION_LAYOUT_UNSUPPORTED,
  parseLinear,
  plainOf,
  replaceSlot,
} from "../packages/core/src/equations";
import { importOffice } from "../packages/core/src/office";
import { documentText } from "../packages/core/src/word";
import { equationDocx } from "./office-fixtures";

function nodes(n: JsonNode): JsonNode[] {
  return [n, ...(n.content ?? []).flatMap(nodes)];
}

function equations(doc: JsonNode) {
  return nodes(doc).filter((node) => node.type === "equation");
}

const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';

async function fractionDocx() {
  const z = new JSZip();
  z.file(
    "[Content_Types].xml",
    `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  z.file(
    "_rels/.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  z.file(
    "word/document.xml",
    `${xmlHeader}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p><w:r><w:t xml:space="preserve">The ratio </w:t></w:r><m:oMath><m:f><m:num><m:r><m:t>a+b</m:t></m:r></m:num><m:den><m:r><m:t>c</m:t></m:r></m:den></m:f></m:oMath><w:r><w:t xml:space="preserve"> stays.</w:t></w:r></w:p></w:body></w:document>`,
  );
  return z.generateAsync({ type: "uint8array" });
}

describe("equations", () => {
  it("parses a power and a stacked fraction", () => {
    expect(parseLinear("x^2")).toEqual({
      kind: "sup",
      base: { kind: "text", text: "x" },
      exp: { kind: "text", text: "2" },
    });
    expect(parseLinear("(a+b)/c")).toEqual({
      kind: "frac",
      num: {
        kind: "row",
        items: [
          { kind: "text", text: "a" },
          { kind: "text", text: "+" },
          { kind: "text", text: "b" },
        ],
      },
      den: { kind: "text", text: "c" },
    });
    expect(parseLinear("x^")).toBeNull();
    expect(parseLinear("")).toBeNull();
  });

  it("changes one symbol without rewriting the rest", () => {
    const fraction = parseLinear("(a+b)/c");
    if (!fraction) throw new Error("expected a fraction");
    const edited = replaceSlot(fraction, 3, "d");
    expect(edited).toMatchObject({ den: { kind: "text", text: "d" } });
    expect(plainOf(edited!)).toBe("a+bd");
    expect(JSON.stringify(edited).includes('"text":"a"')).toBe(true);
  });

  it("imports a Word equation as editable math and skips the unsupported note", async () => {
    const { file, report } = await importOffice(
      await equationDocx(),
      "docx",
      "Variance note.docx",
    );
    expect(file.kind).toBe("doc");
    if (file.kind !== "doc") return;
    expect(report.warnings).not.toContain(EQUATION_LAYOUT_UNSUPPORTED);
    expect(report.textPreserved).toBe(true);
    expect(report.stats.recoveredParagraphs).toBe(0);
    expect(documentText(file.content)).toContain("The sample variance uses n2.");
    expect(equations(file.content)).toEqual([
      {
        type: "equation",
        attrs: {
          plain: "n2",
          expr: {
            kind: "sup",
            base: { kind: "text", text: "n" },
            exp: { kind: "text", text: "2" },
          },
        },
      },
    ]);
  });

  it("imports a stacked Office fraction", async () => {
    const { file, report } = await importOffice(
      await fractionDocx(),
      "docx",
      "Ratio.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    expect(report.warnings).not.toContain(EQUATION_LAYOUT_UNSUPPORTED);
    expect(equations(file.content)[0]?.attrs?.expr).toEqual({
      kind: "frac",
      num: { kind: "text", text: "a+b" },
      den: { kind: "text", text: "c" },
    });
  });

  it("writes Office math on export and reads it back", async () => {
    const square = parseLinear("x^2");
    const fraction = parseLinear("(a+b)/c");
    const file = createFile("doc", "Methods");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "The model fits " },
            { type: "equation", attrs: { expr: square, plain: plainOf(square!) } },
            { type: "text", text: " and the ratio " },
            {
              type: "equation",
              attrs: { expr: fraction, plain: plainOf(fraction!) },
            },
            { type: "text", text: "." },
          ],
        },
      ],
    };
    const bytes = await exportDocx(file);
    const xml = await (await JSZip.loadAsync(bytes))
      .file("word/document.xml")!
      .async("string");
    expect(xml).toContain("<m:oMath");
    expect(xml).toContain("<m:sSup");
    expect(xml).toContain("<m:f");
    expect(xml).not.toContain("<w:drawing");
    const imported = await importOffice(bytes, "docx", "Methods.docx");
    if (imported.file.kind !== "doc") throw new Error("expected a document");
    expect(imported.report.warnings).not.toContain(EQUATION_LAYOUT_UNSUPPORTED);
    const back = equations(imported.file.content);
    expect(back.map((node) => node.attrs?.expr)).toEqual([square, fraction]);
  });
});
