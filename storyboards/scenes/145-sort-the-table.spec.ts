import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { createFile, serializeFile, type JsonNode } from "@suiteleaf/core";
import { beat, caption, expect, test } from "./harness";

const cell = (type: string, text: string): JsonNode => ({
  type,
  attrs: { colspan: 1, rowspan: 1, colwidth: null },
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const row = (type: string, values: string[]): JsonNode => ({
  type: "tableRow",
  content: values.map((text) => cell(type, text)),
});

test("145-sort-the-table", async ({ page }) => {
  const file = createFile("doc", "Shopping list");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          row("tableHeader", ["Item", "Amount"]),
          row("tableCell", ["Pears", "4"]),
          row("tableCell", ["Apples", "2"]),
          row("tableCell", ["Figs", "10"]),
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
    "Nia opens her shopping list. Item and Amount are the header.",
  );
  await page.getByRole("link", { name: "Shopping list", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  const table = editor.locator("table");
  const rows = table.locator("tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0).locator("th")).toHaveText(["Item", "Amount"]);
  await expect(rows.nth(1).locator("td")).toHaveText(["Pears", "4"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["Apples", "2"]);
  await expect(rows.nth(3).locator("td")).toHaveText(["Figs", "10"]);
  await expect(editor.getByText("Buy these Saturday.")).toBeVisible();
  await table.scrollIntoViewIfNeeded();
  await beat(page, 1200);

  await caption(
    page,
    "The caret is in Item. Sort names that column, A to Z. One click, no dialog.",
  );
  await table.getByRole("cell", { name: "Pears", exact: true }).click();
  await beat(page, 400);
  await table
    .getByRole("cell", { name: "Pears", exact: true })
    .click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Table options" });
  const sortItem = menu.getByRole("menuitem", {
    name: "Sort Item A to Z",
    exact: true,
  });
  await expect(sortItem).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await sortItem.hover();
  await beat(page, 1600);
  await sortItem.click();
  await expect(menu).toBeHidden();
  await expect(rows.nth(0).locator("th")).toHaveText(["Item", "Amount"]);
  await expect(rows.nth(1).locator("td")).toHaveText(["Apples", "2"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["Figs", "10"]);
  await expect(rows.nth(3).locator("td")).toHaveText(["Pears", "4"]);
  await expect(editor.getByText("Buy these Saturday.")).toBeVisible();
  await expect(table.getByText("Buy these Saturday.")).toHaveCount(0);
  await caption(
    page,
    "The header stays. Apples, Figs, Pears — and the sentence stays after the table.",
    1800,
  );

  await caption(page, "She moves to Amount. Sort says small to large.");
  await table
    .getByRole("cell", { name: "2", exact: true })
    .click({ button: "right" });
  const sortAmount = menu.getByRole("menuitem", {
    name: "Sort Amount small to large",
    exact: true,
  });
  await expect(sortAmount).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await sortAmount.hover();
  await beat(page, 1600);
  await sortAmount.click();
  await expect(rows.nth(0).locator("th")).toHaveText(["Item", "Amount"]);
  await expect(rows.nth(1).locator("td")).toHaveText(["Apples", "2"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["Pears", "4"]);
  await expect(rows.nth(3).locator("td")).toHaveText(["Figs", "10"]);
  await caption(
    page,
    "2, then 4, then 10. Ten stays with Figs. It is not sorted as text.",
    1800,
  );

  await caption(
    page,
    "The next click already says large to small, before the rows flip.",
  );
  await table
    .getByRole("cell", { name: "10", exact: true })
    .click({ button: "right" });
  const sortLarge = menu.getByRole("menuitem", {
    name: "Sort Amount large to small",
    exact: true,
  });
  await expect(sortLarge).toBeVisible();
  await sortLarge.hover();
  await beat(page, 1800);
  await sortLarge.click();
  await expect(rows.nth(0).locator("th")).toHaveText(["Item", "Amount"]);
  await expect(rows.nth(1).locator("td")).toHaveText(["Figs", "10"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["Pears", "4"]);
  await expect(rows.nth(3).locator("td")).toHaveText(["Apples", "2"]);
  await expect(editor.getByText("Buy these Saturday.")).toBeVisible();
  await caption(
    page,
    "Figs 10, Pears 4, Apples 2. The header is still on top.",
    1600,
  );

  await expect(page.getByRole("status")).toHaveText(/^Saved/);
  await caption(page, "She saves, goes home, and opens the list again.", 800);
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await beat(page, 900);
  await page.getByRole("link", { name: "Shopping list", exact: true }).click();
  await expect(rows.nth(0).locator("th")).toHaveText(["Item", "Amount"]);
  await expect(rows.nth(1).locator("td")).toHaveText(["Figs", "10"]);
  await expect(rows.nth(2).locator("td")).toHaveText(["Pears", "4"]);
  await expect(rows.nth(3).locator("td")).toHaveText(["Apples", "2"]);
  await expect(editor.getByText("Buy these Saturday.")).toBeVisible();
  await table.scrollIntoViewIfNeeded();
  await caption(
    page,
    "Reopened. Figs, Pears, Apples — and the header is still the header.",
    1800,
  );

  await caption(
    page,
    "Word keeps that header row, and the same body order.",
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
  expect(wordRows).toHaveLength(4);
  expect(wordRows[0]).toContain("<w:tblHeader");
  expect(texts(wordRows[0])).toEqual(["Item", "Amount"]);
  expect(wordRows.slice(1).map(texts)).toEqual([
    ["Figs", "10"],
    ["Pears", "4"],
    ["Apples", "2"],
  ]);
  expect(xml.indexOf("</w:tbl>")).toBeLessThan(
    xml.indexOf("Buy these Saturday"),
  );
  await caption(
    page,
    "The Word file has the same header and the same order: Figs, Pears, Apples.",
    1800,
  );
});
