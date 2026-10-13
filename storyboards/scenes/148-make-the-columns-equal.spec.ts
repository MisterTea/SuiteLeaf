import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { createFile, serializeFile, type JsonNode } from "@suiteleaf/core";
import { beat, caption, expect, test } from "./harness";
import type { Locator } from "@playwright/test";

const cell = (
  type: string,
  text: string,
  colspan: number,
  colwidth: number[],
): JsonNode => ({
  type,
  attrs: { colspan, rowspan: 1, colwidth },
  content: [
    text
      ? { type: "paragraph", content: [{ type: "text", text }] }
      : { type: "paragraph" },
  ],
});
const row = (cells: JsonNode[]): JsonNode => ({
  type: "tableRow",
  content: cells,
});

async function columnPixels(table: Locator) {
  return table
    .locator("col")
    .evaluateAll((cols) =>
      cols.map((col) => Number.parseFloat((col as HTMLElement).style.width)),
    );
}

test("148-make-the-columns-equal", async ({ page }) => {
  const file = createFile("doc", "October market");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          row([cell("tableCell", "October market", 2, [400, 200])]),
          row([
            cell("tableHeader", "Item", 1, [400]),
            cell("tableHeader", "Amount", 1, [200]),
          ]),
          row([
            cell("tableCell", "Pears", 1, [400]),
            cell("tableCell", "4", 1, [200]),
          ]),
          row([
            cell("tableCell", "Apples", 1, [400]),
            cell("tableCell", "2", 1, [200]),
          ]),
        ],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Buy these Saturday." }],
      },
    ],
  };
  await page.goto("/");
  await expect(page.getByLabel("Search files")).toBeVisible();
  await page.evaluate(
    async ({ id, title, updatedAt, native }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("SuiteLeaf");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("encoded", "readwrite");
          tx.objectStore("encoded").put({ id, title, updatedAt, native });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      });
    },
    {
      id: file.id,
      title: file.title,
      updatedAt: file.updatedAt,
      native: serializeFile(file),
    },
  );
  await page.reload();

  await caption(
    page,
    "Nia’s shopping table. Item is about twice as wide as Amount. The title already spans both.",
  );
  await page.getByRole("link", { name: "October market", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  const table = editor.locator("table");
  const rows = table.locator("tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0).locator("td")).toHaveCount(1);
  await expect(rows.nth(0).locator("td")).toHaveAttribute("colspan", "2");
  await expect(rows.nth(0).locator("td")).toHaveText("October market");
  await expect(rows.nth(1).locator("th")).toHaveText(["Item", "Amount"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["Pears", "4"]);
  await expect(rows.nth(3).locator("td")).toHaveText(["Apples", "2"]);
  await expect(editor.getByText("Buy these Saturday.")).toBeVisible();
  await expect(table.getByText("Buy these Saturday.")).toHaveCount(0);
  await table.scrollIntoViewIfNeeded();
  const before = await columnPixels(table);
  const beforeTable = await table.boundingBox();
  expect(before).toEqual([400, 200]);
  expect(before[0]).toBeGreaterThan((before[1] ?? 0) * 1.8);
  await beat(page, 1400);

  await caption(
    page,
    "The caret is in the table. Equal columns is on the table menu. One click, no dialog.",
  );
  await table.getByRole("cell", { name: "Pears", exact: true }).click();
  await beat(page, 400);
  await table
    .getByRole("cell", { name: "Pears", exact: true })
    .click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Table options" });
  const equal = menu.getByRole("menuitem", {
    name: "Equal columns",
    exact: true,
  });
  await expect(equal).toBeVisible();
  await expect(equal).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await equal.scrollIntoViewIfNeeded();
  await equal.hover();
  await beat(page, 1600);
  await equal.click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rows.nth(0).locator("td")).toHaveCount(1);
  await expect(rows.nth(0).locator("td")).toHaveAttribute("colspan", "2");
  await expect(rows.nth(0).locator("td")).toHaveText("October market");
  await expect(rows.nth(1).locator("th")).toHaveText(["Item", "Amount"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["Pears", "4"]);
  await expect(rows.nth(3).locator("td")).toHaveText(["Apples", "2"]);
  await expect(editor.getByText("Buy these Saturday.")).toBeVisible();
  const equalWidths = await columnPixels(table);
  const equalTable = await table.boundingBox();
  expect(equalWidths).toEqual([300, 300]);
  expect(equalWidths[0]).toBe(equalWidths[1]);
  expect(
    Math.abs((equalTable?.width ?? 0) - (beforeTable?.width ?? 0)),
  ).toBeLessThan(2);
  const itemBox = await rows.nth(1).locator("th").nth(0).boundingBox();
  const amountBox = await rows.nth(1).locator("th").nth(1).boundingBox();
  const titleBox = await rows.nth(0).locator("td").boundingBox();
  expect(itemBox && amountBox && titleBox).toBeTruthy();
  expect(
    Math.abs((itemBox?.width ?? 0) - (amountBox?.width ?? 0)),
  ).toBeLessThan(3);
  expect(
    Math.abs(
      (titleBox?.width ?? 0) -
        ((itemBox?.width ?? 0) + (amountBox?.width ?? 0)),
    ),
  ).toBeLessThan(4);
  await caption(
    page,
    "Item and Amount are the same width. The title still spans both. The words and the sentence stay.",
    1800,
  );

  await caption(
    page,
    "She sorts by Item. The columns stay equal. The header and the spanned title stay.",
  );
  await table.getByRole("cell", { name: "Pears", exact: true }).click();
  await beat(page, 300);
  await table
    .getByRole("cell", { name: "Pears", exact: true })
    .click({ button: "right" });
  const sortItem = menu.getByRole("menuitem", {
    name: "Sort Item A to Z",
    exact: true,
  });
  await expect(sortItem).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await sortItem.scrollIntoViewIfNeeded();
  await sortItem.hover();
  await beat(page, 1400);
  await sortItem.click();
  await expect(menu).toBeHidden();
  await expect(rows.nth(0).locator("td")).toHaveCount(1);
  await expect(rows.nth(0).locator("td")).toHaveAttribute("colspan", "2");
  await expect(rows.nth(0).locator("td")).toHaveText("October market");
  await expect(rows.nth(1).locator("th")).toHaveText(["Item", "Amount"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["Apples", "2"]);
  await expect(rows.nth(3).locator("td")).toHaveText(["Pears", "4"]);
  await expect(editor.getByText("Buy these Saturday.")).toBeVisible();
  await expect(table.getByText("Buy these Saturday.")).toHaveCount(0);
  expect(await columnPixels(table)).toEqual([300, 300]);
  await caption(
    page,
    "Apples 2, then Pears 4. The columns are still the same width, and the title still spans them.",
    1800,
  );

  await expect(page.getByRole("status")).toHaveText(/^Saved/);
  await caption(page, "She saves, goes home, and opens the list again.", 800);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 900);
  await page.getByRole("link", { name: "October market", exact: true }).click();
  await expect(rows.nth(0).locator("td")).toHaveCount(1);
  await expect(rows.nth(0).locator("td")).toHaveAttribute("colspan", "2");
  await expect(rows.nth(0).locator("td")).toHaveText("October market");
  await expect(rows.nth(1).locator("th")).toHaveText(["Item", "Amount"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["Apples", "2"]);
  await expect(rows.nth(3).locator("td")).toHaveText(["Pears", "4"]);
  await expect(editor.getByText("Buy these Saturday.")).toBeVisible();
  await table.scrollIntoViewIfNeeded();
  expect(await columnPixels(table)).toEqual([300, 300]);
  await caption(
    page,
    "Reopened. Item and Amount are still equal, and the title still spans both columns.",
    1800,
  );

  await caption(
    page,
    "Word keeps the two columns the same width, and the title across both.",
    800,
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  await page
    .getByRole("menuitem", { name: "Export DOCX", exact: true })
    .click();
  const zip = await JSZip.loadAsync(
    readFileSync((await (await download).path())!),
  );
  const xml = await zip.file("word/document.xml")!.async("string");
  const tableXml = xml.slice(xml.indexOf("<w:tbl>"), xml.indexOf("</w:tbl>"));
  const grid = [...tableXml.matchAll(/<w:gridCol\b[^>]*\bw:w="(\d+)"/g)].map(
    (match) => Number(match[1]),
  );
  const wordRows = tableXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) ?? [];
  const texts = (rowXml: string) =>
    [...rowXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1]);
  const cells = (rowXml: string) => rowXml.match(/<w:tc[ >]/g) ?? [];
  expect(grid).toEqual([4500, 4500]);
  expect(wordRows).toHaveLength(4);
  expect(cells(wordRows[0]!)).toHaveLength(1);
  expect(wordRows[0]).toContain('<w:gridSpan w:val="2"/>');
  expect(texts(wordRows[0]!)).toEqual(["October market"]);
  expect(wordRows[1]).toContain("<w:tblHeader");
  expect(cells(wordRows[1]!)).toHaveLength(2);
  expect(wordRows[1]).not.toContain('w:val="2"');
  expect(texts(wordRows[1]!)).toEqual(["Item", "Amount"]);
  expect(wordRows.slice(2).map(texts)).toEqual([
    ["Apples", "2"],
    ["Pears", "4"],
  ]);
  await caption(
    page,
    "The Word file has equal columns, and the title still spans both.",
    1800,
  );
});
