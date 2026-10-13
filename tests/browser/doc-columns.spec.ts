import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { createFile, serializeFile, type DocFile, type JsonNode } from "@suiteleaf/core";

const heading = "Garden club news for the March plant sale";
const items = [
  "Plant sale Saturday at the hall. Bring pots, labels, and a bag for the extras.",
  "Compost workshop starts at ten. Members should bring gloves and a bucket.",
  "New officers this year: Nia chairs, and Sam keeps the minutes.",
];

function paragraph(text: string): JsonNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

async function seedNewsletter(page: Page) {
  const file = createFile("doc", "Garden club news") as DocFile;
  file.content = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: heading }] },
      ...items.map(paragraph),
    ],
  };
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).waitFor();
  await page.evaluate(async (record) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("encoded", "readwrite");
        tx.objectStore("encoded").put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, {
    id: file.id,
    title: file.title,
    updatedAt: file.updatedAt,
    native: serializeFile(file),
  });
  await page.reload();
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible();
}

test("two columns apply to the selection, survive reopen, and export to Word", async ({
  page,
}) => {
  await seedNewsletter(page);
  await expect(page.locator(".doc-columns")).toHaveCount(0);

  await page.locator(".document-content > p", { hasText: "Plant sale" }).click();
  await page.keyboard.down("Shift");
  await page.locator(".document-content > p", { hasText: "New officers" }).click();
  await page.keyboard.up("Shift");
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Two columns", exact: true }).click();
  await expect(page.locator(".document-content > h1")).toHaveText(heading);
  await expect(page.locator(".doc-columns > p")).toHaveCount(3);

  const split = await page.locator(".document-content").evaluate(() => {
    const box = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, width: rect.width, right: rect.right };
    };
    const title = document.querySelector(".document-content > h1")!;
    const paras = [...document.querySelectorAll(".doc-columns > p")].map(box);
    return { heading: box(title), paras };
  });
  const left = split.paras.reduce((a, b) => (a.x < b.x ? a : b));
  const right = split.paras.reduce((a, b) => (a.x > b.x ? a : b));
  expect(right.x).toBeGreaterThan(left.x + left.width + 16);
  expect(split.heading.width).toBeGreaterThan(left.width + 60);
  expect(split.heading.right).toBeGreaterThan(right.x + 24);

  const edited = page.locator(".doc-columns p").last();
  const spot = (await edited.boundingBox())!;
  await page.mouse.click(spot.x + 12, spot.y + 8);
  await page.keyboard.type(" OK");
  await expect(page.locator(".doc-columns")).toContainText("OK");
  await expect(page.locator(".doc-columns")).toContainText("Plant sale");

  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page.getByRole("menuitem", { name: "One column", exact: true }).click();
  await expect(page.locator(".doc-columns")).toHaveCount(0);
  await expect(page.locator(".document-content > h1")).toHaveText(heading);
  const xs = await page.locator(".document-content > p").evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().x),
  );
  expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(4);

  await page.locator(".document-content > p").first().click();
  await page.keyboard.down("Shift");
  await page.locator(".document-content > p").last().click();
  await page.keyboard.up("Shift");
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page.getByRole("menuitem", { name: "Two columns", exact: true }).click();
  await expect(page.locator(".doc-columns")).toBeVisible();
  await expect(page.locator(".document-content > h1")).toHaveText(heading);
  await expect(page.locator(".doc-columns > p")).not.toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Saved");

  await page.reload();
  await expect(page.locator(".doc-columns")).toBeVisible();
  await expect(page.locator(".doc-columns")).toContainText("Plant sale");
  await expect(page.locator(".document-content > h1")).toHaveText(heading);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const download = await downloadPromise;
  const xml = await (
    await JSZip.loadAsync(await readFile((await download.path())!))
  ).file("word/document.xml")!.async("string");
  const headingEnd = xml.indexOf("Plant sale");
  expect(xml.slice(0, headingEnd)).toContain("Garden club news");
  expect(xml.slice(0, headingEnd)).not.toContain('w:num="2"');
  expect(xml).toContain('w:num="2"');
  expect(xml).toContain('w:val="continuous"');
});
