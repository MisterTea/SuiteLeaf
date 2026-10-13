import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import { parseFile, serializeFile } from "../packages/core/src";
import { builtins } from "../apps/web/src/templates/builtin";
import { previewGrid } from "../apps/web/src/templates/formulas";
import { suggestTemplateName, instantiate } from "../apps/web/src/templates/model";
import { TemplateStore } from "../apps/web/src/templates/store";
import type { SheetFile } from "../packages/core/src";

function sheetOf(file: SheetFile) {
  return file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
}
function texts(file: SheetFile) {
  return previewGrid(sheetOf(file).cellData as never)
    .flat()
    .map((cell) => cell.text);
}

it("ships at least two templates for documents, spreadsheets, and slides", () => {
  const counts = { doc: 0, sheet: 0, slide: 0 };
  for (const template of builtins) {
    counts[template.kind]++;
    const file = template.create();
    expect(parseFile(serializeFile(file)).title).toBe(template.name);
  }
  expect(counts).toEqual({ doc: 2, sheet: 3, slide: 2 });
});

it("shows a blank invoice total of $0.00 and recalculates when quantities change", () => {
  const invoice = builtins.find((template) => template.id === "invoice")!;
  const blank = invoice.create() as SheetFile;
  expect(texts(blank)).toContain("Total");
  expect(texts(blank)).toContain("$0.00");
  expect(texts(blank).filter((text) => text === "$0.00")).toEqual(["$0.00"]);

  const filled = invoice.create() as SheetFile;
  const cells = sheetOf(filled).cellData!;
  cells[5][0] = { v: "Sourdough", t: 1 };
  cells[5][1] = { v: 24, t: 2 };
  cells[5][2] = { v: 6.5, t: 2 };
  cells[6][0] = { v: "Rye", t: 1 };
  cells[6][1] = { v: 12, t: 2 };
  cells[6][2] = { v: 7, t: 2 };
  const shown = texts(filled);
  expect(shown).toContain("$156.00");
  expect(shown).toContain("$84.00");
  expect(shown).toContain("$240.00");
});

it("suggests a reusable name without the month", () => {
  expect(suggestTemplateName("Invoice · Café Lune · October")).toBe(
    "Invoice · Café Lune",
  );
  expect(suggestTemplateName("Invoice · October 2026")).toBe("Invoice");
  expect(suggestTemplateName("Meeting notes")).toBe("Meeting notes");
});

it("keeps a saved template independent of the file it came from", async () => {
  const db = new TemplateStore("templates-" + crypto.randomUUID());
  try {
    const original = builtins.find((template) => template.id === "invoice")!.create();
    const row = await db.save("Bakery invoice", original);
    if (original.kind === "sheet") {
      const cells =
        original.content.workbook.sheets[original.content.workbook.sheetOrder[0]]
          .cellData!;
      cells[1][1] = { v: "Changed after saving", t: 1 };
    }
    const stored = parseFile((await db.templates.get(row.id))!.native);
    expect(stored.title).toBe("Bakery invoice");
    expect(serializeFile(stored)).not.toBe(serializeFile(original));
    await db.rename(row.id, "Monthly bakery invoice");
    expect((await db.templates.get(row.id))?.name).toBe("Monthly bakery invoice");
    const fileId = original.id;
    await db.remove(row.id);
    expect(await db.templates.get(row.id)).toBeUndefined();
    expect(original.id).toBe(fileId);
  } finally {
    await db.delete();
  }
});

it("opens a new file from a template without reusing the template id", () => {
  const entry = {
    info: {
      id: "invoice",
      name: "Invoice",
      kind: "sheet" as const,
      source: "builtin" as const,
      description: "",
    },
    file: builtins.find((template) => template.id === "invoice")!.create(),
  };
  const copy = instantiate(entry);
  expect(copy.id).not.toBe(entry.file.id);
  expect(copy.title).toBe("Invoice");
  expect(copy.kind).toBe("sheet");
});
