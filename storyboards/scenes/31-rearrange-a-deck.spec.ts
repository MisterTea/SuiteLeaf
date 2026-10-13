import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type Locator, type Page } from "@playwright/test";
import {
  createFile,
  serializeFile,
  type Slide,
  type SlideElement,
  type SlideFile,
} from "@suiteleaf/core";
import { beat, caption, expect, test, typeSlowly } from "./harness";

const logoPath = join(tmpdir(), "suiteleaf-q3-logo.svg");
writeFileSync(
  logoPath,
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">
    <rect width="320" height="180" rx="28" fill="#1a73e8"/>
    <text x="160" y="118" text-anchor="middle" font-family="Arial, sans-serif" font-size="84" font-weight="700" fill="#ffffff">QL</text>
  </svg>`,
);

function text(content: string, extra: Partial<SlideElement> = {}): SlideElement {
  return {
    id: crypto.randomUUID(),
    type: "text",
    x: 72,
    y: 46,
    width: 640,
    height: 78,
    content,
    fontSize: 36,
    bold: true,
    color: "#0f172a",
    ...extra,
  };
}

function slide(title: string, extra: SlideElement[] = []): Slide {
  const id = crypto.randomUUID();
  return { id, elements: [text(title), ...extra], notes: "" };
}

function bar(x: number, height: number, fill: string): SlideElement {
  return {
    id: crypto.randomUUID(),
    type: "shape",
    shapeType: "roundRect",
    x,
    y: 430 - height,
    width: 78,
    height,
    fill,
    stroke: "transparent",
    strokeWidth: 0,
  };
}

function q3Update(): SlideFile {
  const file = createFile("slide", "Q3 update") as SlideFile;
  const chart = slide("Chart", [
    bar(150, 150, "#1a73e8"),
    bar(260, 220, "#34a853"),
    bar(370, 180, "#fbbc04"),
    bar(480, 260, "#ea4335"),
    text("Quarterly revenue", { y: 150, fontSize: 22, bold: false, color: "#334155" }),
  ]);
  const slides = [
    slide("Q3 update"),
    slide("Old pipeline"),
    slide("Old targets"),
    slide("Agenda"),
    slide("Roadmap"),
    slide("Results", [
      text("128% of plan", {
        y: 150,
        fontSize: 28,
        bold: false,
        color: "#188038",
      }),
    ]),
    chart,
    slide("Appendix"),
  ];
  const [first, ...rest] = slides;
  const firstId = file.content.slideOrder[0];
  file.content.slides[firstId] = { ...first, id: firstId };
  file.content.slideOrder = [firstId, ...rest.map((item) => item.id)];
  for (const item of rest) file.content.slides[item.id] = item;
  return file;
}

async function pointAt(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 12,
  });
}

async function openMenu(page: Page, name: string) {
  await page.locator(".file-menu").getByRole("button", { name, exact: true }).click();
  await beat(page, 450);
}

const rows = (page: Page) => page.locator(".thumbnail-row");

test("31-rearrange-a-deck", async ({ page }) => {
  const deck = q3Update();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New presentation" })).toBeVisible();
  await page.evaluate(async (native) => {
    const file = JSON.parse(native) as { id: string; title: string; updatedAt: string };
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("SuiteLeaf");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("encoded", "readwrite");
        tx.objectStore("encoded").put({
          id: file.id,
          title: file.title,
          updatedAt: file.updatedAt,
          native,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, serializeFile(deck));
  await page.reload();

  await caption(page, "Maria opens last quarter’s update. Eight slides, ready to reshuffle.");
  const file = page.getByRole("link", { name: "Q3 update" });
  await expect(file).toBeVisible();
  await pointAt(page, file);
  await file.click();
  await expect(rows(page)).toHaveCount(8);
  await expect(rows(page).nth(5)).toHaveAttribute("aria-label", "Slide 6: Results");
  await beat(page, 600);

  await caption(
    page,
    "The Slide menu shows the shortcut. Move to the start — no Fn key.",
    1200,
  );
  await rows(page).nth(5).scrollIntoViewIfNeeded();
  await pointAt(page, rows(page).nth(5));
  await openMenu(page, "Slide");
  await expect(page.getByRole("menuitem", { name: "Move to start" })).toBeVisible();
  await beat(page, 900);
  await page.keyboard.press("Escape");
  await rows(page).nth(5).click();
  await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
  await expect(rows(page).nth(0)).toHaveAttribute("aria-label", "Slide 1: Results");
  await beat(page, 800);

  await caption(page, "Shift-click selects a group. Drag both outdated slides below the chart.");
  await rows(page).nth(2).click();
  await rows(page).nth(3).click({ modifiers: ["Shift"] });
  await expect(page.locator('.thumbnail-row[aria-selected="true"]')).toHaveCount(2);
  await rows(page).nth(7).scrollIntoViewIfNeeded();
  await beat(page, 700);
  const from = (await rows(page).nth(2).boundingBox())!;
  const below = (await rows(page).nth(6).boundingBox())!;
  await page.mouse.move(from.x + 50, from.y + from.height / 2, { steps: 10 });
  await page.mouse.down();
  await page.mouse.move(below.x + 50, below.y + below.height * 0.82, { steps: 24 });
  await expect(page.locator(".thumbnail-row.drop-before")).toBeVisible();
  await beat(page, 1100);
  await page.mouse.up();
  await expect(rows(page).nth(4)).toHaveAttribute("aria-label", "Slide 5: Chart");
  await expect(rows(page).nth(5)).toHaveAttribute("aria-label", "Slide 6: Old pipeline");
  await expect(rows(page).nth(6)).toHaveAttribute("aria-label", "Slide 7: Old targets");
  await beat(page, 700);

  await caption(page, "Duplicate the chart with Cmd+D. The copy lands right after it.");
  await pointAt(page, rows(page).nth(4));
  await rows(page).nth(4).click();
  await page.keyboard.press("ControlOrMeta+d");
  await expect(rows(page)).toHaveCount(9);
  await expect(rows(page).nth(5)).toHaveAttribute("aria-label", "Slide 6: Chart");
  await expect(rows(page).nth(5)).toHaveAttribute("aria-selected", "true");
  await beat(page, 700);

  await caption(page, "Slide › Duplicate slide does the same. Undo puts the extra away.");
  await openMenu(page, "Slide");
  await page.getByRole("menuitem", { name: "Duplicate slide" }).click();
  await expect(rows(page)).toHaveCount(10);
  await beat(page, 500);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(rows(page)).toHaveCount(9);

  await caption(page, "So does a right-click on the thumbnail.");
  await rows(page).nth(4).click({ button: "right" });
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Duplicate slide" }).click();
  await expect(rows(page)).toHaveCount(10);
  await beat(page, 500);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(rows(page)).toHaveCount(9);
  await beat(page, 400);

  await caption(page, "Select the two old slides and press Delete.");
  await rows(page).nth(6).click();
  await rows(page).nth(7).click({ modifiers: ["Shift"] });
  await page.keyboard.press("Delete");
  const notice = page.locator(".slides-notice");
  await expect(notice).toContainText("2 slides deleted");
  await expect(notice).toContainText("Undo");
  await expect(rows(page)).toHaveCount(7);
  await beat(page, 900);

  await caption(page, "One Undo brings both back, in the same places.");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(rows(page)).toHaveCount(9);
  await expect(rows(page).nth(6)).toHaveAttribute("aria-label", "Slide 7: Old pipeline");
  await expect(rows(page).nth(7)).toHaveAttribute("aria-label", "Slide 8: Old targets");
  await beat(page, 700);

  await caption(page, "Redo deletes them again. The Edit menu does both.");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(rows(page)).toHaveCount(7);
  await beat(page, 400);
  await openMenu(page, "Edit");
  await page.getByRole("menuitem", { name: "Undo" }).click();
  await expect(rows(page)).toHaveCount(9);
  await beat(page, 400);
  await openMenu(page, "Edit");
  await page.getByRole("menuitem", { name: "Redo" }).click();
  await expect(rows(page)).toHaveCount(7);
  await expect(notice).toHaveCount(0);
  await beat(page, 500);

  await caption(page, "Insert › Text box drops one in the middle, ready to type.");
  await pointAt(page, rows(page).nth(0));
  await rows(page).nth(0).click();
  await openMenu(page, "Insert");
  await page.getByRole("menuitem", { name: "Text box" }).click();
  const inserted = page.locator(".slide-text.selected textarea");
  await expect(inserted).toBeFocused();
  await typeSlowly(page, "Shipped.");
  await beat(page, 400);

  await caption(page, "Bold and center it from the Format menu.");
  await openMenu(page, "Format");
  await page.getByRole("menuitem", { name: "Text", exact: true }).hover();
  await beat(page, 350);
  await page.getByRole("menuitem", { name: "Bold" }).click();
  await expect(page.locator(".slide-text.selected")).toHaveCSS("font-weight", "700");
  await openMenu(page, "Format");
  await page.getByRole("menuitem", { name: "Align & indent" }).hover();
  await beat(page, 350);
  await page.getByRole("menuitem", { name: "Center" }).click();
  await expect(page.locator(".slide-text.selected")).toHaveCSS("text-align", "center");
  await beat(page, 500);

  await caption(page, "Insert › Image opens the logo. Two clicks, and it sits in the corner.");
  const chooser = page.waitForEvent("filechooser");
  await openMenu(page, "Insert");
  await page.getByRole("menuitem", { name: "Image", exact: true }).click();
  await (await chooser).setFiles(logoPath);
  await expect(page.locator(".slide-image.selected")).toBeVisible();
  await beat(page, 700);

  await caption(page, "Insert › Shape › Rounded rectangle. It’s a callout, already selected.");
  await openMenu(page, "Insert");
  await page.getByRole("menuitem", { name: "Shape", exact: true }).hover();
  await beat(page, 400);
  await page.getByRole("menuitem", { name: "Rounded rectangle" }).click();
  const callout = page.locator(".slide-shape.selected");
  await expect(callout).toBeVisible();
  await expect(callout).toHaveCSS("border-radius", "12px");
  const origin = {
    x: await callout.getAttribute("data-x"),
    y: await callout.getAttribute("data-y"),
  };
  await beat(page, 600);

  await caption(page, "Copy the callout. On the next slide it lands in the same place.");
  await page.keyboard.press("ControlOrMeta+c");
  await pointAt(page, rows(page).nth(1));
  await rows(page).nth(1).click();
  await page.keyboard.press("ControlOrMeta+v");
  const pasted = page.locator(".slide-shape.selected");
  await expect(pasted).toHaveAttribute("data-x", origin.x!);
  await expect(pasted).toHaveAttribute("data-y", origin.y!);
  await beat(page, 700);

  await caption(page, "Paste again on this slide and it steps aside, so you can see both.");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator(".slide-shape.selected")).toHaveAttribute(
    "data-x",
    String(Number(origin.x) + 24),
  );
  await beat(page, 500);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCount(1);
  await page.locator(".slide-canvas .slide-shape").click();

  await caption(page, "Edit › Cut and Paste do the same.");
  await openMenu(page, "Edit");
  await page.getByRole("menuitem", { name: /^Cut\b/ }).click();
  await expect(page.locator(".slide-canvas .slide-shape")).toHaveCount(0);
  await beat(page, 400);
  await openMenu(page, "Edit");
  await page.getByRole("menuitem", { name: /^Paste\b/ }).click();
  await expect(page.locator(".slide-shape.selected")).toHaveAttribute("data-x", origin.x!);
  await beat(page, 600);

  await caption(page, "Present. Results leads, then the rest of the quarter.");
  await page.evaluate(() => {
    const bar = document.getElementById("storyboard-caption");
    if (bar) bar.style.bottom = "96px";
  });
  await rows(page).nth(0).click();
  await page.mouse.move(640, 12);
  await page.keyboard.press("ControlOrMeta+Enter");
  const show = page.locator(".presenter-overlay");
  await expect(show).toBeVisible();
  await beat(page, 2600);
  await expect(show).toContainText("Results");
  await expect(show).toContainText("Shipped.");
  await beat(page, 900);
  await page.keyboard.press("ArrowRight");
  await expect(show).toContainText("Q3 update");
  await beat(page, 700);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(show).toContainText("Chart");
  await beat(page, 600);
  await page.keyboard.press("ArrowRight");
  await expect(show).toContainText("Chart");
  await beat(page, 800);
  await page.keyboard.press("Escape");
  await expect(show).toHaveCount(0);
  await caption(page, "The deck is this quarter’s, and every shortcut did what it said.", 1600);
});
