import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

async function textFont(block: Locator) {
  return block.evaluate((el) => {
    const node = el.querySelector("span") ?? el;
    const style = getComputedStyle(node);
    return { family: style.fontFamily, size: style.fontSize };
  });
}

async function selectLine(page: Page, block: Locator) {
  await block.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
}

test("Normal text remembers the current font for new paragraphs and reopened files", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New document" }).click();
  await page.getByLabel("File title").fill("Style notes");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click({ position: { x: 100, y: 80 } });

  await page.keyboard.type("Chapter");
  const style = page.getByRole("combobox", { name: "Paragraph style" });
  await style.selectOption({ label: "Heading 1" });
  const heading = editor.locator("h1", { hasText: "Chapter" });
  await expect(heading).toBeVisible();

  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("First sentence.");
  const first = editor.locator("p", { hasText: "First sentence." });
  await selectLine(page, first);
  await page.getByRole("combobox", { name: "Font family" }).selectOption({ label: "Georgia" });
  const size = page.getByRole("textbox", { name: "Font size" });
  await size.fill("18");
  await expect(size).toHaveValue("18");
  const styled = await textFont(first);
  expect(styled.family).toContain("Georgia");

  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page.getByRole("menuitem", { name: "Update Normal text to match" }).click();
  await expect(editor).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second sentence.");
  const second = editor.locator("p", { hasText: "Second sentence." });
  await expect(second).toBeVisible();
  const secondFont = await textFont(second);
  expect(secondFont.family).toContain("Georgia");
  expect(secondFont.size).toBe(styled.size);

  const family = page.getByRole("combobox", { name: "Font family" });
  await heading.click();
  await expect(style).toHaveValue("1");
  await expect(family).toHaveValue("Arial");
  await expect(size).toHaveValue("20");
  const headingFont = await textFont(heading);
  expect(headingFont.family).toContain("Arial");
  expect(headingFont.family).not.toContain("Georgia");

  await second.click();
  await expect(style).toHaveValue("0");
  await expect(family).toHaveValue("Georgia");
  await expect(size).toHaveValue("18");

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Style notes" }).click();
  await expect(editor).toBeVisible();
  await expect(textFont(first)).resolves.toEqual(styled);
  await expect(textFont(second)).resolves.toEqual(secondFont);
  await expect(textFont(heading)).resolves.toEqual(headingFont);

  await heading.click();
  await expect(family).toHaveValue("Arial");
  await expect(size).toHaveValue("20");
  await second.click();
  await expect(family).toHaveValue("Georgia");
  await expect(size).toHaveValue("18");

  await second.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Third sentence.");
  const third = editor.locator("p", { hasText: "Third sentence." });
  await expect(third).toBeVisible();
  const thirdFont = await textFont(third);
  expect(thirdFont.family).toContain("Georgia");
  expect(thirdFont.size).toBe(styled.size);

  await heading.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("After the heading.");
  const afterHeading = editor.locator("p", { hasText: "After the heading." });
  await expect(afterHeading).toBeVisible();
  const adopted = await textFont(afterHeading);
  expect(adopted.family).toContain("Georgia");
  expect(adopted.size).toBe(styled.size);
  await expect(textFont(heading)).resolves.toEqual(headingFont);
});
