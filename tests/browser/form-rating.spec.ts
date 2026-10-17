import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("a required rating is named when missing, then kept as 4", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New form" }).click();
  await page.getByLabel("File title").fill("Talk feedback");
  await page.getByRole("tab", { name: "Questions" }).waitFor();

  await page.getByRole("button", { name: "Add question" }).click();
  await page.getByRole("textbox", { name: "Question", exact: true }).fill("How was the talk?");
  await page.getByLabel("Answer type for question 1").selectOption({ label: "Rating" });
  await page.getByRole("checkbox", { name: "Required" }).check();

  await page.getByRole("tab", { name: "Add a response" }).click();
  await expect(page.getByRole("radio", { name: "1" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "5" })).toBeVisible();
  await expect(page.getByText("How was the talk?")).toBeVisible();
  await page.getByRole("button", { name: "Submit response" }).click();
  await expect(page.getByRole("alert")).toHaveText("How was the talk? is required");

  await page.getByRole("tab", { name: "Responses" }).click();
  await expect(page.getByText("No one has signed up yet.")).toBeVisible();
  await expect(page.locator(".form-responses table")).toHaveCount(0);

  await page.getByRole("tab", { name: "Add a response" }).click();
  await page.getByRole("radio", { name: "4" }).check();
  await page.getByRole("button", { name: "Submit response" }).click();
  await page.getByRole("tab", { name: "Responses" }).click();
  const table = page.locator(".form-responses table");
  await expect(table.locator("th")).toHaveText("How was the talk?");
  await expect(table.locator("tbody td")).toHaveText("4");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText("Saved");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: /Download SuiteLeaf file/ }).click();
  const download = await downloadPromise;
  const saved = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(saved.kind).toBe("form");
  expect(saved.content.questions[0]).toMatchObject({
    prompt: "How was the talk?",
    kind: "rating",
    required: true,
  });
  expect(saved.content.responses).toHaveLength(1);
  expect(Object.values(saved.content.responses[0].answers)).toEqual(["4"]);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Talk feedback", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Question", exact: true })).toHaveValue(
    "How was the talk?",
  );
  await expect(page.getByLabel("Answer type for question 1")).toHaveValue("rating");
  await expect(page.getByRole("checkbox", { name: "Required" })).toBeChecked();
  await page.getByRole("tab", { name: "Responses" }).click();
  await expect(page.locator(".form-responses tbody td")).toHaveText("4");
});
