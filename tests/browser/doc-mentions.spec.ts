import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";

const mod = process.platform === "darwin" ? "Meta" : "Control";

async function phraseBox(page: Page, phrase: string) {
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
      return { x: rect.x, y: rect.y, width: Math.max(4, rect.width), height: rect.height };
    }
    return null;
  }, phrase);
  expect(box, phrase).toBeTruthy();
  return box!;
}

async function selectPhrase(page: Page, phrase: string) {
  await page.locator(".document-content").evaluate((root, wanted) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if ((node.textContent ?? "").includes(wanted)) {
        (node.parentElement ?? root).scrollIntoView({ block: "center" });
        return;
      }
    }
  }, phrase);
  const box = await phraseBox(page, phrase);
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.max(2, box.width - 1), box.y + box.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
}

async function writeReport(page: Page) {
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await page.keyboard.insertText("Quarterly Report");
  await page.keyboard.press("Enter");
  for (let i = 0; i < 18; i += 1) {
    await page.keyboard.insertText(
      `Committee note ${i}. The south beds, the tool library, and the Saturday work party all need a line in this report before it goes to the board.`,
    );
    await page.keyboard.press("Enter");
  }
  await page.keyboard.insertText("Membership grew 12% this quarter after the spring fair.");
  await page.keyboard.press("Enter");
  for (let i = 0; i < 16; i += 1) {
    await page.keyboard.insertText(
      `Spending note ${i}. Timber, water, and the greenhouse fund stay in this section so the outlook stays further down the page.`,
    );
    await page.keyboard.press("Enter");
  }
  await page.keyboard.insertText("Outlook for the rest of the year");
  await page.keyboard.press("Enter");
}

async function commentOn(page: Page, phrase: string, write: () => Promise<void>) {
  await selectPhrase(page, phrase);
  await page.keyboard.press(`${mod}+Alt+KeyM`);
  const comment = page.getByRole("textbox", { name: "Comment" });
  await expect(comment).toBeFocused();
  await write();
  await page.keyboard.press(`${mod}+Enter`);
}

test("an @mention is stored apart from the sentence and opens on that person", async ({
  page,
}) => {
  test.setTimeout(120000);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.addInitScript(() => {
    localStorage.setItem("suiteleaf:display-name", "Jordan");
    localStorage.setItem("suiteleaf:known-names", JSON.stringify(["Jordan", "Alex"]));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByLabel("File title").fill("Quarterly Report");
  await writeReport(page);

  await commentOn(page, "grew 12%", async () => {
    const comment = page.getByRole("textbox", { name: "Comment" });
    await comment.pressSequentially("@A", { delay: 20 });
    await expect(page.locator(".doc-mention-list")).toHaveCount(0);
    await comment.pressSequentially("l", { delay: 20 });
    const alex = page.getByRole("option", { name: /^Alex/ });
    await expect(alex).toBeVisible();
    await expect(alex).toContainText("On this computer");
    await expect(page.locator(".doc-comment-card").getByRole("checkbox")).toHaveCount(0);
    await expect(page.locator(".doc-mention-list")).not.toContainText(/notify/i);
    await page.keyboard.press("Enter");
    await expect(comment.locator(".doc-mention")).toHaveText("Alex");
    await expect(comment).not.toContainText("@");
    await comment.pressSequentially("please check this", { delay: 10 });
  });
  await expect(page.locator(".doc-comment-card .doc-mention")).toHaveText("Alex");
  await expect(page.locator(".doc-comment-card")).toContainText("please check this");
  await expect(page.locator(".doc-comment-card.is-for-you")).toHaveCount(0);

  await commentOn(page, "Outlook for the rest of the year", async () => {
    await page.getByRole("textbox", { name: "Comment" }).pressSequentially("Can we shorten this?");
  });
  await expect(page.locator(".doc-comment-card")).toHaveCount(2);

  const suiteleaf = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await suiteleaf).path())!, "utf8"));
  const growth = saved.content.attrs.commentThreads.find(
    (thread: { quote: string }) => thread.quote === "grew 12%",
  );
  expect(growth.messages[0].text).toContain("please check this");
  expect(growth.messages[0].text).not.toContain("Alex");
  expect(growth.messages[0].mentions).toEqual([
    expect.objectContaining({ name: "Alex", at: 0 }),
  ]);
  expect(growth.messages[0].mentions[0].email).toBeUndefined();

  await page.getByRole("button", { name: "File", exact: true }).click();
  const docxEvent = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export DOCX", exact: true }).click();
  const docx = await docxEvent;
  const docxPath = join(await mkdtemp(join(tmpdir(), "mention-")), "Quarterly Report.docx");
  await writeFile(docxPath, await readFile((await docx.path())!));
  const comments = await (await JSZip.loadAsync(await readFile(docxPath)))
    .file("word/comments.xml")!
    .async("string");
  expect(comments).toContain("@Alex please check this");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Quarterly Report" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText("grew 12%");
  await page.waitForTimeout(900);
  expect(
    await page.locator(".document-stage").evaluate((el) => el.scrollTop),
  ).toBeLessThan(30);
  const hidden = await page.locator(".comment-anchor", { hasText: "grew 12%" }).boundingBox();
  expect(hidden === null || hidden.y > 780).toBeTruthy();

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.evaluate(() => localStorage.setItem("suiteleaf:display-name", "Alex"));
  await page.getByRole("link", { name: "Quarterly Report" }).click();
  await expect(page.locator(".doc-comment-card.is-for-you")).toContainText("For you");
  await expect(page.locator(".doc-comment-card.is-for-you .doc-mention")).toHaveText("Alex");
  await expect
    .poll(async () => {
      const box = await page.locator(".comment-anchor", { hasText: "grew 12%" }).boundingBox();
      return !!box && box.y > 40 && box.y < 740;
    })
    .toBe(true);
  const outlook = await page
    .locator(".document-content .comment-anchor", { hasText: "Outlook for the rest of the year" })
    .boundingBox();
  expect(outlook === null || outlook.y > 800 || outlook.y + outlook.height < 0).toBeTruthy();

  await page.getByRole("button", { name: "Back to files" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open / import" }).click();
  await (await chooser).setFiles(docxPath);
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText("grew 12%");
  await expect(page.locator(".doc-comment-card.is-for-you")).toContainText("For you");
  await expect
    .poll(async () => {
      const box = await page.locator(".comment-anchor", { hasText: "grew 12%" }).boundingBox();
      return !!box && box.y > 40 && box.y < 740;
    })
    .toBe(true);
  expect(requests.join("\n")).not.toMatch(/mailto:|smtp|\/mail|notify/i);
});

test("the first comment name is what @ matches, and a name with no account can be mentioned", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await page.keyboard.insertText("Please review the gate and the shed.");
  await selectPhrase(page, "the gate");
  await page.keyboard.press(`${mod}+Alt+KeyM`);
  const comment = page.getByRole("textbox", { name: "Comment" });
  await expect(comment).toBeFocused();
  await comment.fill("Check the latch.");
  await page.keyboard.press(`${mod}+Enter`);
  const name = page.getByRole("textbox", { name: "Your name" });
  await expect(name).toBeFocused();
  await name.fill("Jordan");
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator(".doc-comment-card")).toContainText("Jordan");
  expect(await page.evaluate(() => localStorage.getItem("suiteleaf:display-name"))).toBe("Jordan");

  await selectPhrase(page, "the shed");
  await page.keyboard.press(`${mod}+Alt+KeyM`);
  const again = page.getByRole("textbox", { name: "Comment" });
  await again.pressSequentially("@Jo", { delay: 20 });
  await expect(page.getByRole("option", { name: /^Jordan/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await selectPhrase(page, "the shed");
  await page.keyboard.press(`${mod}+Alt+KeyM`);
  const lee = page.getByRole("textbox", { name: "Comment" });
  await lee.pressSequentially("@Lee", { delay: 20 });
  const option = page.getByRole("option", { name: /^Lee/ });
  await expect(option).toBeVisible();
  await expect(option).toContainText("No account");
  await page.keyboard.press("Enter");
  await expect(lee.locator(".doc-mention")).toHaveText("Lee");
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator(".doc-mention", { hasText: "Lee" })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  const mention = saved.content.attrs.commentThreads
    .flatMap((thread: { messages: { mentions?: { name: string; accountId?: string }[] }[] }) =>
      thread.messages.flatMap((message) => message.mentions ?? []),
    )
    .find((item: { name: string }) => item.name === "Lee");
  expect(mention).toMatchObject({ name: "Lee" });
  expect(mention.accountId).toBeUndefined();
  expect(mention.email).toBeUndefined();
});
