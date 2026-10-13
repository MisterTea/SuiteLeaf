import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";

test("01-first-document-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Sam asks SuiteLeaf's on-device assistant to start the garden plan.");
  const run = await askAgent(
    page,
    "Start a new document called Garden plan. At the top put the heading Spring planting, then this sentence: Tomatoes and basil go in the sunny bed after the last frost. Make the word last bold.",
  );
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(page.getByLabel("File title"), why).toHaveValue("Garden plan");
  await expect(editor.locator("h1"), why).toHaveText("Spring planting");
  await expect(editor, why).toContainText("Tomatoes and basil go in the sunny bed after the last frost.");
  await expect(editor.locator("strong"), why).toHaveText("last");
  await expect(page.locator(".outline"), why).toContainText("Spring planting");
  await caption(page, "Gemma made the document, the heading and the bold word. It saved itself on this device.", 2000);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: /Garden plan/ }).click();
  await expect(editor.locator("h1")).toHaveText("Spring planting");
  await expect(editor.locator("strong")).toHaveText("last");
  await caption(page, "Reopened from the library, everything is still there.", 1600);
  await beat(page, 600);
});
