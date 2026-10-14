import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const logo = join(tmpdir(), "suiteleaf-arrange-logo.png");
writeFileSync(
  logo,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC",
    "base64",
  ),
);

async function newDeck(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New presentation" }).click();
  await expect(page.locator(".slides-editor")).toBeVisible();
  await page.locator(".thumbnails-list").click();
}

const menuBar = (page: Page) => page.locator(".file-menu");

const named = (label: string) =>
  new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`);

async function choose(
  page: Page,
  menu: string,
  item: string,
  submenu?: string,
) {
  await menuBar(page).getByRole("button", { name: menu, exact: true }).click();
  if (submenu) {
    // Tap the parent. Hover closes the submenu while the pointer crosses to it,
    // which is also how a phone opens the item.
    await page.getByRole("menuitem", { name: named(submenu) }).click();
    await expect(page.getByRole("menuitem", { name: named(item) })).toBeVisible();
  }
  await page.getByRole("menuitem", { name: named(item) }).click();
}

const snapshot = (page: Page) =>
  page.locator(".slides-editor").getAttribute("data-deck-snapshot");

const order = (page: Page) =>
  page.locator(".thumbnail-row").evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-slide-id")),
  );

test("every Slides Edit, Insert, Format, and Slide menu item does something", async ({
  page,
}) => {
  await newDeck(page);
  const texts = () => page.locator(".slide-canvas .slide-text");
  const beforeTexts = await texts().count();

  await choose(page, "Insert", "Text box");
  const box = page.locator(".slide-text.selected");
  await expect(texts()).toHaveCount(beforeTexts + 1);
  await expect(box.locator("textarea")).toBeFocused();

  await choose(page, "Format", "Bold", "Text");
  await expect(box).toHaveCSS("font-weight", "700");
  await choose(page, "Format", "Italic", "Text");
  await expect(box).toHaveCSS("font-style", "italic");
  await choose(page, "Format", "Center", "Align & indent");
  await expect(box).toHaveCSS("text-align", "center");
  await choose(page, "Format", "Align left", "Align & indent");
  await expect(box).toHaveCSS("text-align", "left");
  await choose(page, "Format", "Align right", "Align & indent");
  await expect(box).toHaveCSS("text-align", "right");

  await choose(page, "Insert", "Rectangle", "Shape");
  await choose(page, "Insert", "Ellipse", "Shape");
  await choose(page, "Insert", "Rounded rectangle", "Shape");
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCount(3);
  await expect(page.locator(".slide-shape.selected")).toHaveCSS(
    "border-radius",
    "12px",
  );

  const chooser = page.waitForEvent("filechooser");
  await choose(page, "Insert", "Image");
  await (await chooser).setFiles(logo);
  await expect(page.locator(".slide-image.selected")).toBeVisible();
  const images = () => page.locator(".slide-canvas .slide-image");
  await expect(images()).toHaveCount(1);
  const first = await page.locator(".slide-image").getAttribute("data-x");

  await choose(page, "Edit", "Copy");
  await choose(page, "Edit", "Paste");
  await expect(images()).toHaveCount(2);
  const pasted = page.locator(".slide-image.selected");
  expect(Number(await pasted.getAttribute("data-x"))).toBe(Number(first) + 24);

  await choose(page, "Edit", "Cut");
  await expect(images()).toHaveCount(1);
  await choose(page, "Edit", "Paste");
  await expect(images()).toHaveCount(2);

  const withPaste = await snapshot(page);
  await choose(page, "Edit", "Undo");
  expect(await snapshot(page)).not.toBe(withPaste);
  await choose(page, "Edit", "Redo");
  expect(await snapshot(page)).toBe(withPaste);

  await choose(page, "Insert", "New slide");
  await choose(page, "Slide", "New slide");
  await expect(page.locator(".thumbnail-row")).toHaveCount(3);
  await choose(page, "Slide", "Duplicate slide");
  await expect(page.locator(".thumbnail-row")).toHaveCount(4);

  const beforeUp = await order(page);
  await choose(page, "Slide", "Move up");
  const afterUp = await order(page);
  expect(afterUp).not.toEqual(beforeUp);
  await choose(page, "Slide", "Move down");
  expect(await order(page)).toEqual(beforeUp);
  await choose(page, "Slide", "Move to start");
  expect(await order(page)).not.toEqual(beforeUp);
  await choose(page, "Slide", "Move to end");
  await choose(page, "Slide", "Delete slide");
  await expect(page.locator(".thumbnail-row")).toHaveCount(3);
  await expect(page.locator(".slides-notice")).toContainText("Slide deleted");
});

test("keyboard shortcuts work from the filmstrip and the canvas", async ({
  page,
}) => {
  await newDeck(page);
  const rows = page.locator(".thumbnail-row");
  await page.keyboard.press("ControlOrMeta+m");
  await expect(rows).toHaveCount(2);
  await page.locator(".thumbnails-list").focus();
  await page.keyboard.press("ControlOrMeta+d");
  await expect(rows).toHaveCount(3);
  await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
  await expect(rows.nth(0)).toHaveAttribute("data-slide-id", /.+/);
  const ids = await order(page);
  expect(ids[0]).not.toBe(ids[2]);

  await page.keyboard.press("ControlOrMeta+ArrowDown");
  expect(await order(page)).not.toEqual(ids);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await order(page)).toEqual(ids);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  const redone = await order(page);
  expect(redone).not.toEqual(ids);
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+y");
  expect(await order(page)).toEqual(redone);

  const subtitle = page.locator(".slide-canvas .slide-text").nth(1);
  await subtitle.click();
  await page.keyboard.press("ControlOrMeta+b");
  await expect(subtitle).toHaveCSS("font-weight", "700");

  await choose(page, "Insert", "Rounded rectangle", "Shape");
  const shape = page.locator(".slide-shape.selected");
  await expect(shape).toBeVisible();
  await shape.click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCount(0);

  await page.locator(".thumbnails-list").focus();
  await page.keyboard.press("Backspace");
  await expect(rows).toHaveCount(2);
  await expect(page.locator(".slides-notice")).toContainText("Slide deleted");
});

test("shift-click selects a group that drags, deletes, and duplicates together", async ({
  page,
}) => {
  await newDeck(page);
  const rows = page.locator(".thumbnail-row");
  for (let i = 0; i < 7; i++) await page.keyboard.press("ControlOrMeta+m");
  await expect(rows).toHaveCount(8);
  const before = await order(page);

  await rows.nth(2).click();
  await rows.nth(3).click({ modifiers: ["Shift"] });
  const chosen = page.locator('.thumbnail-row[aria-selected="true"]');
  await expect(chosen).toHaveCount(2);

  await rows.nth(1).click({ modifiers: ["ControlOrMeta"] });
  await expect(chosen).toHaveCount(3);
  await rows.nth(1).click({ modifiers: ["ControlOrMeta"] });
  await expect(chosen).toHaveCount(2);

  const start = (await rows.nth(2).boundingBox())!;
  const target = (await rows.nth(6).boundingBox())!;
  await page.mouse.move(start.x + 40, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + target.height * 0.8, {
    steps: 12,
  });
  await expect(page.locator(".thumbnail-row.drop-before")).toBeVisible();
  await page.mouse.up();

  const moved = await order(page);
  expect(moved).toEqual([
    before[0],
    before[1],
    before[4],
    before[5],
    before[6],
    before[2],
    before[3],
    before[7],
  ]);

  await page.keyboard.press("ControlOrMeta+d");
  const duplicated = await order(page);
  expect(duplicated).toHaveLength(10);
  const pairAt = duplicated.indexOf(before[2]);
  expect(duplicated[pairAt + 1]).toBe(before[3]);
  expect(duplicated[pairAt + 2]).not.toBe(before[3]);

  await page.keyboard.press("ControlOrMeta+z");
  expect(await order(page)).toEqual(moved);
  await rows.nth(5).click();
  await rows.nth(6).click({ modifiers: ["Shift"] });
  await page.keyboard.press("Delete");
  await expect(page.locator(".slides-notice")).toContainText("2 slides deleted");
  await expect(rows).toHaveCount(6);
  const removed = await order(page);
  await page.locator(".slides-notice").getByRole("button", { name: "Undo" }).click();
  expect(await order(page)).toEqual(moved);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await order(page)).toEqual(removed);
});

test("paste keeps the original position and offsets a copy on the same slide", async ({
  page,
}) => {
  await newDeck(page);
  await page.keyboard.press("ControlOrMeta+m");
  await choose(page, "Insert", "Rounded rectangle", "Shape");
  const origin = page.locator(".slide-shape.selected");
  const x = await origin.getAttribute("data-x");
  const y = await origin.getAttribute("data-y");
  await page.keyboard.press("ControlOrMeta+c");
  await page.locator(".thumbnail-row").nth(0).click();
  await page.keyboard.press("ControlOrMeta+v");
  const pasted = page.locator(".slide-shape.selected");
  await expect(pasted).toHaveAttribute("data-x", x!);
  await expect(pasted).toHaveAttribute("data-y", y!);
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator(".slide-shape.selected")).toHaveAttribute(
    "data-x",
    String(Number(x) + 24),
  );
  await expect(page.locator(".slide-shape.selected")).toHaveAttribute(
    "data-y",
    String(Number(y) + 24),
  );
});

test("ten mixed edits undo back to the exact starting deck", async ({
  page,
}) => {
  await newDeck(page);
  const start = await snapshot(page);
  await page.keyboard.press("ControlOrMeta+m");
  await page.keyboard.press("ControlOrMeta+m");
  await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
  await page.keyboard.press("ControlOrMeta+d");
  await page.keyboard.press("Delete");
  await choose(page, "Insert", "Text box");
  await page.keyboard.press("ControlOrMeta+b");
  await choose(page, "Format", "Center", "Align & indent");
  await choose(page, "Insert", "Rounded rectangle", "Shape");
  await page.keyboard.press("ControlOrMeta+x");
  expect(await snapshot(page)).not.toBe(start);
  for (let i = 0; i < 10; i++) await page.keyboard.press("ControlOrMeta+z");
  expect(await snapshot(page)).toBe(start);
});
