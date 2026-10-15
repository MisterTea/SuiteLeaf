import { askAgent, beat, caption, describeRun, expect, openApp, test } from "../harness";
import type { Page } from "@playwright/test";

async function makeFile(
  page: Page,
  kind: "document" | "spreadsheet" | "presentation",
  title: string,
  body?: string,
) {
  await page.getByRole("button", { name: `New ${kind}` }).click();
  const box = page.getByLabel("File title");
  await expect(box).toBeVisible();
  await box.fill(title);
  await expect(box).toHaveValue(title);
  if (body) {
    const editor = page.getByRole("textbox", { name: "Document content" });
    await editor.click();
    await editor.fill(body);
  }
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
}

const STARRED = ["Lasagne", "Weekly shopping", "Grandkids' birthdays", "Medication times"];
const GONE = ["Old grocery list", "2024 holiday cards", "Expired coupons"];

test("40-trash-star-and-restore-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Grace's paperwork is already in SuiteLeaf.");
  await makeFile(page, "document", "Lasagne", "Sunday lunch: pasta, ragu, and bechamel.");
  await makeFile(page, "document", "Weekly shopping");
  await makeFile(page, "spreadsheet", "Grandkids' birthdays");
  await makeFile(page, "document", "Medication times");
  await makeFile(page, "presentation", "Holiday slideshow");
  await makeFile(page, "document", "Old grocery list");
  await makeFile(page, "document", "2024 holiday cards");
  await makeFile(page, "document", "Expired coupons");

  await caption(page, "She asks the on-device assistant to star her weekly files, empty the old ones, and bring Lasagne back.");
  const run = await askAgent(
    page,
    "Star exactly these files: Lasagne, Weekly shopping, Grandkids' birthdays, and Medication times. Then move only these files to Trash and delete them forever: Old grocery list, 2024 holiday cards, and Expired coupons. Confirm when asked, and do that before you touch Lasagne. After those three are gone forever, move Lasagne to Trash and then restore it. It must stay starred and keep this text: Sunday lunch: pasta, ragu, and bechamel. Leave Holiday slideshow as it is. Do not change any file's text, and do not open a file.",
    {
      // Permanent delete must name the three old files and nothing she is keeping.
      allow:
        /^(?=.*Old grocery list)(?=.*2024 holiday cards)(?=.*Expired coupons)(?!.*Lasagne)(?!.*Weekly shopping)(?!.*Grandkids)(?!.*Medication times)(?!.*Holiday slideshow).*forever/is,
    },
  );
  const why = describeRun(run);
  expect(run.state, why).toBe("done");
  const calls = run.items.filter((item) => item.kind === "tool" && item.status === "ok");
  const mentioned = (name: string, title: string) =>
    calls.some((item) => item.name === name && JSON.stringify(item.args ?? "").includes(title));
  expect(mentioned("remove_file", "Lasagne"), why).toBe(true);
  expect(mentioned("restore_file", "Lasagne"), why).toBe(true);
  expect(
    run.approvals?.some(
      (approval) =>
        approval.allowed &&
        GONE.every((title) => approval.question.includes(title)) &&
        !STARRED.some((title) => approval.question.includes(title)) &&
        !approval.question.includes("Holiday slideshow"),
    ),
    why,
  ).toBe(true);

  const back = page.getByRole("button", { name: "Back to files" });
  if (await back.isVisible()) await back.click();
  const search = page.getByLabel("Search files");
  await expect(search, why).toBeVisible();
  if (await search.inputValue()) await page.getByRole("button", { name: "Clear search" }).click();
  const library = page.locator(".file-section");

  await page.getByRole("button", { name: "All files", exact: true }).click();
  for (const title of [...STARRED, "Holiday slideshow"])
    await expect(library.getByRole("link", { name: title, exact: true }), why).toBeVisible();
  for (const title of GONE)
    await expect(library.getByRole("link", { name: title, exact: true }), why).toHaveCount(0);

  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await expect(library.getByRole("heading", { name: "Starred" }), why).toBeVisible();
  await expect(library.locator(".file-row"), why).toHaveCount(4);
  for (const title of STARRED) {
    await expect(library.getByRole("link", { name: title, exact: true }), why).toBeVisible();
    await expect(library.getByRole("button", { name: `Unstar ${title}` }), why).toHaveAttribute("aria-pressed", "true");
  }

  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(library.getByRole("heading", { name: "Trash is empty" }), why).toBeVisible();
  for (const title of GONE) await expect(library.getByText(title, { exact: true }), why).toHaveCount(0);

  await page.getByRole("button", { name: "All files", exact: true }).click();
  await library.getByRole("link", { name: "Lasagne", exact: true }).click();
  await expect(page.getByLabel("File title"), why).toHaveValue("Lasagne");
  await expect(page.getByRole("textbox", { name: "Document content" }), why).toContainText(
    "Sunday lunch: pasta, ragu, and bechamel.",
  );
  await expect(page.locator(".workspace-header .star-btn"), why).toHaveAttribute("aria-pressed", "true");
  await caption(page, "The four weekly files are starred, Lasagne is back with its recipe, and Trash is empty.", 2000);
  await beat(page, 600);
});
