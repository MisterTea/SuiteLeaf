import { test, expect, type Page } from "@playwright/test";

/**
 * SuiteLeaf Responsive Visual & UX Test Suite
 * Validates desktop & mobile layouts, margins, toolbars, dialogs, and editors.
 */

async function assertNoHorizontalScroll(page: Page, contextName: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `${contextName}: page scrollWidth (${scrollWidth}px) exceeds clientWidth (${clientWidth}px)`,
  ).toBeLessThanOrEqual(clientWidth + 1);
}

test.describe("Desktop & Mobile End-to-End Responsive Suite", () => {
  test("Dashboard: responsive layout, sidebar, cards, and zero horizontal blowout", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForSelector(".new-cards");

    const viewport = page.viewportSize()!;
    const isMobile = viewport.width < 700;

    // Verify zero horizontal page overflow
    await assertNoHorizontalScroll(page, "Dashboard");

    // Sidebar assertions
    const sidebar = page.locator(".sidebar");
    await expect(sidebar).toBeVisible();
    const sidebarBox = (await sidebar.boundingBox())!;
    if (isMobile) {
      expect(sidebarBox.width).toBeLessThanOrEqual(70);
    } else {
      expect(sidebarBox.width).toBeGreaterThanOrEqual(180);
    }

    // New cards adapt to width and remain clickable
    const docCard = page.getByRole("button", { name: "New document" });
    const sheetCard = page.getByRole("button", { name: "New spreadsheet" });
    const slideCard = page.getByRole("button", { name: "New presentation" });
    await expect(docCard).toBeVisible();
    await expect(sheetCard).toBeVisible();
    await expect(slideCard).toBeVisible();

    const docBox = (await docCard.boundingBox())!;
    expect(docBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width - 1);
    expect(docBox.x + docBox.width).toBeLessThanOrEqual(viewport.width + 1);

    // Search input is accessible and fits
    const searchInput = page.getByPlaceholder("Search your files");
    await expect(searchInput).toBeVisible();
    const searchBox = (await searchInput.boundingBox())!;
    expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(viewport.width);
  });

  test("Docs: paper width, visible margins, scrollable toolbar, and editing", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New document" }).click();
    await page.waitForSelector(".paper");

    const viewport = page.viewportSize()!;
    const isMobile = viewport.width < 700;

    await assertNoHorizontalScroll(page, "Docs workspace");

    const paper = page.locator(".paper");
    const paperBox = (await paper.boundingBox())!;
    const stage = page.locator(".document-stage");
    const stageBox = (await stage.boundingBox())!;

    if (isMobile) {
      // 1. Doc paper fits within viewport
      expect(paperBox.width).toBeLessThanOrEqual(viewport.width);

      // 2. Stage margins around the paper are visible on both left and right
      const paperLeftMargin = paperBox.x - stageBox.x;
      const paperRightMargin =
        stageBox.x + stageBox.width - (paperBox.x + paperBox.width);
      expect(paperLeftMargin).toBeGreaterThanOrEqual(8);
      expect(paperRightMargin).toBeGreaterThanOrEqual(8);

      // 3. Document content inner margins are visible (text padding >= 16px)
      const { paddingLeft, paddingRight } = await page.evaluate(() => {
        const c = document.querySelector(".document-content")!;
        const s = window.getComputedStyle(c);
        return {
          paddingLeft: parseFloat(s.paddingLeft),
          paddingRight: parseFloat(s.paddingRight),
        };
      });
      expect(paddingLeft).toBeGreaterThanOrEqual(16);
      expect(paddingRight).toBeGreaterThanOrEqual(16);

      // 4. Toolbar is compact and does not wrap into multiple rows
      const toolbar = page.locator(".toolbar");
      const toolbarBox = (await toolbar.boundingBox())!;
      expect(toolbarBox.height).toBeLessThanOrEqual(55);

      // 5. Outline is hidden on mobile
      await expect(page.locator(".outline")).toBeHidden();
    } else {
      // Desktop: paper is standard width and centered
      expect(paperBox.width).toBeCloseTo(816, 0);
      if (viewport.width >= 1000) {
        await expect(page.locator(".outline")).toBeVisible();
      }
    }

    // Header title and menu fit within screen
    const header = page.locator(".workspace-header");
    const headerBox = (await header.boundingBox())!;
    expect(headerBox.x + headerBox.width).toBeLessThanOrEqual(viewport.width);

    // Document typing and formatting work
    const editor = page.getByRole("textbox", { name: "Document content" });
    await editor.click();
    await editor.fill("Responsive editing verified");
    await editor.press("ControlOrMeta+A");

    const boldBtn = page.getByRole("button", { name: "Bold", exact: true });
    await boldBtn.scrollIntoViewIfNeeded();
    await boldBtn.click();

    await expect(editor.locator("strong")).toContainText("Responsive editing");
    await expect(page.getByRole("status")).toContainText("Saved");
  });

  test("Docs: modals center and fit within viewport without clipping", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New document" }).click();
    await page.waitForSelector(".paper");

    const viewport = page.viewportSize()!;

    // 1. Find and replace dialog
    const findBtn = page.getByRole("button", {
      name: "Find and replace",
      exact: true,
    });
    await findBtn.scrollIntoViewIfNeeded();
    await findBtn.click();

    const findDialog = page.locator(".gdocs-dialog");
    await expect(findDialog).toBeVisible();
    const findBox = (await findDialog.boundingBox())!;

    expect(findBox.x).toBeGreaterThanOrEqual(8);
    expect(findBox.x + findBox.width).toBeLessThanOrEqual(viewport.width);

    await page.getByRole("textbox", { name: "Find text" }).fill("test");
    await page.getByRole("button", { name: "Close find" }).click();
    await expect(findDialog).toBeHidden();

    // 2. Insert table dialog
    const tableBtn = page.getByRole("button", {
      name: "Insert table",
      exact: true,
    });
    await tableBtn.scrollIntoViewIfNeeded();
    await tableBtn.click();

    const tableDialog = page.locator(".gdocs-dialog");
    await expect(tableDialog).toBeVisible();
    const tableBox = (await tableDialog.boundingBox())!;

    expect(tableBox.x).toBeGreaterThanOrEqual(8);
    expect(tableBox.x + tableBox.width).toBeLessThanOrEqual(viewport.width);

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(tableDialog).toBeHidden();
  });

  test("Sheets: toolbar, formula bar, grid, and analysis dropdown responsiveness", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New spreadsheet" }).click();
    await page.waitForSelector(".sheet-host");

    const viewport = page.viewportSize()!;
    await assertNoHorizontalScroll(page, "Sheets workspace");

    // Toolbar is single-row and scrollable
    const sheetsToolbar = page.locator(".sheets-toolbar");
    await expect(sheetsToolbar).toBeVisible();
    const toolbarBox = (await sheetsToolbar.boundingBox())!;
    expect(toolbarBox.height).toBeLessThanOrEqual(55);
    expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(viewport.width);

    // Analysis dropdown / panels adapt cleanly
    const chartsBtn = page.getByRole("button", {
      name: "Insert chart",
      exact: true,
    });
    await chartsBtn.scrollIntoViewIfNeeded();
    await chartsBtn.click();

    const chartPanel = page.locator(".analysis-panel");
    await expect(chartPanel).toBeVisible();
    const chartBox = (await chartPanel.boundingBox())!;
    expect(chartBox.x + chartBox.width).toBeLessThanOrEqual(viewport.width);

    await page.getByRole("button", { name: "Close analysis panel" }).click();
    await expect(chartPanel).toBeHidden();
  });

  test("Slides: filmstrip rail, canvas scaling, and fullscreen slideshow", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New presentation" }).click();
    await page.waitForSelector(".slides-canvas-stage");

    const viewport = page.viewportSize()!;
    const isMobile = viewport.width < 700;

    await assertNoHorizontalScroll(page, "Slides workspace");

    const sidebar = page.locator(".slides-sidebar");
    await expect(sidebar).toBeVisible();
    const sidebarBox = (await sidebar.boundingBox())!;
    const canvas = page.locator(".slide-canvas");
    await expect(canvas).toBeVisible();
    const canvasBox = (await canvas.boundingBox())!;

    if (isMobile) {
      // Sidebar takes compact rail
      expect(sidebarBox.width).toBeLessThanOrEqual(75);
      // Canvas gets primary screen space
      expect(canvasBox.width).toBeGreaterThanOrEqual(viewport.width * 0.6);
    }

    // Canvas fits inside the viewport
    expect(canvasBox.x + canvasBox.width).toBeLessThanOrEqual(viewport.width);

    // Test presentation mode
    const presentBtn = page.getByRole("button", { name: "Present", exact: true });
    await presentBtn.scrollIntoViewIfNeeded();
    await presentBtn.click();

    const presenterOverlay = page.locator(".presenter-overlay");
    await expect(presenterOverlay).toBeVisible();

    // Exit presentation mode
    await page.getByRole("button", { name: "Exit" }).click();
    await expect(presenterOverlay).toHaveCount(0);
  });
});
