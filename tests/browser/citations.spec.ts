import { test, expect } from "@playwright/test";
import { createFile, serializeFile, type JsonNode } from "../../packages/core/src";

const paragraph = (text: string): JsonNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

test("a citation stays linked when its year changes", async ({ page }) => {
  const file = createFile("doc", "Grant report 2026");
  if (file.kind !== "doc") throw new Error();
  file.content = {
    type: "doc",
    content: [
      paragraph("Attendance rose 40%"),
      paragraph("The extra coaching hours changed the season"),
    ],
  };
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "grant.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor.getByText("Attendance rose 40%")).toBeVisible();
  await editor.getByText("Attendance rose 40%").click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("menuitem", { name: "Citations" }).click();
  const panel = page.getByRole("complementary", { name: "Citations" });
  await expect(panel.getByRole("radio", { name: "APA" })).toBeChecked();
  await expect(panel.getByRole("radio", { name: "MLA" })).toBeVisible();
  await expect(panel.getByRole("radio", { name: "Chicago" })).toBeVisible();

  await panel.getByRole("button", { name: "Add citation source" }).click();
  await panel.getByRole("textbox", { name: "Author", exact: true }).fill("Mensah");
  await panel.getByRole("textbox", { name: "Title", exact: true }).fill("Youth football in Accra");
  await panel.getByRole("textbox", { name: "Year", exact: true }).fill("2024");
  await panel.getByRole("button", { name: "Add source" }).click();
  await panel.getByRole("button", { name: "Cite Mensah" }).click();
  const mensah = editor.getByRole("button", { name: "Citation Mensah, 2024" });
  await expect(mensah).toHaveText("(Mensah, 2024)");

  await panel.getByRole("button", { name: "Add citation source" }).click();
  await panel.getByRole("button", { name: "Article" }).click();
  await panel.getByRole("textbox", { name: "Author", exact: true }).fill("Boateng");
  await panel.getByRole("textbox", { name: "Title", exact: true }).fill("Coaching hours");
  await panel.getByRole("textbox", { name: "Year", exact: true }).fill("2023");
  await panel.getByRole("button", { name: "Add source" }).click();
  await editor.getByText("coaching hours changed").click();
  await page.keyboard.press("ControlOrMeta+ArrowRight");
  await panel.getByRole("button", { name: "Cite Boateng" }).click();
  await expect(editor.getByRole("button", { name: "Citation Boateng, 2023" })).toHaveText(
    "(Boateng, 2023)",
  );

  await panel.getByRole("button", { name: "Add citation source" }).click();
  await panel.getByRole("textbox", { name: "Author", exact: true }).fill("Adu");
  await panel.getByRole("textbox", { name: "Title", exact: true }).fill("Unused notes");
  await panel.getByRole("textbox", { name: "Year", exact: true }).fill("2020");
  await panel.getByRole("button", { name: "Add source" }).click();
  await expect(panel.getByText("Not cited")).toBeVisible();

  await editor.getByText("coaching hours changed").click();
  await page.keyboard.press("ControlOrMeta+ArrowDown");
  await panel.getByRole("button", { name: "Insert bibliography" }).click();
  const bibliography = editor.getByRole("region", { name: "References" });
  await expect(bibliography).toBeVisible();
  const entries = bibliography.locator(".doc-bib-entry");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Boateng");
  await expect(entries.nth(1)).toContainText("Mensah");
  await expect(bibliography).not.toContainText("Unused notes");
  await expect(bibliography).not.toContainText("#");

  await panel.getByRole("textbox", { name: "Year for Mensah" }).fill("2022");
  const mensahNow = editor.locator(".doc-citation").nth(0);
  await expect.poll(async () => mensahNow.innerText(), { timeout: 1000 }).toBe("(Mensah, 2022)");
  await expect(entries.nth(1)).toContainText("(2022)");

  await mensahNow.click();
  await expect(panel.locator(".doc-citation-source.is-selected")).toContainText("Mensah");

  await panel.getByRole("radio", { name: "MLA" }).click();
  await expect(editor.locator(".doc-citation").first()).toHaveText("(Mensah)");
  await expect(editor.getByRole("region", { name: "Works Cited" })).toBeVisible();
  await panel.getByRole("radio", { name: "Chicago" }).click();
  await expect(editor.locator(".doc-citation").first()).toHaveText("(Mensah 2022)");
  await panel.getByRole("radio", { name: "APA" }).click();
  await expect(editor.locator(".doc-citation").nth(0)).toHaveText("(Mensah, 2022)");

  await panel.getByRole("button", { name: "Remove" }).nth(2).click();
  await expect(panel.getByText("Unused notes")).toHaveCount(0);
  await expect(bibliography).toContainText("Mensah");
});
