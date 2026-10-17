import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function snapshot(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}

async function newSheet(page: Page, rows: string[][]) {
  await page.goto("/");
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  await page.locator("[data-sheet-ready='true']").waitFor();
  const box = page.locator(".sheet-host input.univer-size-full");
  const select = async (ref: string) => {
    await box.fill(ref);
    await box.press("Enter");
  };
  for (const [r, row] of rows.entries()) {
    await select(`A${r + 1}`);
    for (const value of row) {
      await page.keyboard.type(value);
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter");
  }
  return select;
}

const cellsOf = (file: any) =>
  file.content.workbook.sheets[file.content.workbook.sheetOrder[0]].cellData;

test("Edit menu Paste special transposes a copied range and rewrites formulas", async ({
  page,
  context,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Clipboard permissions can only be granted in desktop Chromium.",
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const select = await newSheet(page, [
    ["1", "2", "=A1+B1"],
    ["3", "4", "=A2+B2"],
  ]);
  const shown = async (ref: string) => {
    await select(ref);
    return page.getByLabel("Spreadsheet grid").getAttribute("data-active-value");
  };
  await expect.poll(() => shown("C1")).toBe("3");
  await expect.poll(() => shown("C2")).toBe("7");

  const edit = async (item: string) => {
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("menuitem", { name: item }).click();
  };
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  await select("A1:C2");
  await edit("Copy");
  await expect.poll(clipboard).toMatch(/1\t2\t3/);

  await select("A4");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("menuitem", { name: "Paste special" }).click();
  await page.getByRole("menuitem", { name: "Transpose", exact: true }).click();

  const block = async () => {
    const cells = cellsOf(await snapshot(page));
    return {
      a1: cells[0]?.[0]?.v ?? null,
      b1: cells[0]?.[1]?.v ?? null,
      c1: cells[0]?.[2]?.f ?? null,
      c1v: cells[0]?.[2]?.v ?? null,
      a2: cells[1]?.[0]?.v ?? null,
      b2: cells[1]?.[1]?.v ?? null,
      c2: cells[1]?.[2]?.f ?? null,
      c2v: cells[1]?.[2]?.v ?? null,
      a4: cells[3]?.[0]?.v ?? null,
      b4: cells[3]?.[1]?.v ?? null,
      a5: cells[4]?.[0]?.v ?? null,
      b5: cells[4]?.[1]?.v ?? null,
      a6: cells[5]?.[0]?.f ?? null,
      a6v: cells[5]?.[0]?.v ?? null,
      b6: cells[5]?.[1]?.f ?? null,
      b6v: cells[5]?.[1]?.v ?? null,
    };
  };
  await expect.poll(block).toEqual({
    a1: 1,
    b1: 2,
    c1: "=A1+B1",
    c1v: 3,
    a2: 3,
    b2: 4,
    c2: "=A2+B2",
    c2v: 7,
    a4: 1,
    b4: 3,
    a5: 2,
    b5: 4,
    a6: "=A4+A5",
    a6v: 3,
    b6: "=B4+B5",
    b6v: 7,
  });

  await select("A4");
  await page.keyboard.type("10");
  await page.keyboard.press("Enter");
  // A6 is =A4+A5, so 10 replaces 1 and A5 stays 2. B6 is =B4+B5 and does not read A4.
  await expect.poll(block).toEqual({
    a1: 1,
    b1: 2,
    c1: "=A1+B1",
    c1v: 3,
    a2: 3,
    b2: 4,
    c2: "=A2+B2",
    c2v: 7,
    a4: 10,
    b4: 3,
    a5: 2,
    b5: 4,
    a6: "=A4+A5",
    a6v: 12,
    b6: "=B4+B5",
    b6v: 7,
  });
  expect(errors).toEqual([]);
});
