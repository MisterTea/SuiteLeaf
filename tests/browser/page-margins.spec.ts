import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createFile, serializeFile } from "../../packages/core/src";

/** A tenth of an inch, in CSS pixels. Body text must land inside this. */
const tenth = 9.6;

function minutesFile() {
  const file = createFile("doc", "Council minutes");
  if (file.kind !== "doc") throw new Error();
  const line = (text: string) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });
  file.content = {
    type: "doc",
    attrs: { pageSettings: { margin: 96 } },
    content: [
      line("Town council minutes"),
      ...Array.from({ length: 48 }, (_, i) =>
        line(
          `Item ${i + 1}. The council reviewed the letterhead, the hearing, and the budget for the hall.`,
        ),
      ),
    ],
  };
  return file;
}

async function openMinutes(page: Page) {
  const file = minutesFile();
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "Town council minutes",
  );
}

async function insets(page: Page) {
  return page.evaluate(() => {
    const paper = document.querySelector(".paginated-paper") as HTMLElement;
    const content = document.querySelector(".document-content") as HTMLElement;
    const first = content.querySelector("p") as HTMLElement;
    const zoom = Number(paper.style.zoom) || 1;
    const paperBox = paper.getBoundingClientRect();
    const line = first.getBoundingClientRect();
    const style = getComputedStyle(content);
    const pageHeight = parseFloat(paper.style.getPropertyValue("--page-height"));
    const pageBottom = paperBox.top + pageHeight * zoom;
    const range = document.createRange();
    range.selectNodeContents(content);
    const lines = [...range.getClientRects()].filter(
      (rect) =>
        rect.height > 2 &&
        rect.top >= paperBox.top - 1 &&
        rect.bottom <= pageBottom + 1,
    );
    const last = lines.reduce((best, rect) =>
      rect.bottom > best.bottom ? rect : best,
    );
    return {
      top: (line.top - paperBox.top) / zoom,
      left: (line.left - paperBox.left) / zoom,
      right: (paperBox.right - line.right) / zoom,
      padTop: parseFloat(style.paddingTop),
      padRight: parseFloat(style.paddingRight),
      padBottom: parseFloat(style.paddingBottom),
      padLeft: parseFloat(style.paddingLeft),
      lastToBottom: (pageBottom - last.bottom) / zoom,
      lastToTop: (last.top - paperBox.top) / zoom,
    };
  });
}

test("each page margin is independent, kept, and refused outside 0.25 to 3 inches", async ({
  page,
}) => {
  await openMinutes(page);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  const top = setup.getByLabel("Top margin");
  const bottom = setup.getByLabel("Bottom margin");
  const left = setup.getByLabel("Left margin");
  const right = setup.getByLabel("Right margin");
  await expect(top).toHaveValue("1");
  await expect(bottom).toHaveValue("1");
  await expect(left).toHaveValue("1");
  await expect(right).toHaveValue("1");

  await top.fill("1.5");
  await expect(bottom).toHaveValue("1");
  await expect(left).toHaveValue("1");
  await expect(right).toHaveValue("1");
  await expect(setup.getByRole("img", { name: /Top 1\.5 in/ })).toBeVisible();
  await bottom.fill("0.75");
  await left.fill("1");
  await right.fill("0.75");
  await expect(top).toHaveValue("1.5");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();

  const box = await insets(page);
  expect(box.top).toBeGreaterThan(144 - tenth);
  expect(box.top).toBeLessThan(144 + tenth);
  expect(box.left).toBeGreaterThan(96 - tenth);
  expect(box.left).toBeLessThan(96 + tenth);
  expect(box.right).toBeGreaterThan(72 - tenth);
  expect(box.right).toBeLessThan(72 + tenth);
  expect(box.padBottom).toBeGreaterThan(72 - tenth);
  expect(box.padBottom).toBeLessThan(72 + tenth);
  expect(box.left).toBeGreaterThan(box.right);
  expect(box.lastToBottom).toBeLessThan(box.lastToTop);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await top.fill("0");
  await expect(setup.getByRole("alert")).toHaveText(
    "A margin must be at least 0.25 inches.",
  );
  const apply = setup.getByRole("button", { name: "Apply", exact: true });
  await expect(apply).toBeDisabled();
  await top.press("Enter");
  await expect(setup).toBeVisible();
  await top.fill("4");
  await expect(setup.getByRole("alert")).toHaveText(
    "A margin must be at most 3 inches.",
  );
  await expect(apply).toBeDisabled();
  await setup.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(page.getByRole("status")).toContainText("Saved");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(saved.content.attrs.pageSettings).toMatchObject({
    top: 144,
    bottom: 72,
    left: 96,
    right: 72,
  });
  expect(saved.content.attrs.pageSettings.top).not.toBe(0);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Council minutes" }).click();
  await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
    "Town council minutes",
  );
  const again = await insets(page);
  expect(again.top).toBeGreaterThan(144 - tenth);
  expect(again.top).toBeLessThan(144 + tenth);
  expect(again.left).toBeGreaterThan(96 - tenth);
  expect(again.padBottom).toBeGreaterThan(72 - tenth);
  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await expect(top).toHaveValue("1.5");
  await expect(bottom).toHaveValue("0.75");
  await expect(left).toHaveValue("1");
  await expect(right).toHaveValue("0.75");
});
