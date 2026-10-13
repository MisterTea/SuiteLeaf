import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { createFile, serializeFile, type DocFile, type JsonNode } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

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
    content: [
      {
        type: "paragraph",
        attrs: { lineSpacing: "double" },
        content: [{ type: "text", text }],
      },
    ],
  };
}

function blockOf(page: Page, text: string) {
  const hasText = text === "Motion" ? /^Motion$/ : text;
  return page.locator(
    ".document-content p, .document-content h1, .document-content h2, .document-content h3",
    { hasText },
  );
}

async function textGap(page: Page, above: string, below: string) {
  return page.evaluate(
    ({ topText, bottomText }) => {
      const find = (text: string) =>
        [...document.querySelectorAll(".document-content p, .document-content h2")].find((el) =>
          text === "Motion" ? el.textContent === "Motion" : el.textContent?.includes(text),
        );
      const edge = (el: Element, which: "top" | "bottom") => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()].filter((rect) => rect.height > 0);
        return which === "top" ? rects[0].top : rects[rects.length - 1].bottom;
      };
      const start = find(topText);
      const end = find(bottomText);
      if (!start || !end) throw new Error("missing paragraph");
      return edge(end, "top") - edge(start, "bottom");
    },
    { topText: above, bottomText: below },
  );
}

async function lineAdvance(page: Page) {
  return blockOf(page, "greenhouse").evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((rect) => rect.height > 0);
    if (rects.length < 2) throw new Error("welcome paragraph did not wrap");
    return rects[1].top - rects[0].top;
  });
}

async function seedMinutes(page: Page) {
  const file = createFile("doc", "Garden club minutes") as DocFile;
  file.content = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { lineSpacing: "1.5" },
        content: [{ type: "text", text: welcome }],
      },
      {
        type: "heading",
        attrs: { level: 2, spaceBefore: 0, spaceAfter: 0 },
        content: [{ type: "text", text: "Motion" }],
      },
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

async function setPoints(page: Page, label: "Space before" | "Space after", points: string) {
  const field = page.getByRole("textbox", { name: label, exact: true });
  await field.click();
  await beat(page, 250);
  await page.keyboard.press("ControlOrMeta+A");
  await typeSlowly(page, points, 90);
  await beat(page, 400);
  await page.keyboard.press("Enter");
}

test("95-space-before-and-after", async ({ page }) => {
  await seedMinutes(page);
  await caption(
    page,
    "Priya opens the garden club minutes. The welcome and the motion sit together, with no extra gap.",
  );
  await page.getByRole("link", { name: /Garden club minutes/ }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("greenhouse");
  await blockOf(page, "greenhouse").click();
  const spacing = page.getByRole("button", { name: /Line spacing/ });
  await expect(spacing).toContainText("1.5");
  await expect(spacing).toHaveAttribute("aria-label", /Space before 0 points/);
  await expect(spacing).toHaveAttribute("aria-label", /Space after 0 points/);
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-line-spacing", "1.5");
  for (const line of motion)
    await expect(blockOf(page, line)).toHaveAttribute("data-line-spacing", "double");
  const glued = await textGap(page, "greenhouse", "Motion");
  expect(glued).toBeLessThan(14);
  const advance = await lineAdvance(page);
  await beat(page, 1400);

  await caption(
    page,
    "Space before and Space after are on the same control as line spacing. It already shows 0 pt. No second dialog.",
  );
  await spacing.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("listbox", { name: "Line spacing" })).toBeVisible();
  await expect(page.getByRole("option", { name: "1.5", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("textbox", { name: "Space before", exact: true })).toHaveValue("0");
  await expect(page.getByRole("textbox", { name: "Space after", exact: true })).toHaveValue("0");
  await beat(page, 1600);
  await setPoints(page, "Space after", "12");
  await expect(page.getByRole("textbox", { name: "Space after", exact: true })).toHaveValue("12");
  await beat(page, 700);
  await page.keyboard.press("Escape");
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-space-after", "12");
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-line-spacing", "1.5");
  await expect(spacing).toContainText("1.5");
  await expect(spacing).toHaveAttribute("aria-label", /Space after 12 points/);
  for (const line of motion)
    await expect(blockOf(page, line)).not.toHaveAttribute("data-space-after", "12");

  await caption(
    page,
    "12 pt opens under the welcome. The motion stays together, and the welcome lines stay at 1.5.",
  );
  const afterWelcome = await textGap(page, "greenhouse", "Motion");
  expect(afterWelcome).toBeGreaterThan(glued + 12);
  expect(Math.abs((await lineAdvance(page)) - advance)).toBeLessThan(2);
  await beat(page, 1600);

  await caption(
    page,
    "She moves to the Motion heading. This paragraph has 0 pt before. The welcome still has 12 pt after.",
  );
  await blockOf(page, "Motion").click();
  await expect(spacing).toHaveAttribute("aria-label", /Space before 0 points/);
  await expect(spacing).toHaveAttribute("aria-label", /Space after 0 points/);
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-space-after", "12");
  await beat(page, 900);
  await spacing.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Space before", exact: true })).toHaveValue("0");
  await beat(page, 1200);
  await setPoints(page, "Space before", "12");
  await beat(page, 600);
  await page.keyboard.press("Escape");
  await expect(blockOf(page, "Motion")).toHaveAttribute("data-space-before", "12");
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-space-after", "12");
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-line-spacing", "1.5");

  await caption(page, "A gap opens above the heading. The welcome's 12 pt after is still there.");
  expect(await textGap(page, "greenhouse", "Motion")).toBeGreaterThan(afterWelcome + 12);
  await expect(spacing).toHaveAttribute("aria-label", /Space before 12 points/);
  await beat(page, 1600);

  await caption(
    page,
    "She puts the caret in the motion and sets Space after to 12, then back to 0. The extra gap goes away. The lines stay double-spaced.",
  );
  await blockOf(page, motion[0]).click();
  await blockOf(page, motion[0]).evaluate((el) => {
    el.scrollIntoView({ block: "center", inline: "nearest" });
  });
  await expect(spacing).toContainText("Double");
  await expect(spacing).toHaveAttribute("aria-label", /Space after 0 points/);
  await beat(page, 900);
  await spacing.click();
  await setPoints(page, "Space after", "12");
  await beat(page, 400);
  await page.keyboard.press("Escape");
  await expect(blockOf(page, motion[0])).toHaveAttribute("data-space-after", "12");
  await expect(blockOf(page, motion[1])).not.toHaveAttribute("data-space-after", "12");
  await expect(blockOf(page, motion[0])).toHaveAttribute("data-line-spacing", "double");
  const withGap = await textGap(page, motion[0], motion[1]);
  await beat(page, 1400);
  await spacing.click();
  await setPoints(page, "Space after", "0");
  await beat(page, 400);
  await page.keyboard.press("Escape");
  await expect(blockOf(page, motion[0])).toHaveAttribute("data-space-after", "0");
  await expect(blockOf(page, motion[0])).toHaveAttribute("data-line-spacing", "double");
  for (const line of motion.slice(1))
    await expect(blockOf(page, line)).toHaveAttribute("data-line-spacing", "double");
  expect(await textGap(page, motion[0], motion[1])).toBeLessThan(withGap - 12);
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-line-spacing", "1.5");
  await beat(page, 1500);

  await caption(
    page,
    "She reopens the minutes. Welcome still has 12 pt after, the heading 12 pt before, and the motion 0 after.",
  );
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 800);
  await page.getByRole("link", { name: /Garden club minutes/ }).click();
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-space-after", "12");
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-line-spacing", "1.5");
  await expect(blockOf(page, "Motion")).toHaveAttribute("data-space-before", "12");
  await expect(blockOf(page, motion[0])).toHaveAttribute("data-space-after", "0");
  for (const line of motion.slice(1))
    await expect(blockOf(page, line)).not.toHaveAttribute("data-space-after");
  await blockOf(page, "greenhouse").click();
  await expect(spacing).toHaveAttribute("aria-label", /Space after 12 points/);
  await beat(page, 700);
  await blockOf(page, "Motion").click();
  await expect(spacing).toHaveAttribute("aria-label", /Space before 12 points/);
  await beat(page, 700);
  await blockOf(page, motion[1]).click();
  await expect(spacing).toContainText("Double");
  await expect(spacing).toHaveAttribute("aria-label", /Space after 0 points/);
  await beat(page, 1200);

  await caption(
    page,
    "File, Export DOCX. Word records 12 pt after the welcome and 12 pt before the heading, and leaves the motion at 0.",
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
  const labelXml = paragraphs.find((paragraph) => paragraph.includes(">Motion<"));
  const motionXml = paragraphs.find((paragraph) => paragraph.includes("beans"));
  expect(welcomeXml).toContain('w:after="240"');
  expect(welcomeXml).toContain('w:line="360"');
  expect(welcomeXml).not.toContain("w:before=");
  expect(labelXml).toContain('w:before="240"');
  expect(labelXml).not.toContain("w:after=");
  expect(motionXml).toContain('w:line="480"');
  expect(motionXml).not.toContain("w:after=");
  expect(motionXml).not.toContain("w:before=");
  await caption(
    page,
    "The welcome has air under it. The heading has air above it. The motion has none after it.",
    2200,
  );
});
