import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Download, Page } from "@playwright/test";
import JSZip from "jszip";
import { createFile, serializeFile, type JsonNode } from "../../packages/core/src";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const mod = process.platform === "darwin" ? "Meta" : "Control";

function paragraph(text: string): JsonNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}
function heading(text: string, level: number): JsonNode {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}

function quarterlyReport() {
  const file = createFile("doc", "Quarterly Report");
  if (file.kind !== "doc") throw new Error("expected a document");
  file.content = {
    type: "doc",
    content: [
      heading("Quarterly Report", 1),
      heading("Background", 2),
      paragraph("This note is for Friday's board meeting."),
      paragraph("The north region carried the quarter, and finance has signed the figures below."),
      paragraph("Hiring paused in March. Two pilots shipped. The support queue is shorter than it was in January."),
      paragraph("Nothing in this section is final until the questions in the margin are closed."),
      paragraph("Please read the results before the outlook. The percentage is the one finance asked us to check."),
      heading("Results", 2),
      paragraph("Revenue grew 12% in the quarter, led by the north region."),
      heading("Outlook for the rest of the year", 2),
      paragraph("The board will want a shorter version of this section before Friday."),
    ],
  };
  return file;
}

async function openReport(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Quarterly Report.sldoc",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(quarterlyReport())),
  });
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "grew 12%",
  );
  await expect(page.getByRole("status")).toContainText("Saved");
}

async function phraseBox(
  page: Page,
  phrase: string,
  offset = 0,
  collapse = false,
) {
  const box = await page.locator(".document-content").evaluate(
    (root, { phrase, offset, collapse }) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent ?? "";
        const start = text.indexOf(phrase);
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start + offset);
        if (collapse) range.collapse(true);
        else range.setEnd(node, start + phrase.length);
        const end = document.createRange();
        end.setStart(node, start + (collapse ? offset : phrase.length));
        end.collapse(true);
        const startRect = range.getClientRects()[0];
        const endRect = end.getClientRects()[0];
        if (!startRect || !endRect) return null;
        return {
          x: startRect.x,
          y: startRect.y,
          width: Math.max(4, endRect.x - startRect.x),
          height: startRect.height,
        };
      }
      return null;
    },
    { phrase, offset, collapse },
  );
  expect(box, phrase).toBeTruthy();
  return box!;
}

async function selectPhrase(page: Page, phrase: string) {
  const box = await phraseBox(page, phrase);
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await beat(page, 200);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.max(4, box.width - 1), box.y + box.height / 2, {
    steps: 12,
  });
  await page.mouse.up();
  await beat(page, 400);
}

async function showCards(page: Page) {
  const cards = page.locator(".doc-comment-card");
  if (await cards.count())
    await cards.last().evaluate((el) =>
      el.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  await beat(page, 500);
}

async function caret(page: Page, phrase: string, offset: number) {
  const box = await phraseBox(page, phrase, offset, true);
  await page.mouse.click(box.x + Math.max(1, box.width / 2), box.y + box.height / 2);
  await page.locator(".document-content").evaluate(
    (root, { phrase, offset }) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent ?? "";
        const start = text.indexOf(phrase);
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, Math.min(start + offset, text.length));
        range.collapse(true);
        const selection = root.ownerDocument.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        if (root instanceof HTMLElement) root.focus();
        return;
      }
    },
    { phrase, offset },
  );
  await beat(page, 250);
}

async function savedBytes(download: Promise<Download> | Download) {
  const file = await download;
  return readFileSync((await file.path())!);
}

/** Alex's Word reply: the figure is corrected and a reply is added to Jordan's thread. */
async function alexReplies(bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes);
  const docXml = await zip.file("word/document.xml")!.async("string");
  expect(docXml).toContain("grew 12%");
  zip.file("word/document.xml", docXml.replace("grew 12%", "grew 11.5%"));
  let comments = await zip.file("word/comments.xml")!.async("string");
  const root = /<w:comment\b([^>]*)>([\s\S]*?Is 12% right[\s\S]*?)<\/w:comment>/.exec(
    comments,
  );
  expect(root).toBeTruthy();
  const para = /w14:paraId="([^"]+)"/.exec(root![2])?.[1];
  expect(para).toBeTruthy();
  const ids = [...comments.matchAll(/\bw:id="(\d+)"/g)].map((match) => Number(match[1]));
  const id = Math.max(...ids) + 1;
  const replyPara = (id + 1).toString(16).toUpperCase().padStart(8, "0");
  comments = comments.replace(
    "</w:comments>",
    `<w:comment w:id="${id}" w:initials="A" w:author="Alex" w:date="2026-10-12T20:30:00.000Z"><w:p w14:paraId="${replyPara}" w14:textId="${replyPara}"><w:r><w:t>Yes, 11.5% — fixed</w:t></w:r></w:p></w:comment></w:comments>`,
  );
  zip.file("word/comments.xml", comments);
  const extended = await zip.file("word/commentsExtended.xml")!.async("string");
  zip.file(
    "word/commentsExtended.xml",
    extended.replace(
      "</w15:commentsEx>",
      `<w15:commentEx w15:paraId="${replyPara}" w15:paraIdParent="${para}" w15:done="0"/></w15:commentsEx>`,
    ),
  );
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

test("29-comment-on-a-document", async ({ page }) => {
  await openReport(page);
  await caption(page, "Jordan opens the quarterly report on their own computer.");
  await page.locator(".document-content").evaluate((el) => {
    const hit = [...el.querySelectorAll("p")].find((node) =>
      node.textContent?.includes("grew 12%"),
    );
    hit?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  await beat(page, 900);

  await caption(page, "They select “grew 12%” and press ⌘⌥M. The comment box is ready.");
  await selectPhrase(page, "grew 12%");
  await page.keyboard.press(`${mod}+Alt+KeyM`);
  const comment = page.getByRole("textbox", { name: "Comment" });
  await expect(comment).toBeFocused();
  await expect(page.locator(".comment-draft, .comment-anchor")).toHaveCount(1);
  await typeSlowly(page, "Is 12% right? Finance says 11.5%.");
  await beat(page, 400);
  await page.keyboard.press(`${mod}+Enter`);
  await caption(
    page,
    "The first comment on this computer asks for a name. Later comments reuse it.",
  );
  const name = page.getByRole("textbox", { name: "Your name" });
  await expect(name).toBeFocused();
  await typeSlowly(page, "Jordan");
  await page.keyboard.press(`${mod}+Enter`);
  const card = page.locator(".doc-comment-card", { hasText: "Is 12% right" });
  await expect(card).toContainText("Jordan");
  await expect(card).not.toContainText("Owner");
  await expect(card.locator("time")).toBeVisible();
  await expect(page.locator(".comment-anchor")).toHaveText("grew 12%");
  await caption(page, "⌘↩ posts it. The card shows Jordan, the time, and the question.", 1600);

  await caption(page, "The highlight stays with those words if you type before them…");
  await caret(page, "Revenue ", 8);
  await page.keyboard.type("X");
  await beat(page, 1200);
  await expect(page.locator(".comment-anchor")).toHaveText("grew 12%");
  await page.keyboard.press(`${mod}+z`);
  await caption(page, "…inside them…");
  await caret(page, "grew 12%", 5);
  await page.keyboard.type("Y");
  await beat(page, 1200);
  await expect(page.locator(".comment-anchor")).toContainText("Y");
  await page.keyboard.press(`${mod}+z`);
  await caption(page, "…or split the paragraph. Undo puts the sentence back.");
  await caret(page, "grew 12%", 4);
  await page.keyboard.press("Enter");
  await beat(page, 1200);
  await expect(page.locator(".comment-anchor")).toHaveCount(2);
  await page.keyboard.press(`${mod}+z`);
  await expect(page.locator(".comment-anchor")).toHaveText("grew 12%");

  await caption(page, "A second comment starts from the button beside the selection.");
  await selectPhrase(page, "Outlook for the rest of the year");
  await expect(page.getByRole("button", { name: "Add comment" })).toBeVisible();
  await page.getByRole("button", { name: "Add comment" }).click();
  await expect(page.getByRole("textbox", { name: "Your name" })).toHaveCount(0);
  await expect(comment).toBeFocused();
  await typeSlowly(page, "Can we shorten this?");
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator(".doc-comment-card", { hasText: "Can we shorten" })).toContainText(
    "Jordan",
  );
  await page.locator(".document-content h2", { hasText: "Results" }).evaluate((el) =>
    el.scrollIntoView({ behavior: "smooth", block: "center" }),
  );
  await showCards(page);

  await caption(page, "Jordan closes the file and opens it again. Both comments are still there.");
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 700);
  await page.getByRole("link", { name: "Quarterly Report" }).click();
  await expect(page.locator(".comment-anchor")).toHaveCount(2);
  await expect(page.locator(".doc-comment-card")).toHaveCount(2);
  await showCards(page);

  await caption(
    page,
    "File › Export DOCX. Word gets both threads, on the same words, signed Jordan.",
  );
  const firstDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const sent = await savedBytes(firstDownload);
  const sentZip = await JSZip.loadAsync(sent);
  const sentComments = await sentZip.file("word/comments.xml")!.async("string");
  const sentDoc = await sentZip.file("word/document.xml")!.async("string");
  expect(sentComments).toContain('w:author="Jordan"');
  expect(sentComments).toContain("Is 12% right? Finance says 11.5%.");
  expect(sentComments).toContain("Can we shorten this?");
  expect(sentComments).not.toContain("Owner");
  expect(sentDoc).toContain("grew 12%");
  expect(sentDoc).toContain("commentRangeStart");
  await beat(page, 900);

  await caption(
    page,
    "Alex replies in Word — “Yes, 11.5% — fixed” — corrects the figure, and sends the file back.",
    2200,
  );
  const replied = await alexReplies(sent);
  const replyPath = join(tmpdir(), "Quarterly Report from Alex.docx");
  writeFileSync(replyPath, replied);
  await page.getByRole("button", { name: "Back to files" }).click();
  await caption(page, "Jordan opens Alex's file.");
  await page.locator("input[type=file]").setInputFiles(replyPath);
  await expect(page.locator(".import-notes")).toContainText("2 comment threads imported");
  await expect(page.locator(".document-content")).toContainText("grew 11.5%");
  const thread = page.locator(".doc-comment-card", { hasText: "Is 12% right" });
  await expect(thread).toContainText("Alex");
  await expect(thread).toContainText("Yes, 11.5% — fixed");
  await showCards(page);
  await caption(page, "The reply is in the thread, and the import summary counts both.", 1800);

  await caption(page, "One click on the tick resolves it. The highlight goes, and the card says who closed it.");
  await thread.getByRole("button", { name: "Resolve" }).click();
  await expect(page.locator(".doc-comment-card.is-resolved")).toContainText("Resolved by Jordan");
  await expect(page.locator(".comment-anchor.is-resolved")).toBeVisible();
  await beat(page, 900);

  await caption(page, "Export again. The resolved thread is still in the Word file, marked done.");
  const secondDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const again = await JSZip.loadAsync(await savedBytes(secondDownload));
  const againComments = await again.file("word/comments.xml")!.async("string");
  const againExtended = await again.file("word/commentsExtended.xml")!.async("string");
  expect(againComments).toContain('w:author="Alex"');
  expect(againComments).toContain("Yes, 11.5% — fixed");
  expect(againComments).toContain("Can we shorten this?");
  expect(againExtended).toContain('w15:done="1"');
  await beat(page, 700);

  await caption(page, "Comments › Resolved is one click away. Reopen brings the thread back.");
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Open" })).toBeVisible();
  await page.getByRole("tab", { name: "Resolved" }).click();
  await page.getByRole("button", { name: "grew 11.5%" }).click();
  await beat(page, 700);
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(page.locator(".comment-anchor", { hasText: "grew 11.5%" })).toBeVisible();
  await expect(page.locator(".comment-anchor.is-resolved")).toHaveCount(0);
  await expect(thread).toContainText("Alex");
  await showCards(page);
  await caption(page, "The discussion is back on the sentence, still signed and still answered.", 1800);
});
