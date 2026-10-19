import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const editorOf = (page: Page) => page.getByRole("textbox", { name: "Document content" });

const beforeGrowth = [
  "The garden club had a busy year. People came every week to work in the beds and to share the food they grew.",
  "Many homes had a plot. The list of people waiting to join got much smaller by the end of the summer.",
  "The team fixed the roof of the tool shed. Children from the school put flowers along the path.",
  "Plot fees brought in the money for water, wood, and the new tanks that hold rain.",
  "The big costs were the tanks, the water bill, and wood for the roof. The club kept some money for next year.",
  "Members gave a share of the food to the bank on the high street. Beans and fruit did well.",
  "A few members learned first aid. The plot lead left the role after many years, and the club said thank you.",
  "An easy bed near the gate is the first job next year, with one more place to turn soil by the shed.",
  "An open day each month will welcome people who may want to join. The spring meeting will set the dates.",
  "Notes from the summer meeting fill the next pages, so a comment on one line does not sit at the top.",
  "The west beds gave beans, fruit, and flowers. The east beds gave leaves and early potatoes.",
  "People signed up for the open days, and the school club came on the first Friday of each month.",
  "The tool shed has a new lock, a dry floor, and room for the chairs used at the meetings.",
  "Water from the tanks kept the beds green in the hot weeks, with no need for the hose.",
  "The fair in spring brought new members, and the food bank took a share of what was grown.",
  "Fees cover the wood, the water, and the glass. The town paid for the tanks.",
  "A map of the plots is on the shed door, with each name next to a bed.",
  "The rest of this report is the figure the board asked about, and then the outlook.",
];

const beforeOutlook = [
  "The money spent on wood, water, and the glass house is set out in the lines that follow.",
  "The box by the gate took in about the same money as last year.",
  "The corn did not do well in the wind and will move to a quiet bed. Soft fruit had its best year.",
  "New glass for the house is planned for two years from now, paid from the money kept back.",
  "People gave many hours. The week team and the school club did most of the hard work.",
  "The seed box gave out more than three hundred packs. Beans and early potatoes did well by the north fence.",
  "The town paid for most of the rain tanks. Plot fees paid for the rest of the costs.",
  "One more soil bay and the easy bed are the jobs the board will be asked to confirm.",
  "The report also notes the tools, the paths, and the water tanks from the summer work.",
  "A short note on the fair, the fees, and the food bank follows the figure for the board.",
  "The summer work, the shed, and the school visits are all part of the same story.",
  "The club will say more about the budget when the board meets, after this part of the report.",
  "The paths were fixed in June, and the gate lock was replaced in July.",
  "The shed now holds the new tools, and the beds by the gate are ready for spring.",
  "The club will meet again in spring to talk about the beds, the gate, and the new tools.",
  "Each bed had a name, and each name had a person who came most weeks.",
  "The water tanks were full by June, and the paths stayed dry after the rain.",
  "Fruit from the north fence went to the food bank every Saturday in August.",
  "The board will read this part before it turns to the last heading.",
  "A few more notes on the fees, the fair, and the school visits come first.",
];

async function paragraph(page: Page, text: string, delay = 0) {
  if (delay) await typeSlowly(page, text, delay);
  else await page.keyboard.insertText(text);
  await page.keyboard.press("Enter");
  if (!delay) await beat(page, 120);
}

async function scrollPhrase(page: Page, phrase: string) {
  await page.locator(".document-content").evaluate((root, wanted) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    const stage = root.closest(".document-stage");
    while ((node = walker.nextNode())) {
      if (!(node.textContent ?? "").includes(wanted) || !(stage instanceof HTMLElement)) continue;
      const el = node.parentElement ?? root;
      const delta =
        el.getBoundingClientRect().top -
        stage.getBoundingClientRect().top -
        stage.clientHeight * 0.28;
      stage.scrollTo({ top: Math.max(0, stage.scrollTop + delta), behavior: "smooth" });
      return;
    }
  }, phrase);
  await beat(page, 800);
}

async function selectPhrase(page: Page, phrase: string) {
  await scrollPhrase(page, phrase);
  const box = await page.locator(".document-content").evaluate((root, wanted) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      const start = text.indexOf(wanted);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + wanted.length);
      const rect = range.getClientRects()[0];
      if (!rect) return null;
      return { x: rect.x, y: rect.y, width: Math.max(8, rect.width), height: rect.height };
    }
    return null;
  }, phrase);
  expect(box, phrase).toBeTruthy();
  const view = page.viewportSize();
  if (
    box &&
    view &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.x < view.width &&
    box.y < view.height
  ) {
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
  }
  await page.locator(".document-content").evaluate((root, wanted) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? "";
      const start = text.indexOf(wanted);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + wanted.length);
      const selection = root.ownerDocument.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (root instanceof HTMLElement) root.focus();
      return;
    }
  }, phrase);
  await beat(page, 400);
}

async function stageTop(page: Page) {
  return page.locator(".document-stage").evaluate((el) => el.scrollTop);
}

test("49-mention-someone-in-a-comment", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.addInitScript(() => {
    localStorage.setItem("suiteleaf:display-name", "Jordan");
    localStorage.setItem("suiteleaf:known-names", JSON.stringify(["Jordan", "Alex"]));
  });
  await page.goto("/");
  await caption(
    page,
    "Jordan's name is already on this computer, and so is Alex. A mention is that name. Nobody is emailed.",
    2200,
  );

  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Quarterly Report");
  const editor = editorOf(page);
  await editor.click();
  await caption(page, "Jordan opens the quarterly report. It is already long.", 1200);
  await typeSlowly(page, "Quarterly Report", 28);
  await page.getByRole("combobox", { name: "Paragraph style" }).selectOption({ label: "Heading 1" });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowRight" : "End");
  await page.keyboard.press("Enter");
  for (const text of beforeGrowth) await paragraph(page, text);
  await typeSlowly(page, "Membership grew 12% this quarter after the spring fair.", 22);
  await page.keyboard.press("Enter");
  for (const text of beforeOutlook) await paragraph(page, text);
  await typeSlowly(page, "Outlook for the rest of the year", 22);
  await page.getByRole("combobox", { name: "Paragraph style" }).selectOption({ label: "Heading 2" });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowRight" : "End");
  await page.keyboard.press("Enter");
  await paragraph(page, "The club will bring a shorter form of this part to the board.", 18);
  await expect(page.getByRole("status")).toContainText("Saved");

  await caption(page, "One note is for Alex: is 12% right?", 1200);
  await selectPhrase(page, "grew 12%");
  await page.getByRole("button", { name: "Add comment" }).click();
  await scrollPhrase(page, "grew 12%");
  const comment = page.getByRole("textbox", { name: "Comment" });
  await expect(comment).toBeFocused();
  await expect(page.locator(".doc-comment-card")).toContainText("Commenting as Jordan");
  await caption(page, "Typing @ and two letters suggests Alex, a name stored on this computer.", 500);
  await typeSlowly(page, "@Al", 90);
  const alex = page.getByRole("option", { name: /^Alex/ });
  await expect(alex).toBeVisible();
  await expect(alex).toContainText("On this computer");
  await expect(page.locator(".doc-comment-card").getByRole("checkbox")).toHaveCount(0);
  await expect(page.locator(".doc-mention-list")).not.toContainText(/notify/i);
  await alex.hover();
  await beat(page, 700);
  await page.keyboard.press("Enter");
  await expect(comment.locator(".doc-mention")).toHaveText("Alex");
  await expect(comment).not.toContainText("@");
  await beat(page, 500);
  await caption(page, "Enter inserts Alex as a mention, not as ordinary letters. Then Jordan finishes the note.", 1600);
  await typeSlowly(page, "please check this", 28);
  await beat(page, 400);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  const card = page.locator(".doc-comment-card", { hasText: "please check this" });
  await expect(card.locator(".doc-mention")).toHaveText("Alex");
  await expect(card).not.toContainText("@");
  await expect(page.locator(".doc-comment-card.is-for-you")).toHaveCount(0);
  await beat(page, 900);

  await caption(page, "A second comment, on the outlook, names nobody.", 1200);
  await selectPhrase(page, "Outlook for the rest of the year");
  await page.getByRole("button", { name: "Add comment" }).click();
  await typeSlowly(page, "Can we make this shorter?", 28);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  await expect(page.locator(".doc-comment-card")).toHaveCount(2);
  await beat(page, 800);

  await caption(page, "Jordan exports a Word copy. Alex's name is in the comment.", 1400);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const docx = await download;
  const docxPath = join(mkdtempSync(join(tmpdir(), "mention-49-")), docx.suggestedFilename());
  await docx.saveAs(docxPath);
  const comments = await (await JSZip.loadAsync(readFileSync(docxPath)))
    .file("word/comments.xml")!
    .async("string");
  expect(comments).toContain("@Alex please check this");
  await caption(page, `Saved ${docx.suggestedFilename()}. The Word comment names Alex. No email was offered.`, 2200);

  await page.getByRole("button", { name: "Back to files" }).click();
  await caption(page, "Jordan closes the report and opens it again.", 1200);
  await page.getByRole("link", { name: "Quarterly Report" }).click();
  await expect(editorOf(page)).toContainText("grew 12%");
  await beat(page, 1000);
  expect(await stageTop(page)).toBeLessThan(30);
  await caption(page, "Still Jordan, so the page stays at the top. The comment for Alex is further down.", 2000);
  await caption(page, "Scrolling down, the mention is still Alex, stored apart from the sentence.", 400);
  await scrollPhrase(page, "grew 12%");
  await expect(page.locator(".doc-mention", { hasText: "Alex" })).toBeVisible();
  await expect(page.locator(".doc-comment-card.is-for-you")).toHaveCount(0);
  await beat(page, 1600);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.evaluate(() => localStorage.setItem("suiteleaf:display-name", "Alex"));
  await caption(page, "On Alex's computer the stored name is Alex. Alex opens the same file.", 1800);
  await page.getByRole("link", { name: "Quarterly Report" }).click();
  await expect(page.locator(".doc-comment-card.is-for-you")).toContainText("For you");
  await expect(page.locator(".doc-comment-card.is-for-you .doc-mention")).toHaveText("Alex");
  await expect
    .poll(async () => {
      const box = await page.locator(".comment-anchor", { hasText: "grew 12%" }).boundingBox();
      return !!box && box.y > 40 && box.y < 740;
    })
    .toBe(true);
  await beat(page, 900);
  await scrollPhrase(page, "grew 12%");
  await beat(page, 900);
  const mention = await page
    .locator(".document-content .comment-anchor", { hasText: "grew 12%" })
    .boundingBox();
  const outlook = await page
    .locator(".document-content .comment-anchor", { hasText: "Outlook for the rest of the year" })
    .boundingBox();
  expect(mention && mention.y > 40 && mention.y < 740).toBeTruthy();
  expect(!outlook || (mention !== null && outlook.y >= mention.y)).toBeTruthy();
  await beat(page, 800);
  await caption(
    page,
    "The report opens on the comment that names Alex, and the card is marked For you.",
    2800,
  );

  await page.getByRole("button", { name: "Back to files" }).click();
  await caption(page, "Alex opens the Word copy. The mention comes back, and the page lands on it again.", 1800);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles(docxPath);
  await expect(editorOf(page)).toContainText("grew 12%");
  await expect(page.locator(".doc-comment-card.is-for-you")).toContainText("For you");
  await expect(page.locator(".doc-comment-card.is-for-you .doc-mention")).toHaveText("Alex");
  await expect
    .poll(async () => {
      const box = await page.locator(".comment-anchor", { hasText: "grew 12%" }).boundingBox();
      return !!box && box.y > 40 && box.y < 740;
    })
    .toBe(true);
  await beat(page, 600);
  await caption(page, "Same landing, from the Word file. Nothing was emailed.", 2400);
  expect(requests.join("\n")).not.toMatch(/mailto:|smtp|\/mail|notify/i);
});
