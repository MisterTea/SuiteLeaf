import { serializeFile } from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import { minutesDocument } from "../../../tests/odd-even-fixture";
import { askAgent, caption, describeRun, expect, test } from "../harness";

const PROMPT =
  'Minutes is open. Turn on different odd and even pages. Set the even header to Minutes and the odd header to Garden club. Put the page number on the outside: left on even pages and right on odd pages. Do not type the numbers into the header text. Page 1 stays the letterhead Riverside Garden Club, with no page number. Do not change the body. Call page_setup once with different_odd_even true, even_header "Minutes", and odd_header "Garden club". Do not copy Minutes onto the odd header. Do not pass header, first_header, different_first_page, footer, page_numbers, or page_number_position. Leave different odd and even on. Stop.';

function face(page: Page, index: number) {
  return page.locator(".page-furniture-page").nth(index);
}

async function savedSettings(page: Page) {
  const native = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve(open.result);
    });
    const rows = await new Promise<{ title?: string; native?: string }[]>((resolve, reject) => {
      const tx = db.transaction("encoded", "readonly");
      const request = tx.objectStore("encoded").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const row = rows.find((item) => item.title === "Minutes");
    if (!row?.native) throw new Error("Minutes was not saved");
    return row.native;
  });
  const saved = JSON.parse(native) as {
    content?: { attrs?: { pageSettings?: Record<string, unknown> } };
  };
  return saved.content?.attrs?.pageSettings ?? {};
}

test("62-odd-and-even-pages-ai", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Minutes.suiteleaf",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(minutesDocument())),
  });
  await expect(page.locator(".editor-status")).toContainText("4 pages");
  await expect(face(page, 0).locator(".page-header")).toHaveText("Riverside Garden Club");
  await expect(face(page, 0)).toHaveAttribute("data-number-side", "none");
  await expect(face(page, 1).locator(".page-header")).toHaveText("Garden club minutes");
  await expect(face(page, 1)).toHaveAttribute("data-number-side", "right");
  await expect(face(page, 1).locator(".page-number")).toHaveText("2 / 4");
  await expect(face(page, 2).locator(".page-header")).toHaveText("Garden club minutes");
  await expect(face(page, 2)).toHaveAttribute("data-number-side", "right");
  await expect(face(page, 2).locator(".page-number")).toHaveText("3 / 4");

  const editor = page.getByRole("textbox", { name: "Document content" });
  const before = await editor.evaluate((el) => el.textContent ?? "");
  await expect(editor).toContainText("This page keeps the club name.");
  await expect(editor).toContainText("Spring work is agreed.");
  await expect(editor).toContainText("Summer plans are agreed.");
  await expect(editor).toContainText("Extra notes for the club.");
  await caption(page, "Ben asks the on-device assistant for different odd and even pages.");

  const run = await askAgent(page, PROMPT);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.getByRole("dialog", { name: "Page setup" }), why).toBeHidden();
  await expect(page.getByRole("status"), why).toContainText("Saved");
  const settings = await savedSettings(page);
  expect(settings.differentOddEven, why).toBe(true);
  expect(settings.evenHeader, why).toBe("Minutes");
  expect(settings.oddHeader, why).toBe("Garden club");
  expect(settings.header, why).toBe("Garden club minutes");
  expect(settings.firstHeader, why).toBe("Riverside Garden Club");
  expect(settings.differentFirstPage, why).toBe(true);
  expect(settings.pageNumbers, why).toBe(true);

  await expect(face(page, 0).locator(".page-header"), why).toHaveText("Riverside Garden Club");
  await expect(face(page, 0), why).toHaveAttribute("data-number-side", "none");
  await expect(face(page, 0).locator(".page-number"), why).toHaveCount(0);
  await expect(face(page, 1).locator(".page-header"), why).toHaveText("Minutes");
  await expect(face(page, 1), why).toHaveAttribute("data-header-align", "left");
  await expect(face(page, 1), why).toHaveAttribute("data-number-side", "left");
  await expect(face(page, 1).locator(".page-number"), why).toHaveText("2 / 4");
  await expect(face(page, 2).locator(".page-header"), why).toHaveText("Garden club");
  await expect(face(page, 2), why).toHaveAttribute("data-header-align", "right");
  await expect(face(page, 2), why).toHaveAttribute("data-number-side", "right");
  await expect(face(page, 2).locator(".page-number"), why).toHaveText("3 / 4");
  await expect(face(page, 3).locator(".page-header"), why).toHaveText("Minutes");
  await expect(face(page, 3), why).toHaveAttribute("data-number-side", "left");

  expect(await editor.evaluate((el) => el.textContent ?? ""), why).toBe(before);

  await page.getByRole("button", { name: "Back to files" }).click();
  await expect(page.getByLabel("Search files")).toBeVisible();
  await page.getByRole("link", { name: "Minutes", exact: true }).click();
  await expect(page.locator(".editor-status")).toContainText("4 pages");
  const again = await savedSettings(page);
  expect(again.differentOddEven, why).toBe(true);
  expect(again.evenHeader, why).toBe("Minutes");
  expect(again.oddHeader, why).toBe("Garden club");
  expect(again.header, why).toBe("Garden club minutes");
  expect(again.firstHeader, why).toBe("Riverside Garden Club");
  await expect(face(page, 0).locator(".page-header"), why).toHaveText("Riverside Garden Club");
  await expect(face(page, 0), why).toHaveAttribute("data-number-side", "none");
  await expect(face(page, 1).locator(".page-header"), why).toHaveText("Minutes");
  await expect(face(page, 1), why).toHaveAttribute("data-number-side", "left");
  await expect(face(page, 1).locator(".page-number"), why).toHaveText("2 / 4");
  await expect(face(page, 2).locator(".page-header"), why).toHaveText("Garden club");
  await expect(face(page, 2), why).toHaveAttribute("data-number-side", "right");
  await expect(face(page, 2).locator(".page-number"), why).toHaveText("3 / 4");
  expect(await editor.evaluate((el) => el.textContent ?? ""), why).toBe(before);
});
