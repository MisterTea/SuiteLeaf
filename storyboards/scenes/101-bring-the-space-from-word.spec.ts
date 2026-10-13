import { readFileSync } from "node:fs";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const welcome =
  "Welcome to the October meeting of the Riverside Garden Club. We are glad you came to the greenhouse this evening. Before the frost we need to decide the south bed, and we want this welcome to stay easy to read while the vote itself stays compact.";
const motion = [
  "Plant the south bed with beans.",
  "Second the motion and open the vote.",
];

const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';

function wordParagraph(
  text: string,
  spacing?: { before?: string; after?: string },
  style?: string,
) {
  const attrs = [
    spacing?.before != null ? `w:before="${spacing.before}"` : "",
    spacing?.after != null ? `w:after="${spacing.after}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const properties = [
    style ? `<w:pStyle w:val="${style}"/>` : "",
    attrs ? `<w:spacing ${attrs}/>` : "",
  ]
    .filter(Boolean)
    .join("");
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

async function minutesDocx() {
  const body = [
    wordParagraph(welcome, { after: "240" }),
    wordParagraph("Motion", { before: "240" }, "Heading2"),
    ...motion.map((line) => wordParagraph(line)),
  ].join("");
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `${xmlHeader}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
  );
  zip.file(
    "word/document.xml",
    `${xmlHeader}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
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

/** Click the first line, so the paragraph controls stay in the right margin. */
async function clickBlock(page: Page, text: string) {
  await blockOf(page, text).click({ position: { x: 18, y: 14 } });
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

test("101-bring-the-space-from-word", async ({ page }) => {
  const bytes = await minutesDocx();
  await page.goto("/");
  await page.getByRole("button", { name: "Open / import" }).waitFor();
  await caption(
    page,
    "Priya opens the garden club minutes from Word. The welcome already has 12 pt after it, and Motion already has 12 pt before it.",
    2200,
  );
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (
    await chooser
  ).setFiles({
    name: "Garden club minutes.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(bytes),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("greenhouse");
  await expect(blockOf(page, "Motion")).toBeVisible();
  await blockOf(page, "greenhouse").evaluate((el) => {
    el.scrollIntoView({ block: "center", inline: "nearest" });
  });

  await caption(
    page,
    "The gaps are on the page as soon as the file opens. Air under the welcome, air above Motion, and none between the motion lines. The welcome stays single-spaced.",
    2600,
  );
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-space-after", "12");
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-space-before", "0");
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-line-spacing", "single");
  await expect(blockOf(page, "Motion")).toHaveAttribute("data-space-before", "12");
  await expect(blockOf(page, "Motion")).toHaveAttribute("data-space-after", "0");
  for (const line of motion) {
    await expect(blockOf(page, line)).toHaveAttribute("data-space-before", "0");
    await expect(blockOf(page, line)).toHaveAttribute("data-space-after", "0");
    await expect(blockOf(page, line)).toHaveAttribute("data-line-spacing", "single");
  }
  const underWelcome = await textGap(page, "greenhouse", "Motion");
  const underMotion = await textGap(page, "Motion", motion[0]);
  const betweenLines = await textGap(page, motion[0], motion[1]);
  expect(underWelcome).toBeGreaterThan(underMotion + 10);
  expect(underWelcome).toBeGreaterThan(betweenLines + 20);
  expect(betweenLines).toBeLessThan(14);
  const advance = await lineAdvance(page);
  expect(advance).toBeLessThan(28);
  await beat(page, 400);

  const spacing = page.getByRole("button", { name: /Line spacing/ });
  await clickBlock(page, "greenhouse");
  await expect(spacing).toContainText("Single");
  await expect(spacing).toContainText("12 pt after");
  await expect(spacing).toHaveAttribute("aria-label", /Space after 12 points/);
  await spacing.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("listbox", { name: "Line spacing" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Single", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("textbox", { name: "Space after", exact: true })).toHaveValue("12");
  await expect(page.getByRole("textbox", { name: "Space before", exact: true })).toHaveValue("0");
  await caption(
    page,
    "The welcome's control already shows Space after 12 pt, next to Single. No second dialog.",
    2400,
  );
  await page.keyboard.press("Escape");
  await beat(page, 500);

  await clickBlock(page, "Motion");
  await expect(spacing).toContainText("12 pt before");
  await expect(spacing).toHaveAttribute("aria-label", /Space before 12 points/);
  await caption(page, "Motion shows Space before 12 pt. The welcome's 12 pt after is still there.", 2200);

  await clickBlock(page, motion[0]);
  await expect(spacing).toContainText("0 pt after");
  await expect(spacing).toHaveAttribute("aria-label", /Space after 0 points/);
  await caption(page, "The motion line shows 0 pt after. It did not pick up a hidden gap.", 2200);

  await clickBlock(page, "greenhouse");
  await spacing.click();
  await setPoints(page, "Space after", "0");
  await beat(page, 400);
  await page.keyboard.press("Escape");
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-space-after", "0");
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-line-spacing", "single");
  await expect(blockOf(page, "Motion")).toHaveAttribute("data-space-before", "12");
  await expect(spacing).toContainText("Single");
  await expect(spacing).toContainText("0 pt after");
  const closed = await textGap(page, "greenhouse", "Motion");
  expect(closed).toBeLessThan(underWelcome - 10);
  expect(closed).toBeGreaterThan(betweenLines);
  expect(Math.abs((await lineAdvance(page)) - advance)).toBeLessThan(2);
  await caption(
    page,
    "She sets the welcome's Space after to 0. Only that gap goes away. The lines stay single-spaced.",
    2400,
  );
  await clickBlock(page, "Motion");
  await expect(spacing).toHaveAttribute("aria-label", /Space before 12 points/);
  await caption(page, "Motion still shows 12 pt before. Zeroing the welcome did not clear it.", 2200);

  await expect(page.getByRole("status")).toContainText("Saved");
  await caption(page, "She goes back to her files and opens the minutes again.", 600);
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 1100);
  await page.getByRole("link", { name: /Garden club minutes/ }).click();
  await expect(editor).toContainText("greenhouse");
  await blockOf(page, "greenhouse").evaluate((el) => {
    el.scrollIntoView({ block: "center", inline: "nearest" });
  });
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-space-after", "0");
  await expect(blockOf(page, "greenhouse")).toHaveAttribute("data-line-spacing", "single");
  await expect(blockOf(page, "Motion")).toHaveAttribute("data-space-before", "12");
  await expect(blockOf(page, motion[0])).toHaveAttribute("data-space-after", "0");
  await clickBlock(page, "Motion");
  await expect(spacing).toHaveAttribute("aria-label", /Space before 12 points/);
  await caption(
    page,
    "She reopens the minutes. Motion is still 12 pt before. The welcome stays at 0 after.",
    2400,
  );

  await caption(
    page,
    "File, Export DOCX. Motion keeps w:before=\"240\". The welcome she zeroed, and the motion line, omit the gap.",
    500,
  );
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 1600);
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export DOCX" }).click();
  const xml = await JSZip.loadAsync(readFileSync((await (await download).path())!)).then((zip) =>
    zip.file("word/document.xml")!.async("string"),
  );
  const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((match) => match[0]);
  const welcomeXml = paragraphs.find((paragraph) => paragraph.includes("greenhouse"));
  const motionXml = paragraphs.find((paragraph) => paragraph.includes(">Motion<"));
  const lineXml = paragraphs.find((paragraph) => paragraph.includes("beans"));
  expect(welcomeXml).not.toContain("w:after");
  expect(welcomeXml).not.toContain("w:before");
  expect(motionXml).toContain('w:before="240"');
  expect(motionXml).not.toContain("w:after");
  expect(lineXml).not.toContain("w:before");
  expect(lineXml).not.toContain("w:after");
  await caption(
    page,
    "The welcome's extra air is gone. Motion still has air above it. The motion line does not.",
    2600,
  );
});
