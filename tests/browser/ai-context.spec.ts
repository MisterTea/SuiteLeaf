import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1400, height: 900 } });

test("opening or leaving a document closes the assistant and starts a new conversation", async ({
  page,
}) => {
  await page.addInitScript(() => sessionStorage.setItem("suiteleaf.ai.open", "1"));
  await page.goto("/");
  const panel = page.getByRole("complementary", { name: "AI assistant" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("No document open");
  await panel.getByRole("textbox").fill("Remember the file list");

  await page.getByRole("button", { name: "New document" }).click();
  await expect(page.getByLabel("File title")).toHaveValue("Untitled document");
  await expect(panel).toHaveCount(0);

  await page.getByRole("button", { name: "AI assistant" }).click();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Document “Untitled document”");
  await expect(panel.getByRole("textbox")).toHaveValue("");
  await expect(panel).not.toContainText("Remember the file list");

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByRole("button", { name: "New document" })).toBeVisible();
  await expect(panel).toHaveCount(0);
});
