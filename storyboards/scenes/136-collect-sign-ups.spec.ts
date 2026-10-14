import { readFileSync } from "node:fs";
import { beat, caption, expect, test, typeSlowly } from "./harness";

test("136-collect-sign-ups", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Maya is at the garden club table with her laptop.");
  await page.getByRole("button", { name: "New form" }).click();
  const title = page.getByLabel("File title");
  await expect(title).toBeVisible();
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "Plot sign-ups");
  await expect(page.getByRole("tab", { name: "Questions" })).toBeVisible();
  await caption(page, "A new form. The questions and the answers will stay in this file.", 1600);

  await caption(page, "Your name is required.", 800);
  await page.getByRole("button", { name: "Add question" }).click();
  const prompts = page.getByRole("textbox", { name: "Question", exact: true });
  await prompts.first().fill("Your name");
  await page.getByRole("checkbox", { name: "Required" }).check();

  await caption(page, "Plot size is one choice, and it is required too.", 800);
  await page.getByRole("button", { name: "Add question" }).click();
  await prompts.nth(1).fill("Plot size");
  await page.getByLabel("Answer type for question 2").selectOption("choice");
  const choices = page.getByLabel("Choice");
  await choices.nth(0).fill("Small");
  await page.getByRole("button", { name: "Add choice" }).click();
  await choices.nth(1).fill("Medium");
  await page.getByRole("button", { name: "Add choice" }).click();
  await choices.nth(2).fill("Large");
  await page.getByRole("checkbox", { name: "Required" }).nth(1).check();

  await caption(page, "Notes are optional.", 800);
  await page.getByRole("button", { name: "Add question" }).click();
  await prompts.nth(2).fill("Notes");

  await caption(page, "Rosa skips the plot size.", 900);
  await page.getByRole("tab", { name: "Add a response" }).click();
  await page.getByLabel("Your name").fill("Rosa");
  await page.getByRole("button", { name: "Submit response" }).click();
  await expect(page.getByRole("alert")).toHaveText("Plot size is required");
  await page.getByRole("tab", { name: "Responses" }).click();
  await expect(page.getByText("No one has signed up yet.")).toBeVisible();
  await caption(page, "The form names the missing question, and Rosa is not on the list.", 1600);

  await page.getByRole("tab", { name: "Add a response" }).click();
  await page.getByRole("radio", { name: "Medium" }).check();
  await page.getByLabel("Notes").fill("Needs a sunny spot");
  await page.getByRole("button", { name: "Submit response" }).click();
  await expect(page.getByLabel("Your name")).toHaveValue("");
  await caption(page, "Rosa chooses Medium and a sunny spot. The form clears for the next person.", 1500);

  await page.getByRole("tab", { name: "Responses" }).click();
  const table = page.locator(".form-responses table");
  await expect(table).toContainText("Rosa");
  await expect(table).toContainText("Medium");
  await expect(table).toContainText("Needs a sunny spot");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await caption(page, "Her row is already here. She did not open another file.", 1600);

  await page.getByRole("tab", { name: "Add a response" }).click();
  await page.getByLabel("Your name").fill("Leo");
  await page.getByRole("radio", { name: "Small" }).check();
  await page.getByRole("button", { name: "Submit response" }).click();
  await page.getByRole("tab", { name: "Responses" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table).toContainText("Leo");
  await expect(table).toContainText("Small");
  await caption(page, "Leo takes a small plot. Two rows, still this file.", 1500);

  await page.getByRole("tab", { name: "Questions" }).click();
  await expect(prompts.nth(0)).toHaveValue("Your name");
  await expect(prompts.nth(1)).toHaveValue("Plot size");
  await expect(prompts.nth(2)).toHaveValue("Notes");

  await caption(page, "She downloads the file. The questions and both sign-ups come with it.", 1200);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: /Download SuiteLeaf file/ }).click();
  const download = await downloadPromise;
  const saved = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(saved.kind).toBe("form");
  expect(saved.content.questions.map((q: { prompt: string }) => q.prompt)).toEqual([
    "Your name",
    "Plot size",
    "Notes",
  ]);
  const rows = saved.content.responses.map(
    (r: { answers: Record<string, string> }) => Object.values(r.answers),
  );
  expect(rows[0]).toEqual(expect.arrayContaining(["Rosa", "Medium", "Needs a sunny spot"]));
  expect(rows[1]).toEqual(expect.arrayContaining(["Leo", "Small"]));
  await beat(page, 800);
});
