import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function sheet(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await page.locator("[data-sheet-ready='true']").waitFor();
}

async function goTo(page: Page, ref: string) {
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill(ref);
  await box.press("Enter");
}

async function download(page: Page) {
  const promise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await promise).path())!, "utf8"));
}

test("function help, summaries, and sum stay out of the way", async ({ page }) => {
  const popups: string[] = [];
  page.on("popup", (popup) => popups.push(popup.url()));
  await sheet(page);

  await goTo(page, "B2");
  for (const value of ["10", "20", "30"]) {
    await page.keyboard.type(value);
    await page.keyboard.press("Enter");
  }
  await goTo(page, "C2");
  for (const value of ["4", "5", "6"]) {
    await page.keyboard.type(value);
    await page.keyboard.press("Enter");
  }

  await goTo(page, "B2:B4");
  const summary = page.getByRole("status", { name: "Selection summary" });
  await expect(summary).toContainText("Sum 60");
  await expect(summary).toContainText("Average 20");
  await expect(summary).toContainText("Min 10");
  await expect(summary).toContainText("Max 30");
  await expect(summary).toContainText("Count 3");
  await page.locator('[data-stat="average"]').click();

  await goTo(page, "B2");
  await page.getByRole("button", { name: "Functions", exact: true }).click();
  await expect(page.getByText("already has a value")).toBeVisible();

  await goTo(page, "C2:C4");
  await page.getByRole("button", { name: "Functions", exact: true }).click();

  await goTo(page, "D2");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Function" }).click();
  await page.locator(".function-menu").getByRole("menuitem", { name: "SUM", exact: true }).click();
  const help = page.locator("[data-function-help]");
  await expect(help).toHaveAttribute("data-function", "SUM");
  await expect(help.locator("[data-example]")).not.toHaveText("");
  await page.keyboard.press("Escape");

  await goTo(page, "E2");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await page.getByRole("menuitem", { name: "Function" }).click();
  const search = page.getByRole("textbox", { name: "Search functions" });
  await search.click();
  await search.pressSequentially("if a condition");
  await expect(page.locator('[data-function-name="IF"]')).toContainText(
    "Returns one value if a condition is true and another if it's false",
  );
  await search.fill("");
  await search.pressSequentially("count matching");
  const countNames = await page.locator(".function-menu [data-function-name]").evaluateAll((nodes) =>
    nodes.slice(0, 3).map((node) => node.getAttribute("data-function-name")),
  );
  expect(countNames).toContain("COUNTIF");
  await search.fill("");
  await search.pressSequentially("look up a value");
  const lookup = await page.locator(".function-menu [data-function-name]").evaluateAll((nodes) =>
    nodes.slice(0, 3).map((node) => node.getAttribute("data-function-name")),
  );
  expect(lookup.some((name) => name === "XLOOKUP" || name === "VLOOKUP")).toBe(true);
  await page.locator('[data-function-name="IF"]').click();

  await expect(help.locator("[data-current='true']")).toHaveText("logical_expression");
  await page.keyboard.type("1>0");
  await expect(help.locator("[data-current='true']")).toHaveText("logical_expression");
  await page.evaluate(() => {
    const panel = document.querySelector("[data-function-help]")!;
    const mark = { ms: -1 };
    (window as unknown as { __helpMark: { ms: number } }).__helpMark = mark;
    const start = performance.now();
    const observer = new MutationObserver(() => {
      if (panel.querySelector("[data-current='true']")?.textContent === "value_if_true") {
        mark.ms = performance.now() - start;
        observer.disconnect();
      }
    });
    observer.observe(panel, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
  await page.keyboard.type(",", { delay: 0 });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __helpMark: { ms: number } }).__helpMark.ms))
    .toBeGreaterThanOrEqual(0);
  expect(
    await page.evaluate(() => (window as unknown as { __helpMark: { ms: number } }).__helpMark.ms),
  ).toBeLessThan(100);

  const panelBox = (await help.boundingBox())!;
  const gridTop = await page.locator(".sheet-host canvas").evaluateAll((nodes) =>
    Math.min(
      ...nodes.map((node) =>
        node.getBoundingClientRect().height > 80 ? node.getBoundingClientRect().top : Infinity,
      ),
    ),
  );
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(gridTop + 1);

  await page.getByRole("button", { name: "Hide function help" }).click();
  const url = page.url();
  await page.keyboard.press("F1");
  await expect(help).toHaveAttribute("data-collapsed", "false");
  expect(page.url()).toBe(url);
  expect(popups).toEqual([]);
  await page.getByRole("button", { name: "Hide function help" }).click();
  await expect(help).toHaveAttribute("data-collapsed", "true");
  await page.keyboard.press("Escape");

  await goTo(page, "F2");
  await page.keyboard.type("=su");
  const suggestions = page.locator('ul[data-u-comp="sheets-formula-editor"] li');
  await expect(suggestions.first()).toContainText("SUM");
  const descriptions = await suggestions.evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector("span:last-child")?.textContent?.trim() ?? ""),
  );
  expect(descriptions.length).toBeGreaterThan(0);
  expect(descriptions.every((text) => text.length > 0)).toBe(true);
  await page.keyboard.press("Escape");

  const saved = await download(page);
  const cells = saved.content.workbook.sheets[saved.content.workbook.sheetOrder[0]].cellData;
  expect(cells[4][1].f).toBe("=AVERAGE(B2:B4)");
  expect(cells[1][1].v).toBe(10);
  expect(cells[4][2].f).toBe("=SUM(C2:C4)");
  expect(cells[1][2].v).toBe(4);

  await page.reload();
  await sheet(page);
  await goTo(page, "A1");
  await page.keyboard.type("=SUM(");
  await expect(page.locator("[data-function-help]")).toHaveAttribute("data-collapsed", "true");
});
