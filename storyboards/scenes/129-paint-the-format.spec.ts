import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { createFile, serializeFile, type DocFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { beat, caption, expect, test } from "./harness";

const sentence = "Apples were 4 dollars.";
const after = "The stall closed at dusk.";
const blue = "rgb(26, 115, 232)";

function paragraph(page: Page, text: string) {
  return page.locator(".document-content p", { hasText: text });
}

async function seedMarket(page: Page) {
  const file = createFile("doc", "Saturday market") as DocFile;
  file.content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Market",
            marks: [
              { type: "bold" },
              {
                type: "textStyle",
                attrs: { fontSize: "18pt", color: "#1a73e8" },
              },
            ],
          },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: sentence }] },
      { type: "paragraph", content: [{ type: "text", text: after }] },
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
  await page.getByRole("link", { name: /Saturday market/ }).waitFor();
}

async function phraseBox(page: Page, phrase: string) {
  const box = await page.locator(".document-content").evaluate((root, target) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; start: number }[] = [];
    let combined = "";
    let current: Node | null;
    while ((current = walker.nextNode())) {
      const text = current.textContent ?? "";
      nodes.push({ node: current as Text, start: combined.length });
      combined += text;
    }
    const index = combined.indexOf(target);
    if (index < 0) return null;
    const end = index + target.length;
    const startPart = [...nodes].reverse().find((part) => part.start <= index);
    const endPart = [...nodes].reverse().find((part) => part.start < end);
    if (!startPart || !endPart) return null;
    const range = document.createRange();
    range.setStart(startPart.node, index - startPart.start);
    range.setEnd(endPart.node, end - endPart.start);
    const rect = range.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, phrase);
  if (!box) throw new Error(`missing ${phrase}`);
  return box;
}

async function selectPhrase(page: Page, phrase: string) {
  const box = await phraseBox(page, phrase);
  const y = box.y + box.height / 2;
  if (phrase.includes(" ")) {
    await page.mouse.move(Math.max(0, box.x - 2), y);
    await beat(page, 150);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 6, y, { steps: 18 });
    await page.mouse.up();
  } else {
    await page.mouse.move(box.x + box.width / 2, y);
    await beat(page, 150);
    await page.mouse.dblclick(box.x + box.width / 2, y);
  }
  await expect
    .poll(async () => {
      const selected = await page.evaluate(
        () => document.getSelection()?.toString() ?? "",
      );
      if (
        selected.length > 0 &&
        selected.length < phrase.length &&
        phrase.startsWith(selected)
      )
        await page.keyboard.press("Shift+ArrowRight");
      return page.evaluate(() => document.getSelection()?.toString() ?? "");
    })
    .toBe(phrase);
}

async function look(page: Page, phrase: string) {
  return page.locator(".document-content").evaluate((root, target) => {
    const block = [...root.querySelectorAll("p")].find((el) =>
      (el.textContent ?? "").includes(target),
    );
    if (!block) throw new Error(`missing ${target}`);
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const parts: { text: string; weight: number; size: number; color: string }[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      if (!text) continue;
      const style = getComputedStyle(node.parentElement!);
      parts.push({
        text,
        weight: style.fontWeight === "bold" ? 700 : Number(style.fontWeight),
        size: Number.parseFloat(style.fontSize),
        color: style.color,
      });
    }
    const blockText = (block.textContent ?? "").trim();
    const overlapping =
      blockText === target
        ? parts
        : parts.filter((part) => part.text.includes(target));
    if (!overlapping.length) throw new Error(`missing ${target}`);
    const colors = new Set(overlapping.map((part) => part.color));
    return {
      text: block.textContent ?? "",
      minWeight: Math.min(...overlapping.map((part) => part.weight)),
      maxWeight: Math.max(...overlapping.map((part) => part.weight)),
      minSize: Math.min(...overlapping.map((part) => part.size)),
      maxSize: Math.max(...overlapping.map((part) => part.size)),
      color: colors.size === 1 ? overlapping[0].color : "mixed",
    };
  }, phrase);
}

function expectPainted(style: Awaited<ReturnType<typeof look>>) {
  expect(style.minWeight).toBeGreaterThanOrEqual(700);
  expect(style.minSize).toBeGreaterThan(20);
  expect(style.color).toBe(blue);
}

function expectPlain(style: Awaited<ReturnType<typeof look>>) {
  expect(style.maxWeight).toBeLessThan(700);
  expect(style.maxSize).toBeLessThan(18);
  expect(style.color).toBe("rgb(0, 0, 0)");
}

test("129-paint-the-format", async ({ page }) => {
  await seedMarket(page);
  await caption(
    page,
    "Nia opens Saturday market. Market is bold, 18 pt, and blue. The next sentence is plain.",
  );
  await page.getByRole("link", { name: /Saturday market/ }).click();
  await expect(paragraph(page, "Market")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy format" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply format" })).toHaveCount(0);
  expectPainted(await look(page, "Market"));
  expectPlain(await look(page, sentence));
  expectPlain(await look(page, after));
  await expect(paragraph(page, sentence)).toHaveText(sentence);
  await beat(page, 1400);

  await caption(
    page,
    "She selects Market and chooses Copy format, beside Bold. The control then reads Apply format.",
  );
  await selectPhrase(page, "Market");
  await beat(page, 500);
  await page.getByRole("button", { name: "Copy format" }).click();
  await expect(page.getByRole("button", { name: "Apply format" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy format" })).toHaveCount(0);
  expectPainted(await look(page, "Market"));
  expectPlain(await look(page, sentence));
  await expect(paragraph(page, sentence)).toHaveText(sentence);
  await beat(page, 1600);

  await caption(
    page,
    "She selects the sentence and chooses Apply format. The letters stay the same. They become bold, 18 pt, and blue.",
  );
  await selectPhrase(page, sentence);
  await beat(page, 400);
  await page.getByRole("button", { name: "Apply format" }).click();
  await expect(paragraph(page, sentence)).toHaveText(sentence);
  expectPainted(await look(page, sentence));
  expectPainted(await look(page, "Market"));
  expectPlain(await look(page, after));
  await expect(page.getByRole("button", { name: "Copy format" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply format" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Bold", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await beat(page, 2000);

  await caption(
    page,
    "Copy format on a plain word, then Apply format, leaves both words plain. The sentence stays blue.",
  );
  await selectPhrase(page, "stall");
  await page.getByRole("button", { name: "Copy format" }).click();
  await expect(page.getByRole("button", { name: "Apply format" })).toBeVisible();
  await beat(page, 800);
  await selectPhrase(page, "dusk");
  await page.getByRole("button", { name: "Apply format" }).click();
  expectPlain(await look(page, "stall"));
  expectPlain(await look(page, "dusk"));
  expectPainted(await look(page, sentence));
  await expect(paragraph(page, after)).toHaveText(after);
  await expect(page.getByRole("button", { name: "Copy format" })).toBeVisible();
  await beat(page, 1400);

  await caption(
    page,
    "She saves, returns home, and reopens. The sentence is still bold, 18 pt, and blue.",
  );
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 800);
  await page.getByRole("link", { name: /Saturday market/ }).click();
  await expect(paragraph(page, sentence)).toHaveText(sentence);
  expectPainted(await look(page, sentence));
  expectPainted(await look(page, "Market"));
  expectPlain(await look(page, after));
  await expect(page.getByRole("button", { name: "Apply format" })).toHaveCount(0);
  await selectPhrase(page, sentence);
  await beat(page, 1600);

  await caption(
    page,
    "File, Export DOCX. The sentence and Market are bold, 18 pt, and blue. The last paragraph stays plain.",
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 500);
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const xml = await JSZip.loadAsync(
    readFileSync((await (await download).path())!),
  ).then((zip) => zip.file("word/document.xml")!.async("string"));
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(
    (match) => match[0],
  );
  const marketXml = paragraphs.find((item) => item.includes(">Market<"));
  const sentenceXml = paragraphs.find((item) => item.includes(sentence));
  const afterXml = paragraphs.find((item) => item.includes("stall closed"));
  for (const item of [marketXml, sentenceXml]) {
    expect(item).toBeTruthy();
    expect(item).toMatch(/<w:b[\s/>]/);
    expect(item).toMatch(/w:val="36"/);
    expect(item?.toLowerCase()).toContain('w:val="1a73e8"');
  }
  expect(sentenceXml).toContain(sentence);
  expect(afterXml).toBeTruthy();
  expect(afterXml).not.toMatch(/<w:b[\s/>]/);
  expect(afterXml?.toLowerCase()).not.toContain("1a73e8");
  expect(afterXml).not.toContain('w:val="36"');
  await beat(page, 1200);
});
