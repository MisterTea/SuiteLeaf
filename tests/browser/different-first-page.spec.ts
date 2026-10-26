import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createFile, serializeFile, type DocFile } from "../../packages/core/src";

function minutes(): DocFile {
  const file = createFile("doc", "Minutes") as DocFile;
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        size: "letter",
        landscape: false,
        margin: 72,
        header: "Garden club minutes",
        footer: "",
        pageNumbers: true,
      },
    },
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "October meeting" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Present: Ben, Ruth, Marek, Asha and Joy. The committee agreed the budget for the rainwater tanks.",
          },
        ],
      },
      { type: "pageBreak" },
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Plot assignments" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Plots 1 to 12 are the north beds. Plots 13 to 30 are the south beds.",
          },
        ],
      },
    ],
  };
  return file;
}

async function openMinutes(page: Page) {
  const file = minutes();
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(page.locator(".page-header")).toHaveCount(2);
}

test("a different first page keeps the later header, hides page 1's number, and survives reopen", async ({
  page,
}) => {
  await openMinutes(page);
  const headers = page.locator(".page-header");
  await expect(headers.nth(0)).toHaveText("Garden club minutes");
  await expect(headers.nth(1)).toHaveText("Garden club minutes");
  await expect(page.locator(".page-number")).toHaveText(["1 / 2", "2 / 2"]);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup.getByLabel("Page header")).toHaveValue("Garden club minutes");
  await expect(setup.getByLabel("Page numbers")).toBeChecked();
  const different = setup.getByLabel("Different first page");
  await expect(different).not.toBeChecked();
  await different.check();
  await expect(setup.getByLabel("First page header")).toHaveValue("");
  await expect(setup.getByLabel("First page footer")).toHaveValue("");
  await expect(setup.getByText("Page 1 has no number. Page 2 shows 2.")).toBeVisible();
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(setup).toBeHidden();
  await expect(headers.nth(0)).toHaveText("");
  await expect(headers.nth(1)).toHaveText("Garden club minutes");
  await expect(page.locator(".page-furniture-page").nth(0).locator(".page-number")).toHaveCount(0);
  await expect(page.locator(".page-furniture-page").nth(1).locator(".page-number")).toHaveText("2 / 2");

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await setup.getByLabel("First page header").fill("Riverside Garden Club");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(headers.nth(0)).toHaveText("Riverside Garden Club");
  await expect(headers.nth(1)).toHaveText("Garden club minutes");
  await expect(page.locator(".page-furniture-page").nth(0).locator(".page-number")).toHaveCount(0);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(saved.content.attrs.pageSettings).toMatchObject({
    header: "Garden club minutes",
    firstHeader: "Riverside Garden Club",
    firstFooter: "",
    differentFirstPage: true,
    pageNumbers: true,
  });

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.locator(".editor-status")).toContainText("2 pages");
  await expect(headers.nth(0)).toHaveText("Riverside Garden Club");
  await expect(headers.nth(1)).toHaveText("Garden club minutes");
  await expect(page.locator(".page-furniture-page").nth(1).locator(".page-number")).toHaveText("2 / 2");

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await different.focus();
  await page.keyboard.press("Space");
  await expect(different).not.toBeChecked();
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(headers.nth(0)).toHaveText("Garden club minutes");
  await expect(headers.nth(1)).toHaveText("Garden club minutes");
  await expect(page.locator(".page-number")).toHaveText(["1 / 2", "2 / 2"]);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  await different.check();
  await expect(setup.getByLabel("First page header")).toHaveValue("Riverside Garden Club");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(headers.nth(0)).toHaveText("Riverside Garden Club");
  await expect(headers.nth(1)).toHaveText("Garden club minutes");
  await expect(page.locator(".page-furniture-page").nth(0).locator(".page-number")).toHaveCount(0);
  await expect(page.locator(".page-furniture-page").nth(1).locator(".page-number")).toHaveText("2 / 2");
});
