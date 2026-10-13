import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { createFile, serializeFile, type JsonNode } from "@suiteleaf/core";
import { beat, caption, expect, test } from "./harness";
import type { Locator, Page } from "@playwright/test";

const cell = (type: string, text: string): JsonNode => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content: [
    text
      ? { type: "paragraph", content: [{ type: "text", text }] }
      : { type: "paragraph" },
  ],
});
const row = (type: string, values: string[]): JsonNode => ({
  type: "tableRow",
  content: values.map((text) => cell(type, text)),
});

async function selectTitleCells(page: Page, table: Locator) {
  const title = table.locator("tr").nth(0).locator("td");
  await title.nth(0).click();
  await title.nth(1).click({ modifiers: ["Shift"] });
  await expect(title).toHaveCount(2);
  await expect(title.nth(0)).toHaveClass(/selectedCell/);
  await expect(title.nth(1)).toHaveClass(/selectedCell/);
}

test("147-merge-the-title-row", async ({ page }) => {
  const file = createFile("doc", "October market");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          row("tableCell", ["October market", ""]),
          row("tableHeader", ["Item", "Amount"]),
          row("tableCell", ["Pears", "4"]),
          row("tableCell", ["Apples", "2"]),
        ],
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
    "Nia’s shopping table. The title is “October market” beside an empty cell.",
  );
  await page.getByRole("link", { name: "October market", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  const table = editor.locator("table");
  const rows = table.locator("tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0).locator("td")).toHaveText(["October market", ""]);
  await expect(rows.nth(1).locator("th")).toHaveText(["Item", "Amount"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["Pears", "4"]);
  await expect(rows.nth(3).locator("td")).toHaveText(["Apples", "2"]);
  await table.scrollIntoViewIfNeeded();
  await beat(page, 1200);

  await caption(
    page,
    "She selects both title cells. The table menu says Merge cells. One click, no dialog.",
  );
  await selectTitleCells(page, table);
  await beat(page, 700);
  await rows.nth(0).locator("td").nth(0).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Table options" });
  const merge = menu.getByRole("menuitem", {
    name: "Merge cells",
    exact: true,
  });
  await expect(merge).toBeVisible();
  await expect(merge).toBeEnabled();
  await expect(
    menu.getByRole("menuitem", { name: "Unmerge", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await merge.scrollIntoViewIfNeeded();
  await merge.hover();
  await beat(page, 1600);
  await merge.click();
  await expect(menu).toBeHidden();
  await expect(rows.nth(0).locator("td")).toHaveCount(1);
  await expect(rows.nth(0).locator("td")).toHaveAttribute("colspan", "2");
  await expect(rows.nth(0).locator("td")).toHaveText("October market");
  await expect(rows.nth(1).locator("th")).toHaveText(["Item", "Amount"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["Pears", "4"]);
  await expect(rows.nth(3).locator("td")).toHaveText(["Apples", "2"]);
  await caption(
    page,
    "“October market” spans both columns. Item, Amount, Pears, and Apples stay in two columns.",
    1800,
  );

  await caption(
    page,
    "The caret is in the title. The same control now says Unmerge.",
  );
  await rows.nth(0).locator("td").click();
  await beat(page, 400);
  await rows.nth(0).locator("td").click({ button: "right" });
  const unmerge = menu.getByRole("menuitem", { name: "Unmerge", exact: true });
  await expect(unmerge).toBeVisible();
  await expect(unmerge).toBeEnabled();
  await expect(
    menu.getByRole("menuitem", { name: "Merge cells", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await unmerge.scrollIntoViewIfNeeded();
  await unmerge.hover();
  await beat(page, 1600);
  await unmerge.click();
  await expect(menu).toBeHidden();
  await expect(rows.nth(0).locator("td")).toHaveCount(2);
  await expect(rows.nth(0).locator("td").nth(0)).toHaveText("October market");
  await expect(rows.nth(0).locator("td").nth(1)).toHaveText("");
  await expect(rows.nth(0).locator("td").nth(0)).not.toHaveAttribute(
    "colspan",
    "2",
  );
  await expect(rows.nth(1).locator("th")).toHaveText(["Item", "Amount"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["Pears", "4"]);
  await expect(rows.nth(3).locator("td")).toHaveText(["Apples", "2"]);
  await caption(
    page,
    "The title is back in the left cell. The right cell is empty. The rows below stay two columns.",
    1800,
  );

  await caption(page, "She merges the title again.");
  await selectTitleCells(page, table);
  await beat(page, 500);
  await rows.nth(0).locator("td").nth(0).click({ button: "right" });
  await expect(merge).toBeVisible();
  await merge.scrollIntoViewIfNeeded();
  await merge.hover();
  await beat(page, 1200);
  await merge.click();
  await expect(rows.nth(0).locator("td")).toHaveCount(1);
  await expect(rows.nth(0).locator("td")).toHaveAttribute("colspan", "2");
  await expect(rows.nth(0).locator("td")).toHaveText("October market");

  await caption(
    page,
    "She sorts Item. The title stays one cell across the top. Only the body moves.",
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
  await expect(table.getByText("October market")).toHaveCount(1);
  await caption(
    page,
    "Apples 2, then Pears 4. The title did not join the list, and each amount stayed with its item.",
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
  await table.scrollIntoViewIfNeeded();
  await caption(
    page,
    "Reopened. The title still spans both columns, and the body is still sorted.",
    1800,
  );

  await caption(
    page,
    "Word keeps the title across two columns, and the header and body as two columns.",
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
  const wordRows = tableXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) ?? [];
  const texts = (rowXml: string) =>
    [...rowXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((match) => match[1]);
  const cells = (rowXml: string) => rowXml.match(/<w:tc[ >]/g) ?? [];
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
  expect(
    wordRows
      .slice(2)
      .map(cells)
      .every((rowCells) => rowCells.length === 2),
  ).toBe(true);
  await caption(
    page,
    "The Word file has the title spanning two columns, then Item and Amount, Apples, and Pears.",
    1800,
  );
});
