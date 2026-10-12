import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test("home shows the new-file cards in one row on a laptop screen", async ({ page }) => {
  await page.goto("/");
  const tops = await Promise.all(
    ["New document", "New spreadsheet", "New presentation"].map(
      async (name) => (await page.getByRole("button", { name }).boundingBox())!.y,
    ),
  );
  expect(new Set(tops).size).toBe(1);
});

test("docs toolbar fits one row, outline entries align left, indent works in lists", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click({ position: { x: 100, y: 80 } });

  const toolbar = page.getByRole("toolbar", { name: "Document formatting" });
  expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(40);
  for (const name of ["Page setup", "Page break"])
    await expect(toolbar.getByRole("button", { name, exact: true })).toBeVisible();

  await page.keyboard.type("Plan");
  await page.keyboard.press("Enter");
  await page.keyboard.type("A heading long enough that the outline panel has to shorten it");
  const style = page.getByRole("combobox", { name: "Paragraph style" });
  await style.selectOption({ label: "Heading 1" });
  await editor.getByText("Plan", { exact: true }).click();
  await style.selectOption({ label: "Heading 1" });

  const entries = page.locator(".outline-item-text");
  await expect(entries).toHaveCount(2);
  const short = await entries.first().evaluate((button) => {
    const range = document.createRange();
    range.selectNodeContents(button);
    return range.getBoundingClientRect().left - button.getBoundingClientRect().left;
  });
  expect(short).toBeLessThanOrEqual(16);
  const long = await entries.last().evaluate((b) => ({
    scroll: b.scrollWidth,
    client: b.clientWidth,
    overflow: getComputedStyle(b).textOverflow,
  }));
  expect(long.scroll).toBeGreaterThan(long.client);
  expect(long.overflow).toBe("ellipsis");

  const indent = toolbar.getByRole("button", { name: "Increase indent" });
  const outdent = toolbar.getByRole("button", { name: "Decrease indent" });
  await expect(indent).toBeDisabled();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Enter");
  await style.selectOption({ label: "Normal text" });
  await toolbar.getByRole("button", { name: "Bulleted list" }).click();
  await page.keyboard.type("Tomatoes");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Cherry");
  await indent.click();
  await expect(editor.locator("ul ul li")).toHaveText("Cherry");
  await outdent.click();
  await expect(editor.locator("ul ul")).toHaveCount(0);
  await expect(editor.locator("ul > li")).toHaveCount(2);
});
