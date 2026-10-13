import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import JSZip from "jszip";
import { createFile, serializeFile, type DocFile, type JsonNode } from "@suiteleaf/core";
import { beat, caption, expect, test } from "./harness";

const heading = "Garden club news for the March plant sale";
const items = [
  "Plant sale Saturday at the hall. Bring pots, labels, and a bag for the extras.",
  "Compost workshop starts at ten. Members should bring gloves and a bucket.",
  "New officers this year: Nia chairs, and Sam keeps the minutes.",
];

function paragraph(text: string): JsonNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

async function wordPoint(page: Page, word: string) {
  const point = await page.locator(".document-content").evaluate((root, value) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      const at = text.indexOf(value);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + value.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    return null;
  }, word);
  if (!point) throw new Error(`Could not find ${word}`);
  return point;
}

async function chooseColumns(page: Page, label: "One column" | "Two columns") {
  const format = page.getByRole("button", { name: "Format", exact: true });
  await pointAt(page, format);
  await format.click();
  const choice = page.getByRole("menuitem", { name: label, exact: true });
  await expect(choice).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await pointAt(page, choice);
  await choice.click();
}

async function pointAt(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(12, box.height / 2), {
    steps: 14,
  });
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

async function layout(page: Page) {
  return page.locator(".document-content").evaluate(() => {
    const box = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, right: rect.right };
    };
    const headingEl = document.querySelector(".document-content > h1");
    const paras = [...document.querySelectorAll(".doc-columns > p")];
    if (!(headingEl instanceof HTMLElement)) return null;
    return {
      heading: box(headingEl),
      paras: paras.map((el) => ({ text: el.textContent ?? "", ...box(el) })),
    };
  });
}

test("74-two-columns-for-the-news", async ({ page }) => {
  await seedNewsletter(page);
  await caption(page, "Nia opens the garden club news. The title and the three items are one column.");
  const title = page.locator(".document-content > h1");
  await expect(title).toHaveText(heading);
  await expect(page.locator(".doc-columns")).toHaveCount(0);
  await beat(page, 800);

  const first = page.locator(".document-content > p", { hasText: "Plant sale" });
  const last = page.locator(".document-content > p", { hasText: "New officers" });
  await caption(page, "She selects the three items, not the heading.");
  await pointAt(page, first);
  await first.click();
  await page.keyboard.down("Shift");
  await pointAt(page, last);
  await last.click();
  await page.keyboard.up("Shift");
  await beat(page, 500);

  await caption(
    page,
    "Format, Two columns. One choice. No section break, and no second dialog.",
  );
  await chooseColumns(page, "Two columns");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".doc-columns")).toBeVisible();
  await expect(page.locator(".doc-columns > p")).toHaveCount(3);
  await expect(page.locator(".doc-columns h1")).toHaveCount(0);
  const split = (await layout(page))!;
  const left = Math.min(...split.paras.map((item) => item.x));
  const rightItem = split.paras.reduce((a, b) => (a.x > b.x ? a : b));
  const leftItem = split.paras.reduce((a, b) => (a.x < b.x ? a : b));
  expect(rightItem.x - left).toBeGreaterThan(80);
  expect(rightItem.x).toBeGreaterThan(leftItem.x + leftItem.width + 16);
  expect(split.heading.width).toBeGreaterThan(leftItem.width + 60);
  expect(split.heading.right).toBeGreaterThan(rightItem.x + 24);
  await beat(page, 1200);

  await caption(page, "The title still spans the page. The items flow down the left, then the right.");
  await beat(page, 900);
  await caption(page, "She can still edit a word in either column.");
  const saturdayAt = await wordPoint(page, "Saturday");
  const samAt = await wordPoint(page, "Sam");
  expect(Math.abs(samAt.x - saturdayAt.x)).toBeGreaterThan(80);
  const sam = samAt;
  await page.mouse.move(sam.x, sam.y, { steps: 12 });
  await page.mouse.dblclick(sam.x, sam.y);
  await page.keyboard.type("Samir", { delay: 45 });
  await expect(page.locator(".doc-columns")).toContainText("Samir");
  const saturday = await wordPoint(page, "Saturday");
  await page.mouse.move(saturday.x, saturday.y, { steps: 12 });
  await page.mouse.dblclick(saturday.x, saturday.y);
  await page.keyboard.type("Sunday", { delay: 45 });
  await expect(page.locator(".doc-columns")).toContainText("Sunday");
  await beat(page, 800);

  await caption(page, "One column puts the items back in a single stream. The title stays full width.");
  await pointAt(page, page.locator(".doc-columns p").first());
  await page.locator(".doc-columns p").first().click();
  await page.keyboard.down("Shift");
  await pointAt(page, page.locator(".doc-columns p").last());
  await page.locator(".doc-columns p").last().click();
  await page.keyboard.up("Shift");
  await chooseColumns(page, "One column");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".doc-columns")).toHaveCount(0);
  await expect(page.locator(".document-content > h1")).toHaveText(heading);
  await expect(page.locator(".document-content")).toContainText("Plant sale");
  await expect(page.locator(".document-content")).toContainText("Compost");
  await expect(page.locator(".document-content")).toContainText("Samir");
  const stream = await page.locator(".document-content > p").evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().x),
  );
  expect(Math.max(...stream) - Math.min(...stream)).toBeLessThan(4);
  await beat(page, 1000);

  await caption(page, "She sets two columns again. SuiteLeaf saves it on this computer.");
  await page.locator(".document-content > p", { hasText: "Plant sale" }).click();
  await page.keyboard.down("Shift");
  await page.locator(".document-content > p", { hasText: "New officers" }).click();
  await page.keyboard.up("Shift");
  await chooseColumns(page, "Two columns");
  await expect(page.locator(".doc-columns > p")).toHaveCount(3);
  await expect(page.getByRole("status")).toContainText("Saved");
  await beat(page, 600);

  await caption(page, "She closes the news and opens it again. The title is full width, and the items are still in two columns.");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Garden club news" }).click();
  await expect(page.locator(".document-content > h1")).toHaveText(heading);
  await expect(page.locator(".doc-columns > p")).toHaveCount(3);
  await expect(page.locator(".doc-columns")).toContainText("Samir");
  const reopened = (await layout(page))!;
  const reopenedRight = reopened.paras.reduce((a, b) => (a.x > b.x ? a : b));
  const reopenedLeft = reopened.paras.reduce((a, b) => (a.x < b.x ? a : b));
  expect(reopenedRight.x).toBeGreaterThan(reopenedLeft.x + reopenedLeft.width + 16);
  expect(reopened.heading.width).toBeGreaterThan(reopenedLeft.width + 60);
  await beat(page, 1000);

  await caption(page, "File, Export DOCX. Word keeps the title full width and the items in two columns.");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const download = await downloadPromise;
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const xml = await zip.file("word/document.xml")!.async("string");
  const headingEnd = xml.indexOf("Plant sale");
  expect(xml.slice(0, headingEnd)).toContain("Garden club news");
  expect(xml.slice(0, headingEnd)).not.toContain('w:num="2"');
  expect(xml).toContain('w:num="2"');
  expect(xml).toContain('w:space="720"');
  expect(xml).toContain('w:val="continuous"');
  expect(xml).toContain("Samir");
  await caption(page, "The newsletter title spans the page. The three items sit in two columns under it.", 1800);
});
