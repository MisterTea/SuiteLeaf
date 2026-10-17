import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("a required grid names the question until every row is answered", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New form" }).click();
  await page.getByLabel("File title").fill("Day grid");
  await page.getByRole("tab", { name: "Questions" }).waitFor();

  await page.getByRole("button", { name: "Add question" }).click();
  await page.getByRole("textbox", { name: "Question", exact: true }).fill("Which days?");
  await page.getByLabel("Answer type for question 1").selectOption({ label: "Grid" });
  const rows = page.getByRole("textbox", { name: "Row" });
  await rows.nth(0).fill("Mon");
  await rows.nth(1).fill("Tue");
  const columns = page.getByRole("textbox", { name: "Column" });
  await columns.nth(0).fill("Yes");
  await columns.nth(1).fill("No");
  await page.getByRole("checkbox", { name: "Required" }).check();

  await page.getByRole("tab", { name: "Add a response" }).click();
  await expect(page.getByRole("radio", { name: "Mon Yes", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Tue No", exact: true })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Mon", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit response" }).click();
  await expect(page.getByRole("alert")).toHaveText("Which days? is required");

  await page.getByRole("tab", { name: "Responses" }).click();
  await expect(page.getByText("No one has signed up yet.")).toBeVisible();
  await expect(page.locator(".form-responses table")).toHaveCount(0);

  await page.getByRole("tab", { name: "Add a response" }).click();
  await page.getByRole("radio", { name: "Mon Yes", exact: true }).check();
  await page.getByRole("radio", { name: "Tue No", exact: true }).check();
  await page.getByRole("button", { name: "Submit response" }).click();
  await page.getByRole("tab", { name: "Responses" }).click();
  const table = page.locator(".form-responses table");
  await expect(table.locator("th")).toHaveText("Which days?");
  await expect(table.getByText("Mon: Yes", { exact: true })).toBeVisible();
  await expect(table.getByText("Tue: No", { exact: true })).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText("Saved");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: /Download SuiteLeaf file/ }).click();
  const download = await downloadPromise;
  const saved = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(saved.kind).toBe("form");
  expect(saved.content.questions[0]).toMatchObject({
    prompt: "Which days?",
    kind: "grid",
    required: true,
    rows: ["Mon", "Tue"],
    columns: ["Yes", "No"],
  });
  expect(saved.content.responses).toHaveLength(1);
  expect(JSON.parse(Object.values(saved.content.responses[0].answers)[0] as string)).toEqual({
    Mon: "Yes",
    Tue: "No",
  });

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Day grid", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Question", exact: true })).toHaveValue(
    "Which days?",
  );
  await expect(page.getByLabel("Answer type for question 1")).toHaveValue("grid");
  await expect(page.getByRole("checkbox", { name: "Required" })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Row" }).nth(0)).toHaveValue("Mon");
  await expect(page.getByRole("textbox", { name: "Row" }).nth(1)).toHaveValue("Tue");
  await expect(page.getByRole("textbox", { name: "Column" }).nth(0)).toHaveValue("Yes");
  await expect(page.getByRole("textbox", { name: "Column" }).nth(1)).toHaveValue("No");
  await page.getByRole("tab", { name: "Responses" }).click();
  await expect(page.locator(".form-responses").getByText("Mon: Yes", { exact: true })).toBeVisible();
  await expect(page.locator(".form-responses").getByText("Tue: No", { exact: true })).toBeVisible();
});
