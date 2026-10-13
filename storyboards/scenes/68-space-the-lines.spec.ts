import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { createFile, serializeFile, type DocFile, type JsonNode } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { beat, caption, expect, test } from "./harness";

const welcome =
  "Welcome to the October meeting of the Riverside Garden Club. We are glad you came to the greenhouse this evening. Before the frost we need to decide the south bed, and we want this welcome to stay easy to read while the vote itself stays compact. Please take a copy of the minutes and a seat near the door.";
const motion = [
  "Plant the south bed with beans.",
  "Second the motion and open the vote.",
  "The vote carries if members present agree.",
];

function item(text: string): JsonNode {
  return {
    type: "listItem",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function paragraphOf(page: Page, text: string) {
  const hasText = text === "Motion" ? /^Motion$/ : text;
  return page.locator(".document-content p", { hasText });
}

async function lineAdvance(page: Page, text: string) {
  return paragraphOf(page, text).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((rect) => rect.height > 0);
    if (rects.length < 2) throw new Error("welcome paragraph did not wrap");
    return rects[1].top - rects[0].top;
  });
}

async function motionSpan(page: Page) {
  const top = async (text: string) => (await paragraphOf(page, text).boundingBox())!.y;
  return (await top(motion[2])) - (await top(motion[0]));
}

async function seedMinutes(page: Page) {
  const file = createFile("doc", "Garden club minutes") as DocFile;
  file.content = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: welcome }] },
      { type: "paragraph", content: [{ type: "text", text: "Motion" }] },
      { type: "bulletList", content: motion.map(item) },
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
  await page.getByRole("link", { name: /Garden club minutes/ }).waitFor();
}

test("68-space-the-lines", async ({ page }) => {
  await seedMinutes(page);
  await caption(
    page,
    "Priya opens the garden club minutes. The welcome and the motion are both single-spaced.",
  );
  await page.getByRole("link", { name: /Garden club minutes/ }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("greenhouse");
  await paragraphOf(page, "greenhouse").click();
  const spacing = page.getByRole("button", { name: /Line spacing/ });
  await expect(spacing).toContainText("Single");
  await expect(paragraphOf(page, "greenhouse")).toHaveAttribute("data-line-spacing", "single");
  for (const line of motion)
    await expect(paragraphOf(page, line)).toHaveAttribute("data-line-spacing", "single");
  const singleAdvance = await lineAdvance(page, "greenhouse");
  const singleSpan = await motionSpan(page);
  await beat(page, 1200);

  await caption(
    page,
    "Line spacing is one control. It already says Single. She opens it and chooses 1.5. No second dialog.",
  );
  await spacing.click();
  const menu = page.getByRole("listbox", { name: "Line spacing" });
  await expect(menu.getByRole("option", { name: "Single", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  for (const name of ["Single", "1.15", "1.5", "Double"])
    await expect(menu.getByRole("option", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await beat(page, 1600);
  await menu.getByRole("option", { name: "1.5", exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(spacing).toContainText("1.5");
  await expect(paragraphOf(page, "greenhouse")).toHaveAttribute("data-line-spacing", "1.5");

  await caption(page, "The welcome lines open up. The motion list under them stays single-spaced.");
  expect(await lineAdvance(page, "greenhouse")).toBeGreaterThan(singleAdvance * 1.3);
  await expect(paragraphOf(page, "Motion")).toHaveAttribute("data-line-spacing", "single");
  for (const line of motion)
    await expect(paragraphOf(page, line)).toHaveAttribute("data-line-spacing", "single");
  expect(await motionSpan(page)).toBeLessThan(singleSpan * 1.15);
  await beat(page, 1500);

  await caption(
    page,
    "She selects the motion and chooses Double. Those three lines spread out. The welcome stays at 1.5.",
  );
  await paragraphOf(page, motion[0]).click();
  await beat(page, 500);
  await paragraphOf(page, motion[2]).click({ modifiers: ["Shift"] });
  await expect(spacing).toContainText("Single");
  await beat(page, 700);
  await spacing.click();
  await expect(menu.getByRole("option", { name: "Single", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await beat(page, 1400);
  await menu.getByRole("option", { name: "Double", exact: true }).click();
  await expect(paragraphOf(page, "greenhouse")).toHaveAttribute("data-line-spacing", "1.5");
  await expect(paragraphOf(page, "Motion")).toHaveAttribute("data-line-spacing", "single");
  for (const line of motion)
    await expect(paragraphOf(page, line)).toHaveAttribute("data-line-spacing", "double");
  expect(await motionSpan(page)).toBeGreaterThan(singleSpan * 1.6);
  await expect(spacing).toContainText("Double");
  await beat(page, 1600);

  await caption(page, "She reopens the minutes. The welcome is still 1.5 and the motion is still Double.");
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 800);
  await page.getByRole("link", { name: /Garden club minutes/ }).click();
  await expect(paragraphOf(page, "greenhouse")).toHaveAttribute("data-line-spacing", "1.5");
  for (const line of motion)
    await expect(paragraphOf(page, line)).toHaveAttribute("data-line-spacing", "double");
  await paragraphOf(page, "greenhouse").click();
  await expect(spacing).toContainText("1.5");
  await beat(page, 600);
  await spacing.click();
  await expect(menu.getByRole("option", { name: "1.5", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await beat(page, 1200);
  await page.keyboard.press("Escape");
  await paragraphOf(page, motion[1]).click();
  await expect(spacing).toContainText("Double");
  await beat(page, 500);
  await spacing.click();
  await expect(menu.getByRole("option", { name: "Double", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await beat(page, 1200);
  await page.keyboard.press("Escape");

  await caption(
    page,
    "File, Export DOCX. Word records 1.5 on the welcome and Double on each motion line.",
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 600);
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const xml = await JSZip.loadAsync(readFileSync((await (await download).path())!)).then((zip) =>
    zip.file("word/document.xml")!.async("string"),
  );
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((match) => match[0]);
  const welcomeXml = paragraphs.find((paragraph) => paragraph.includes("greenhouse"));
  const motionXml = paragraphs.find((paragraph) => paragraph.includes("beans"));
  const labelXml = paragraphs.find((paragraph) => paragraph.includes(">Motion<"));
  expect(welcomeXml).toContain('w:line="360"');
  expect(welcomeXml).toContain('w:lineRule="auto"');
  expect(welcomeXml).not.toContain('w:line="480"');
  expect(motionXml).toContain('w:line="480"');
  expect(labelXml).toContain('w:line="240"');
  await caption(page, "The welcome stays open at 1.5. The motion stays double. Word keeps both.", 2200);
});
