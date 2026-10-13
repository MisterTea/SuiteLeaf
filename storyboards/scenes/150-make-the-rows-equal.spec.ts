import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { createFile, serializeFile, type JsonNode } from "@suiteleaf/core";
import { beat, caption, expect, test } from "./harness";
import type { Locator } from "@playwright/test";

const pearsNote =
  "Pears. Keep the ripe ones on the counter until Saturday, then bring a bag to the market.";

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

async function rowPixels(table: Locator) {
  return table
    .locator("tr")
    .evaluateAll((rows) =>
      rows
        .filter((line) => !line.classList.contains("doc-page-spacer"))
        .map((line) => (line as HTMLElement).offsetHeight),
    );
}

test("150-make-the-rows-equal", async ({ page }) => {
  const file = createFile("doc", "October market");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          row([cell("tableCell", "October market", 2, [200, 200])]),
          row([
            cell("tableHeader", "Item", 1, [200]),
            cell("tableHeader", "Amount", 1, [200]),
          ]),
          row([
            cell("tableCell", pearsNote, 1, [200]),
            cell("tableCell", "4", 1, [200]),
          ]),
          row([
            cell("tableCell", "Apples", 1, [200]),
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
    "Nia’s shopping table. The pears note wraps, so that row is taller. The columns are already equal.",
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
  await expect(rows.nth(2).locator("td")).toHaveText([pearsNote, "4"]);
  await expect(rows.nth(3).locator("td")).toHaveText(["Apples", "2"]);
  await expect(editor.getByText("Buy these Saturday.")).toBeVisible();
  await expect(table.getByText("Buy these Saturday.")).toHaveCount(0);
  await table.scrollIntoViewIfNeeded();
  const before = await rowPixels(table);
  expect(before).toHaveLength(4);
  expect(before[2]).toBeGreaterThan((before[0] ?? 0) + 16);
  expect(before[2]).toBeGreaterThan((before[1] ?? 0) + 16);
  expect(before[2]).toBeGreaterThan((before[3] ?? 0) + 16);
  expect(await columnPixels(table)).toEqual([200, 200]);
  const pearsBefore = before[2] ?? 0;
  await beat(page, 1400);

  await caption(
    page,
    "The caret is in the table. Equal rows is on the table menu. One click, no dialog.",
  );
  const pears = table.getByRole("cell", { name: pearsNote, exact: true });
  await pears.click();
  await beat(page, 400);
  await pears.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Table options" });
  const equal = menu.getByRole("menuitem", {
    name: "Equal rows",
    exact: true,
  });
  await expect(equal).toBeVisible();
  await expect(equal).toBeEnabled();
  await expect(
    menu.getByRole("menuitem", { name: "Equal columns", exact: true }),
  ).toBeVisible();
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
  await expect(rows.nth(2).locator("td")).toHaveText([pearsNote, "4"]);
  await expect(rows.nth(3).locator("td")).toHaveText(["Apples", "2"]);
  await expect(editor.getByText("Buy these Saturday.")).toBeVisible();
  await expect(table.getByText("Buy these Saturday.")).toHaveCount(0);
  const equalHeights = await rowPixels(table);
  expect(Math.max(...equalHeights) - Math.min(...equalHeights)).toBeLessThan(3);
  expect(equalHeights[2]).toBeGreaterThanOrEqual(pearsBefore - 1);
  expect(equalHeights[0]).toBeGreaterThan((before[0] ?? 0) + 12);
  expect(equalHeights[1]).toBeGreaterThan((before[1] ?? 0) + 12);
  expect(equalHeights[3]).toBeGreaterThan((before[3] ?? 0) + 12);
  expect(await columnPixels(table)).toEqual([200, 200]);
  const noteFits = await pears.evaluate(
    (el) => el.scrollHeight <= el.clientHeight + 2,
  );
  expect(noteFits).toBe(true);
  await expect(pears).toBeVisible();
  await caption(
    page,
    "The header and Apples grew to the pears row. The note is still all there. The columns stayed equal.",
    1800,
  );

  await caption(
    page,
    "She sorts by Item. The rows stay the same height. The header and the spanned title stay.",
  );
  await pears.click();
  await beat(page, 300);
  await pears.click({ button: "right" });
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
  await expect(rows.nth(3).locator("td")).toHaveText([pearsNote, "4"]);
  await expect(editor.getByText("Buy these Saturday.")).toBeVisible();
  await expect(table.getByText("Buy these Saturday.")).toHaveCount(0);
  const sortedHeights = await rowPixels(table);
  expect(Math.max(...sortedHeights) - Math.min(...sortedHeights)).toBeLessThan(
    3,
  );
  expect(sortedHeights[3]).toBeGreaterThanOrEqual(pearsBefore - 1);
  expect(await columnPixels(table)).toEqual([200, 200]);
  const sortedNote = rows.nth(3).locator("td").first();
  expect(
    await sortedNote.evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
  ).toBe(true);
  await caption(
    page,
    "Apples 2, then Pears 4. Every row is still as tall as the pears note, and the title still spans both columns.",
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
  await expect(rows.nth(3).locator("td")).toHaveText([pearsNote, "4"]);
  await expect(editor.getByText("Buy these Saturday.")).toBeVisible();
  await table.scrollIntoViewIfNeeded();
  const reopened = await rowPixels(table);
  expect(Math.max(...reopened) - Math.min(...reopened)).toBeLessThan(3);
  expect(reopened[3]).toBeGreaterThanOrEqual(pearsBefore - 1);
  expect(await columnPixels(table)).toEqual([200, 200]);
  expect(
    await rows
      .nth(3)
      .locator("td")
      .first()
      .evaluate((el) => el.scrollHeight <= el.clientHeight + 2),
  ).toBe(true);
  await caption(
    page,
    "Reopened. The rows are still equal, the pears note is still fully visible, and the title still spans both columns.",
    1800,
  );

  await caption(
    page,
    "Word keeps every row the same height, and the title across both columns.",
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
  const trHeight = (rowXml: string) => {
    const tag = rowXml.match(/<w:trHeight\b[^>]*\/>/);
    return Number(tag?.[0].match(/\bw:val="(\d+)"/)?.[1]);
  };
  expect(grid).toEqual([3000, 3000]);
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
    [pearsNote, "4"],
  ]);
  const heights = wordRows.map(trHeight);
  expect(heights.every((height) => height === heights[0] && height > 0)).toBe(
    true,
  );
  await caption(
    page,
    "The Word file has equal row heights, the title still spans both columns, and the pears note is still in its cell.",
    1800,
  );
});
