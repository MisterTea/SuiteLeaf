import { editSlideText } from "./slide-text-helpers";
import type { Ace } from "ace-builds";
import { fillSource, expectSourceValue } from "./source-editor-helpers";
import { test, expect, type Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src/native-file";
import { defaultPageSettings } from "../../packages/core/src/document-layout";
import { readFile } from "node:fs/promises";

test("Mobile shared presentation keeps upload retries visible through rotation", async ({ page, isMobile }) => {
  test.skip(!isMobile);
  const file = createFile("slide", "Shared lecture");
  const item = {
    id: "mobile-lecture", name: file.title, kind: "file", role: "owner",
    parentId: "lectures", parentName: "Lecture Slides", ownerId: "jason",
    updatedAt: file.updatedAt, lastEditedAt: file.updatedAt,
    lastAuthorName: "Jason Gauci", available: true,
  };
  await page.addInitScript(() => localStorage.setItem("suiteleaf:node-session", JSON.stringify({
    url: location.origin, token: "layout-test", user: { id: "jason", name: "Jason Gauci" },
  })));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === `/api/drive/items/${item.id}` ? item
      : path.endsWith("/presence") ? { people: [] }
      : path.endsWith("/notices") ? { notices: [] }
      : path.endsWith("/folders") ? { folders: [] }
      : path.endsWith("/items") ? { items: [] }
      : {};
    await route.fulfill({ json: body });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^New presentation/ }).waitFor();
  await page.evaluate(async (record) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("SuiteLeaf");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("encoded", "readwrite");
        tx.objectStore("encoded").put(record);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, {
    id: file.id, title: file.title, updatedAt: file.updatedAt, native: serializeFile(file),
    drive: { nodeUrl: "http://localhost", itemId: item.id, name: file.title, syncedAt: file.updatedAt },
  });
  await page.goto(`/#/file/${file.id}`);
  const header = page.locator(".workspace-header");
  await expect(header.locator(".title-folder-row")).toHaveCount(0);
  const toolbar = page.getByRole("toolbar", { name: "Slides toolbar" });
  await expect(toolbar.getByRole("button", { name: "Download", exact: true })).toBeAttached();
  await expect(header.locator(".header-right-tools")).toHaveCount(0);
  await expect(toolbar.locator(".editor-toolbar-navigation button")).toHaveCount(1);
  await expect(toolbar.locator(".editor-toolbar-navigation button").nth(0)).toHaveAttribute("aria-label", "Back to files");
  await expect(page.locator(".star-btn")).toHaveCount(0);
  const toast = page.locator(".workspace-status-toast");
  await expect(toast).toBeInViewport();
  expect((await toast.locator(".status-icon-label").boundingBox())!.width).toBeGreaterThan(80);
  expect((await page.getByRole("menubar").boundingBox())!.y).toBeLessThanOrEqual(8);
  await page.evaluate(({ itemId, revision }) => localStorage.setItem("suiteleaf.uploadQueue", JSON.stringify([{
    itemId, revision, bytes: 20, attempts: 1, nextAttemptAt: 0,
    failure: { kind: "network", message: "offline", remedy: "Retry when SuiteDrive is reachable. This copy stays on this device." },
  }])), { itemId: item.id, revision: file.updatedAt });
  const uploads = page.getByRole("region", { name: "Upload notifications" });
  for (const [width, height] of [[320, 844], [390, 844], [700, 390], [844, 390]]) {
    await page.setViewportSize({ width, height });
    if (width <= 700) {
      expect(await header.boundingBox()).toBeNull();
    } else {
      expect((await header.boundingBox())!.height).toBeLessThanOrEqual(140);
    }
    await toolbar.evaluate((element) => { element.scrollLeft = 0; });
    const back = toolbar.getByRole("button", { name: "Back to files" });
    const menu = page.locator("#file-menu");
    const fileMenu = menu.getByRole("button", { name: "File", exact: true });
    await expect(back).toBeInViewport();
    await expect(fileMenu).toBeInViewport();
    await fileMenu.tap();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(menu).toBeVisible();
    const menuBounds = (await menu.boundingBox())!;
    expect(menuBounds.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(menu).toBeVisible();
    await expect(uploads.getByRole("button", { name: "Retry", exact: true })).toBeInViewport();
    const notice = (await uploads.boundingBox())!;
    const headerBounds = await header.boundingBox();
    expect(notice.y).toBeGreaterThanOrEqual(headerBounds ? headerBounds.y + headerBounds.height - 1 : 0);
    expect(notice.x).toBeGreaterThanOrEqual(0);
    expect(notice.x + notice.width).toBeLessThanOrEqual(width);
    await assertNoHorizontalScroll(page, `Shared presentation header at ${width}px`);
  }
  await uploads.getByRole("button", { name: "Retry", exact: true }).tap();
  await expect(uploads.getByRole("status")).toContainText("saved to SuiteDrive");
  await expect(uploads.getByRole("list")).toHaveCount(0);
});

test("Mobile expanded formula editor preserves text proportions", async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.goto("/");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await page.locator("[data-sheet-ready='true']").waitFor();
  const formulaBar = page.locator('[data-u-comp="formula-bar"]');
  const canvas = formulaBar.locator('canvas[data-u-comp="render-canvas"]');
  const height = (await formulaBar.boundingBox())!.height;
  await formulaBar.locator(".univerjs-icon-down-icon").locator("..").tap();
  await expect.poll(async () => (await formulaBar.boundingBox())!.height).toBeGreaterThan(height * 2);
  // The canvas bitmap must have the same scale in both axes; otherwise its
  // painted text is compressed even though the editor's box has expanded.
  await expect.poll(() => canvas.evaluate((element) => {
    const bitmap = element as HTMLCanvasElement;
    const bounds = bitmap.getBoundingClientRect();
    return Math.abs(bounds.width / bitmap.width - bounds.height / bitmap.height);
  })).toBeLessThan(0.03);
  await formulaBar.locator(".univerjs-icon-down-icon").locator("..").tap();
  await expect.poll(async () => (await formulaBar.boundingBox())!.height).toBe(height);
});

test("Mobile comment editor leaves its submit button tappable", async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.goto("/");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await page.locator("[data-sheet-ready='true']").waitFor();
  await page.getByRole("button", { name: "Insert comment (Cmd+Option+M)" }).tap();
  await page.locator('[id^="CELL-"] canvas#univer-doc-main-canvas').tap();
  await page.keyboard.type("Review this cell");
  // A canvas overlapping the action row would intercept this real tap.
  await page.getByRole("button", { name: "Comment", exact: true }).tap();
});

test("Mobile MARP typing pauses preserve the markdown caret and scroll position", async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.setViewportSize({ width: 390, height: 844 });
  const source = "---\nmarp: true\n---\n\n" + Array.from({ length: 12 }, (_, index) =>
    `# Slide ${index + 1}\n\n` + Array.from({ length: 5 }, (_, line) => `Paragraph ${index + 1}.${line + 1}: A line that remains readable while editing.`).join("\n\n")
  ).join("\n\n---\n\n");
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({ name: "scroll.md", mimeType: "text/markdown", buffer: Buffer.from(source) });
  await expect(page.locator(".slide-canvas")).not.toHaveAttribute("aria-busy", "true");
  const initialFit = await page.locator(".slides-editor").evaluate((element) => JSON.parse((element as HTMLElement).dataset.deckSnapshot!).marpFit);
  await page.getByRole("button", { name: "Show markdown", exact: true }).click();
  // Shrink the visual viewport without shortening the editor's layout.
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1.5 });
  const markdown = page.getByLabel("Presentation markdown");
  const position = source.indexOf("Paragraph 5.2") + "Paragraph 5.2".length;
  await markdown.evaluate((element, caret) => {
    const area = element as HTMLTextAreaElement;
    area.focus();
    const editor = (area as HTMLTextAreaElement & { __aceEditor: Ace.Editor }).__aceEditor;
    editor.moveCursorToPosition(editor.session.doc.indexToPosition(caret, 0));
    editor.scrollToLine(editor.getCursorPosition().row, true, false, () => {});
  }, position);
  await page.waitForTimeout(250);
  await page.keyboard.insertText(" scroll-regression");
  const location = () => markdown.evaluate((element) => {
    const area = element as HTMLTextAreaElement;
    const parents = [];
    for (let parent = area.parentElement; parent; parent = parent.parentElement)
      parents.push({ className: parent.className, top: parent.scrollTop });
    const editor = (area as HTMLTextAreaElement & { __aceEditor: Ace.Editor }).__aceEditor;
    return { top: editor.session.getScrollTop(), caret: editor.session.doc.positionToIndex(editor.getCursorPosition(), 0), focused: document.activeElement === area, parents,
      viewport: { top: window.visualViewport?.pageTop, offsetTop: window.visualViewport?.offsetTop },
    };
  });
  const before = await location();
  await expect.poll(() => page.locator(".slides-editor").evaluate((element, fit) => {
    const deck = JSON.parse((element as HTMLElement).dataset.deckSnapshot!);
    return deck.marpSource.includes("scroll-regression") && deck.marpFit === fit;
  }, initialFit)).toBe(true);
  await page.waitForTimeout(250);
  const after = await location();
  expect(after).toEqual(before);
});

test("Mobile MARP switches between a full slide editor and full markdown pane", async ({ page, isMobile }) => {
  test.skip(!isMobile);
  const source = "---\nmarp: true\n---\n\n# Phone slides\n\nEdit either view.\n";
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({ name: "mobile-marp.md", mimeType: "text/markdown", buffer: Buffer.from(source) });
  const canvas = page.locator(".slide-canvas");
  const markdown = page.getByLabel("Presentation markdown");
  await expect(canvas).toBeVisible();
  await expect(canvas).not.toHaveAttribute("aria-busy", "true");
  await expect(markdown).toHaveCount(0);
  const switchToCode = page.getByRole("button", { name: "Show markdown", exact: true });
  await expect(switchToCode).toBeInViewport();
  await switchToCode.tap();
  await expect(canvas).toBeHidden();
  await expect(markdown).toBeVisible();
  await expect(page.locator(".marp-split-handle")).toBeHidden();
  const stage = (await page.locator(".slide-stage-row").boundingBox())!;
  const pane = (await page.locator(".marp-pane").boundingBox())!;
  expect(pane.width).toBeGreaterThan(stage.width - 2);
  expect(pane.height).toBeGreaterThan(stage.height * 0.9);
  await fillSource(markdown, source.replace("Edit either view.", "Changed on the phone."));
  await page.getByRole("button", { name: "Show slide editor", exact: true }).tap();
  await expect(canvas).toBeVisible();
  await expect(canvas).not.toHaveAttribute("aria-busy", "true");
  await expect(markdown).toHaveCount(0);
  expect((await canvas.boundingBox())!.width).toBeGreaterThan(page.viewportSize()!.width * 0.8);
  await switchToCode.tap();
  await expectSourceValue(markdown, /Changed on the phone/);
  await assertNoHorizontalScroll(page, "Mobile MARP editor");
});

test("Mobile sheet selected rows and columns have large resize handles and retain sizes", async ({ page, isMobile }) => {
  test.skip(!isMobile);
  const file = createFile("sheet", "Mobile resizing");
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({ name: "resize.suiteleaf", mimeType: "application/json", buffer: Buffer.from(serializeFile(file)) });
  await page.locator("[data-sheet-ready='true']").waitFor();
  const canvas = page.locator('.sheet-host canvas[id^="univer-sheet-main-canvas"]');
  const bounds = (await canvas.boundingBox())!;
  await touchGesture(page, { x: bounds.x + 16, y: bounds.y + 56 });
  const row = page.locator(".sheet-resize-border.row");
  await expect(row).toBeVisible();
  const rowHandle = row.getByRole("button").first();
  await expect(rowHandle).toBeInViewport();
  const rh = (await rowHandle.boundingBox())!;
  expect(rh.width).toBeGreaterThanOrEqual(44);
  const rowStart = { x: rh.x + rh.width / 2, y: rh.y + rh.height / 2 };
  await touchGesture(page, rowStart, { x: rowStart.x, y: rowStart.y + 36 });
  const snapshot = async () => {
    const download = page.waitForEvent("download");
    const button = page.getByRole("button", { name: "Download", exact: true });
    await button.scrollIntoViewIfNeeded();
    await button.click();
    const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
    return saved.content.workbook.sheets[saved.content.workbook.sheetOrder[0]];
  };
  const taller = await snapshot();
  expect(taller.rowData[1].h).toBeGreaterThanOrEqual((taller.defaultRowHeight ?? 24) + 30);
  await touchGesture(page, { x: bounds.x + 196, y: bounds.y + 10 });
  const column = page.locator(".sheet-resize-border.column");
  await expect(column).toBeVisible();
  await expect(row).toHaveCount(0);
  const ch = (await column.getByRole("button").first().boundingBox())!;
  expect(ch.height).toBeGreaterThanOrEqual(44);
  const columnStart = { x: ch.x + ch.width / 2, y: ch.y + ch.height / 2 };
  await touchGesture(page, columnStart, { x: columnStart.x + 45, y: columnStart.y });
  const wider = await snapshot();
  expect(wider.columnData[1].w).toBeGreaterThanOrEqual((wider.defaultColumnWidth ?? 100) + 40);
  expect(wider.rowData[1].h).toBe(taller.rowData[1].h);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Mobile resizing", exact: true }).click();
  await page.locator("[data-sheet-ready='true']").waitFor();
  const reopened = await snapshot();
  expect(reopened.rowData[1].h).toBe(taller.rowData[1].h);
  expect(reopened.columnData[1].w).toBe(wider.columnData[1].w);
});

test("Mobile workspace combines navigation and actions without showing the title", async ({ page, isMobile }) => {
  test.skip(!isMobile);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const kind of ["document", "spreadsheet", "presentation"]) {
      await page.goto("/");
      await page.getByRole("button", { name: new RegExp(`^New ${kind}`) }).click();
      const header = page.locator(".workspace-header");
      await expect(page.getByLabel("File title")).toBeHidden();
      if (kind === "presentation") {
        await expect(page.getByRole("toolbar", { name: "Slides toolbar" })).toBeVisible();
        await expect.poll(() => header.boundingBox()).toBeNull();
      }
      else expect((await header.boundingBox())!.height).toBeLessThanOrEqual(48);
      const back = (await page.getByRole("button", { name: "Back to files" }).boundingBox())!;
      for (const label of ["Back to files", "Version history", "Comments", "AI assistant", "Download"]) {
        const inToolbar = kind === "presentation";
        const parent = inToolbar ? page.getByRole("toolbar", { name: "Slides toolbar" }) : header;
        const button = parent.getByRole("button", { name: label, exact: true });
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeInViewport();
        const box = (await button.boundingBox())!;
        if (inToolbar) {
          const bar = (await parent.boundingBox())!;
          expect(box.y).toBeGreaterThanOrEqual(bar.y);
          expect(box.y + box.height).toBeLessThanOrEqual(bar.y + bar.height);
          if (label === "Download") await expect(button).toHaveText("");
        } else {
          expect(Math.abs(box.y + box.height / 2 - back.y - back.height / 2)).toBeLessThanOrEqual(2);
        }
      }
      const menus = page.getByRole("menubar", { name: "Main menu" });
      await expect(menus).toBeInViewport();
      const buttons = menus.locator(".menu-trigger");
      for (const button of await buttons.all()) {
        await expect(button).toBeInViewport();
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      await menus.getByRole("button", { name: "File", exact: true }).click();
      const dropdown = page.getByRole("menu");
      await expect(dropdown).toBeVisible();
      const bounds = (await dropdown.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await assertNoHorizontalScroll(page, `${kind} header at ${width}px`);
    }
  }
});

test("Docs defaults follow dark theme while explicit colors and print stay intact", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("suiteleaf_theme_mode", "dark"));
  const file = createFile("doc", "Dark document");
  if (file.kind !== "doc") throw new Error("Expected document");
  file.content = { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Default text" }] },
    { type: "paragraph", content: [{ type: "text", text: "Colored text", marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }] }] },
    { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Heading" }] }] }] }] },
  ] };
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({ name: "dark.suiteleaf", mimeType: "application/json", buffer: Buffer.from(serializeFile(file)) });
  const editor = page.getByRole("textbox", { name: "Document content" });
  const normal = editor.locator("p").first();
  const colored = editor.locator('span[style*="color"]');
  await expect(normal).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(colored).toHaveCSS("color", "rgb(255, 0, 0)");
  await expect(editor.locator("th")).toHaveCSS("background-color", "rgb(37, 40, 46)");
  expect(await page.locator(".paper").evaluate((el) => {
    const style = getComputedStyle(el);
    return style.backgroundImage.includes("rgb(0, 0, 0)") || style.backgroundColor === "rgb(0, 0, 0)";
  })).toBe(true);
  await page.emulateMedia({ media: "print" });
  await expect(normal).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(page.locator(".paper")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(colored).toHaveCSS("color", "rgb(255, 0, 0)");
  await page.emulateMedia({ media: "screen" });
  await expect(normal).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
    document.documentElement.classList.remove("dark-theme");
  });
  await expect(normal).toHaveCSS("color", "rgb(0, 0, 0)");
});

async function touchGesture(page: Page, start: { x: number; y: number }, end = start, hold = 0) {
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  if (hold) await page.waitForTimeout(hold);
  if (end.x !== start.x || end.y !== start.y) {
    for (let step = 1; step <= 5; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + (end.x - start.x) * step / 5, y: start.y + (end.y - start.y) * step / 5 }] });
      await page.waitForTimeout(20);
    }
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
}

test("Mobile Docs reflows readable text, tables and images and restores paper layout for print", async ({ page, isMobile }) => {
  test.skip(!isMobile);
  const file = createFile("doc", "Phone reading");
  if (file.kind !== "doc") throw new Error("Expected document");
  const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const prose = "Readable text wraps naturally within the phone without shrinking the paper. ".repeat(25);
  file.content = {
    type: "doc",
    attrs: { pageSettings: { ...defaultPageSettings, landscape: true, marginLeft: 144, marginRight: 144 } },
    content: [
      paragraph(prose),
      paragraph("averylongunbrokenaddress".repeat(12)),
      { type: "pageBreak" },
      paragraph("After the page break"),
      { type: "table", content: [{ type: "tableRow", content: [0, 1].map((i) => ({ type: "tableCell", attrs: { colwidth: [500] }, content: [paragraph(`Wide column ${i + 1}`)] })) }] },
      { type: "image", attrs: { src: "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="700" height="200"><rect width="700" height="200" fill="green"/></svg>').toString("base64"), width: 700, height: 200 } },
    ],
  };
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({ name: "phone.suiteleaf", mimeType: "application/json", buffer: Buffer.from(serializeFile(file)) });
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText(prose);
  await expect.poll(() => page.locator(".doc-page-spacer").count()).toBe(0);
  const layout = await editor.evaluate((el) => ({
    font: parseFloat(getComputedStyle(el).fontSize),
    width: el.clientWidth, scrollWidth: el.scrollWidth,
    paperZoom: getComputedStyle(el.closest(".paper")!).zoom,
    firstParagraphHeight: el.querySelector("p")!.getBoundingClientRect().height,
  }));
  expect(layout.font).toBe(16);
  expect(Number(layout.paperZoom)).toBe(1);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.firstParagraphHeight).toBeGreaterThan(400);
  await assertNoHorizontalScroll(page, "Reflowed document");
  await expect(page.locator(".page-furniture")).toBeHidden();
  const paper = page.locator(".paper");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => document.documentElement.dataset.theme = value, theme);
    for (const edge of ["top", "right", "bottom", "left"])
      await expect(paper).toHaveCSS(`border-${edge}-width`, "0px");
    await expect(paper).toHaveCSS("box-shadow", "none");
  }
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect.poll(() => page.locator(".doc-page-spacer").count()).toBeGreaterThan(0);
  expect((await page.locator(".paper").boundingBox())!.width).toBeCloseTo(1056, 0);
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect.poll(() => page.locator(".doc-page-spacer").count()).toBe(0);
  await editor.press("ControlOrMeta+End");
  await page.keyboard.type(" Phone edit");
  await expect(editor).toContainText("Phone edit");
});

test("Mobile sheet touch: select, pan, lasso, and double tap to edit", async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.goto("/");
  await page.getByRole("button", { name: "New spreadsheet" }).click();
  const host = page.getByLabel("Spreadsheet grid");
  await expect(host).toHaveAttribute("aria-busy", "false");
  const bounds = (await host.boundingBox())!;
  await touchGesture(page, { x: bounds.x + 150, y: bounds.y + 100 });
  await expect(host).toHaveAttribute("data-active-cell");
  const active = () => host.evaluate((el) => JSON.parse((el as HTMLElement).dataset.activeCell!));
  const selected = await active();
  const center = { x: (selected.left + selected.right) / 2, y: (selected.top + selected.bottom) / 2 };
  await expect(page.locator('[data-u-comp="editor"][id*="DOCS_NORMAL"]')).toHaveAttribute("inputmode", "none");
  await touchGesture(page, center, { x: center.x + 70, y: center.y + 40 });
  await expect.poll(async () => (await active()).bottom).toBeGreaterThan(selected.bottom + 10);
  const beforePan = await active();
  await touchGesture(page, { x: bounds.x + 280, y: bounds.y + 200 }, { x: bounds.x + 240, y: bounds.y + 140 });
  await expect.poll(async () => (await active()).top).toBeLessThan(beforePan.top);
  await touchGesture(page, { x: bounds.x + 150, y: bounds.y + 100 });
  const next = await active();
  const nextCenter = { x: (next.left + next.right) / 2, y: (next.top + next.bottom) / 2 };
  await touchGesture(page, nextCenter);
  await touchGesture(page, nextCenter);
  await expect(page.locator('[data-u-comp="editor"][id*="DOCS_NORMAL"]')).toHaveAttribute("inputmode", "text");
});

test("Mobile slide editing keeps the toolbar above the keyboard without blank scroll space", async ({ page, isMobile }) => {
  test.skip(!isMobile);
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /^New presentation/ }).click();
  const text = page.locator(".slide-canvas .element-textarea").first();
  await editSlideText(page.locator(".slide-canvas .slide-text").first());
  await expect(text).toBeFocused();
  await page.keyboard.type("Keyboard viewport");
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 390, offsetTop: 140 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
    window.visualViewport!.dispatchEvent(new Event("scroll"));
  });
  const toolbar = page.getByRole("toolbar", { name: "Slides toolbar" });
  await expect.poll(async () => (await page.locator(".workspace").boundingBox())!.y).toBe(140);
  const menu = (await page.getByRole("menubar", { name: "Main menu" }).boundingBox())!;
  expect(menu.y).toBeGreaterThanOrEqual(140);
  expect((await toolbar.boundingBox())!.y).toBeLessThanOrEqual(menu.y + menu.height + 8);
  await expect(toolbar.getByRole("button", { name: "Menus", exact: true })).toBeInViewport();
  const bold = page.getByRole("toolbar", { name: "Slide text formatting", exact: true }).getByRole("button", { name: "Bold", exact: true });
  await bold.scrollIntoViewIfNeeded();
  await expect(bold).toBeInViewport();
  const workspace = page.locator(".workspace");
  expect((await workspace.boundingBox())!.height).toBe(390);
  expect(await workspace.evaluate((node) => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 844, offsetTop: 0 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect.poll(async () => (await workspace.boundingBox())!.height).toBe(844);
});

test("Mobile slides touch: text selection, editing, slide holds and notes", async ({ page, isMobile }) => {
  test.skip(!isMobile);
  const file = createFile("slide", "Mobile gestures");
  if (file.kind !== "slide") throw new Error("Expected slides");
  const first = file.content.slides[file.content.slideOrder[0]];
  file.content.slideOrder = ["a", "b", "c"];
  file.content.slides = Object.fromEntries(file.content.slideOrder.map((id) => [id, { ...first, id, elements: [{ id: `${id}-text`, type: "text", x: 100, y: 100, width: 400, height: 100, content: `Slide ${id}` }] }]));
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({ name: "mobile.suiteleaf", mimeType: "application/json", buffer: Buffer.from(serializeFile(file)) });
  const text = page.locator('.slide-canvas [data-element-id="a-text"]');
  await expect(text).toBeVisible();
  await expect(page.locator(".speaker-notes-pane")).toBeHidden();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const bounds = (await text.boundingBox())!;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await touchGesture(page, center);
  await expect(text).toHaveClass(/selected/);
  await expect(text.locator(".resize-handle")).toHaveCount(8);
  await expect(text.locator('[contenteditable="true"]')).toHaveCount(0);
  await page.waitForTimeout(400);
  const selectedBounds = (await text.boundingBox())!;
  const dragCenter = { x: selectedBounds.x + selectedBounds.width / 2, y: selectedBounds.y + selectedBounds.height / 2 };
  await touchGesture(page, dragCenter, { x: dragCenter.x + 25, y: dragCenter.y + 20 });
  await expect.poll(async () => (await text.boundingBox())!.x).toBeGreaterThan(bounds.x + 10);
  const resize = (await text.locator(".handle-se").boundingBox())!;
  const beforeResize = (await text.boundingBox())!;
  await touchGesture(page, { x: resize.x + resize.width / 2, y: resize.y + resize.height / 2 }, { x: resize.x + resize.width / 2 + 18, y: resize.y + resize.height / 2 + 12 });
  await expect.poll(async () => (await text.boundingBox())!.width).toBeGreaterThan(beforeResize.width + 10);
  const moved = (await text.boundingBox())!;
  const movedCenter = { x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 };
  await touchGesture(page, movedCenter);
  await touchGesture(page, movedCenter);
  await expect(text.locator('[contenteditable="true"]')).toBeFocused();
  await page.keyboard.type("Edited");
  await page.keyboard.press("Escape");
  await expect(text.locator('[contenteditable="true"]')).toHaveCount(0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const thumb = page.locator('.thumbnail-row[data-slide-id="a"]');
  const thumbBox = (await thumb.boundingBox())!;
  const thumbCenter = { x: thumbBox.x + thumbBox.width / 2, y: thumbBox.y + thumbBox.height / 2 };
  await touchGesture(page, thumbCenter, thumbCenter, 600);
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible();
  await page.locator('.thumbnail-row[data-slide-id="b"]').tap();
  await expect(thumb).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('.thumbnail-row[data-slide-id="b"]')).toHaveAttribute("aria-selected", "true");
  await page.locator('.thumbnail-row[data-slide-id="c"]').scrollIntoViewIfNeeded();
  const second = (await page.locator('.thumbnail-row[data-slide-id="b"]').boundingBox())!;
  const last = (await page.locator('.thumbnail-row[data-slide-id="c"]').boundingBox())!;
  const start = { x: second.x + second.width / 2, y: second.y + second.height / 2 };
  await touchGesture(page, start, { x: last.x + last.width - 4, y: start.y });
  await expect.poll(() => page.locator(".thumbnail-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-slide-id")))).toEqual(["c", "a", "b"]);
  await page.getByRole("button", { name: "Done", exact: true }).tap();
  const firstThumbnail = page.locator('.thumbnail-row[data-slide-id="c"]');
  await firstThumbnail.scrollIntoViewIfNeeded();
  const firstBounds = (await firstThumbnail.boundingBox())!;
  const middleBounds = (await thumb.boundingBox())!;
  await touchGesture(page,
    { x: firstBounds.x + firstBounds.width / 2, y: firstBounds.y + firstBounds.height / 2 },
    { x: middleBounds.x + middleBounds.width - 4, y: firstBounds.y + firstBounds.height / 2 }, 600);
  await expect.poll(() => page.locator(".thumbnail-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-slide-id")))).toEqual(["a", "c", "b"]);
  await page.getByRole("button", { name: "Done", exact: true }).tap();
  await page.getByRole("button", { name: "Speaker notes", exact: true }).tap();
  await expect(page.locator(".notes-textarea")).toBeVisible();
});

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

      // 2. The reflowed editing surface stays within the stage.
      expect(paperBox.x).toBeGreaterThanOrEqual(stageBox.x - 1);
      expect(paperBox.x + paperBox.width).toBeLessThanOrEqual(stageBox.x + stageBox.width + 1);

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

      // 5. Headings sit in a slim bar across the top, not a side column
      const outline = page.locator(".outline");
      await expect(outline).toBeVisible();
      const outlineBox = (await outline.boundingBox())!;
      expect(outlineBox.height).toBeLessThanOrEqual(48);
      expect(outlineBox.x + outlineBox.width).toBeLessThanOrEqual(viewport.width + 1);
    } else {
      // Desktop: paper is standard width and centered
      await expect(page.getByRole("textbox", { name: "File title" })).toBeVisible();
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
    // Playwright's WebKit sends Ctrl+A with the macOS "move to paragraph start"
    // command, which iPhone emulation on Linux applies after the select-all.
    if (isMobile) await editor.selectText();
    else await editor.press("ControlOrMeta+A");

    const boldBtn = page.getByRole("button", { name: "Bold", exact: true });
    await boldBtn.scrollIntoViewIfNeeded();
    await boldBtn.click();

    await expect(editor.locator("strong")).toContainText("Responsive editing");
    await expect(page.locator(".save-status")).toContainText("Saved");
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
    const sheetsToolbar = page.getByRole("toolbar", { name: "Spreadsheet formatting" });
    await expect(sheetsToolbar).toBeVisible();
    const toolbarBox = (await sheetsToolbar.boundingBox())!;
    expect(toolbarBox.height).toBeLessThanOrEqual(55);
    expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(viewport.width);

    if (viewport.width <= 700) {
      for (const name of ["Spreadsheet formatting", "Text formatting"]) {
        const bar = page.getByRole("toolbar", { name, exact: true });
        const metrics = await bar.evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
          return { offset: el.scrollLeft, overflow: getComputedStyle(el).overflowX, scrollbar: getComputedStyle(el).scrollbarWidth };
        });
        expect(metrics.overflow).toBe("auto");
        expect(metrics.offset).toBeGreaterThan(0);
        expect(metrics.scrollbar).toBe("none");
      }
    }

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

    const title = page.locator(".slide-canvas .slide-text").first();
    const fontSize = await title.evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    const scaled = 44 * (canvasBox.width / 960);
    expect(fontSize).toBeGreaterThan(scaled * 0.85);
    expect(fontSize).toBeLessThan(scaled * 1.15);

    if (isMobile) {
      // Thumbnails sit under the slide, across the screen.
      expect(sidebarBox.y).toBeGreaterThan(canvasBox.y + canvasBox.height - 1);
      expect(sidebarBox.width).toBeGreaterThan(viewport.width * 0.9);
      expect(sidebarBox.height).toBeLessThan(viewport.height * 0.4);
      expect(canvasBox.width).toBeGreaterThan(viewport.width * 0.7);

      const tools = page.locator(".header-right-tools");
      const toolsBox = (await tools.boundingBox())!;
      await expect(page.getByRole("textbox", { name: "File title" })).toBeHidden();
      const backBox = (await page.getByRole("button", { name: "Back to files" }).boundingBox())!;
      expect(Math.abs(toolsBox.y + toolsBox.height / 2 - backBox.y - backBox.height / 2)).toBeLessThanOrEqual(2);
    }

    // Canvas fits inside the viewport
    expect(canvasBox.x + canvasBox.width).toBeLessThanOrEqual(viewport.width);

    // Test presentation mode
    const presentBtn = page.getByRole("button", {
      name: "Slideshow",
      exact: true,
    });
    await presentBtn.scrollIntoViewIfNeeded();
    await presentBtn.click();

    const presenterOverlay = page.locator(".presenter-overlay");
    await expect(presenterOverlay).toBeVisible();

    // Exit presentation mode
    await page.getByRole("button", { name: "Exit", exact: true }).click();
    await expect(presenterOverlay).toHaveCount(0);
  });
});

test("Editor menu bars stay above their toolbars without overlapping", async ({ page, isMobile }) => {
  test.skip(isMobile);
  for (const kind of ["document", "spreadsheet", "presentation"]) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: new RegExp(`^New ${kind}`) }).click();
    const bar = page.getByRole("menubar", { name: "Main menu" });
    await expect(bar).toBeInViewport();
    const toolbar = page.getByRole("toolbar").first();
    await expect(toolbar).toBeVisible();
    for (const width of [1280, 760]) {
      await page.setViewportSize({ width, height: 900 });
      const buttons = await bar.locator(".menu-trigger").all();
      for (const button of buttons) await expect(button).toBeInViewport();
      const bounds = (await bar.boundingBox())!;
      let previous = bounds.x;
      for (const button of buttons) {
        await expect(button).toBeInViewport();
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(previous);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y).toBeGreaterThanOrEqual(bounds.y);
        expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
        previous = box.x + box.width;
      }
      await expect(toolbar).toBeVisible();
      expect((await toolbar.boundingBox())!.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
      await bar.getByRole("button", { name: "File", exact: true }).click();
      const menu = page.getByRole("menu");
      await expect(menu).toBeInViewport();
      const popup = (await menu.boundingBox())!;
      expect(popup.y).toBeGreaterThanOrEqual(bounds.y + bounds.height - 4);
      expect(popup.x + popup.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(bar).toBeVisible();
      await assertNoHorizontalScroll(page, `${kind} menu bar at ${width}px`);
    }
  }
});
