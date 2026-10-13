import { expect, test, type Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";

const body = "The harvest supper is Saturday. Bring a dish to share.";

function minutesFile() {
  const file = createFile("doc", "Minutes");
  if (file.kind !== "doc") throw new Error("expected a document");
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
            text: "Present: Ben, Ruth, Marek, and Asha. The club agreed to mulch the beds.",
          },
        ],
      },
      { type: "pageBreak" },
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Decisions" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: body }],
      },
    ],
  };
  return file;
}

async function openMinutes(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutesFile())),
  });
  await expect(page.locator(".editor-status")).toContainText("2 pages");
}

test("double-click edits the header and footer on the page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack || e.message));
  await openMinutes(page);
  const editor = page.getByRole("textbox", { name: "Document content" });
  const page1 = page.locator(".page-furniture-page").nth(0);
  const page2 = page.locator(".page-furniture-page").nth(1);
  await expect(page2.locator(".page-header")).toHaveText("Garden club minutes");
  await expect(page2.locator(".page-number")).toHaveText("2 / 2");

  await page2.locator(".page-header").dblclick();
  const header = page.getByRole("textbox", { name: "Header for every page" });
  await expect(header).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Page setup" })).toHaveCount(0);
  await expect(page.locator(".paginated-paper")).toHaveClass(/is-editing-furniture/);
  await expect(page.locator(".page-furniture-scope")).toHaveText("Header · all pages");
  const opacity = await page.locator(".document-content").evaluate((el) =>
    Number(getComputedStyle(el).opacity),
  );
  expect(opacity).toBeLessThan(0.6);
  await header.fill("October minutes");
  await expect(header).toHaveValue("October minutes");
  await expect(page1.locator(".page-header")).toHaveText("October minutes");
  await expect(editor).toContainText(body);

  await page2.locator(".page-footer").click();
  const footer = page.getByRole("textbox", { name: "Footer for every page" });
  await expect(footer).toBeFocused();
  await expect(footer).toHaveValue("");
  await expect(page2.locator(".page-number")).toHaveText("2 / 2");
  await footer.fill("Draft");
  await expect(footer).toHaveValue("Draft");
  await expect(page2.locator(".page-number")).toHaveText("2 / 2");
  expect(await footer.inputValue()).not.toContain("2 / 2");

  await page.keyboard.press("Escape");
  await expect(header).toHaveCount(0);
  await expect(footer).toHaveCount(0);
  await expect(page.locator(".paginated-paper")).not.toHaveClass(/is-editing-furniture/);
  await expect(page2.locator(".page-header")).toHaveText("October minutes");
  await expect(page2.locator(".page-footer")).toContainText("Draft");
  await expect(page2.locator(".page-number")).toHaveText("2 / 2");
  await expect(editor).toContainText(body);

  await page2.locator(".page-header").dblclick();
  await expect(header).toBeFocused();
  await page.getByText(body).click();
  await expect(header).toHaveCount(0);
  await expect(page.locator(".paginated-paper")).not.toHaveClass(/is-editing-furniture/);
  await expect(editor).toContainText(body);

  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Minutes" }).click();
  await expect(page.locator(".page-header").nth(1)).toHaveText("October minutes");
  await expect(page.locator(".page-footer").nth(1)).toContainText("Draft");
  await expect(page.locator(".page-number").nth(1)).toHaveText("2 / 2");
  await expect(editor).toContainText(body);

  await page.getByRole("button", { name: "Page setup", exact: true }).click();
  const setup = page.getByRole("dialog", { name: "Page setup" });
  await expect(setup.getByLabel("Page header")).toHaveValue("October minutes");
  await expect(setup.getByLabel("Page footer")).toHaveValue("Draft");
  await setup.getByLabel("Page header").fill("From page setup");
  await setup.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.locator(".page-header").first()).toHaveText("From page setup");
  await page.locator(".page-header").first().dblclick();
  await expect(page.getByRole("textbox", { name: "Header for every page" })).toHaveValue(
    "From page setup",
  );
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("Enter on the header opens the editor from the keyboard", async ({ page }) => {
  await openMinutes(page);
  await page.getByRole("button", { name: "Edit header, all pages" }).focus();
  await page.keyboard.press("Enter");
  const header = page.getByRole("textbox", { name: "Header for every page" });
  await expect(header).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(header).toHaveCount(0);
});
