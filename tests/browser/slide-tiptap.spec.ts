import { expect, test, type Locator, type Page } from "@playwright/test";

const specimens = [
  { id: "bullets", hang: 24, runs: [{ text: "• First item with enough words to wrap onto another line" }, { text: "\n", paragraphBreak: true }, { text: "• Second item" }] },
  { id: "symbols", runs: [{ text: "▪ ", font: "SuiteLeaf Sprig", paraHang: 24, listDepth: 0 }, { text: "First item with enough words to wrap onto another line" }, { text: "\n", paragraphBreak: true, paraHang: 22, paraMargin: 36, listDepth: 1 }, { text: "▪ ", font: "SuiteLeaf Sprig" }, { text: "Second nested item" }] },
  { id: "mixed", runs: [{ text: "Large ", fontSize: 30, bold: true }, { text: "and small words flowing together across several lines", fontSize: 16 }] },
  { id: "kerned", kern: 12, runs: [{ text: "A varied paragraph with AVATAR typography and several words wrapping across multiple lines.", fontSize: 22 }] },
  { id: "rotated", rotation: 12, hang: 24, runs: [{ text: "• First item with enough words to wrap onto another line" }, { text: "\n", paragraphBreak: true }, { text: "• Second item" }] },
  { id: "autofit", autofit: true, fontSize: 34, runs: [{ text: "This text should shrink to fit its box while maintaining the same wrapping and type size as editing starts.", fontSize: 34 }] },
];

function deck(elements: Record<string, unknown>[], slideCount = 1) {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const slideOrder = Array.from({ length: slideCount }, () => crypto.randomUUID());
  return { format: "suiteleaf", version: 1, id, title: "Tiptap slide trial", kind: "slide", createdAt: now, updatedAt: now, content: {
    id, width: 960, height: 540, slideOrder,
    slides: Object.fromEntries(slideOrder.map(sid => [sid, { id: sid, background: { color: "#ffffff" }, elements: elements.map(el => ({ type: "text", x: 30, y: 40, width: 265, height: 190, fontSize: 22, fontFamily: "SuiteLeaf Willow", color: "#172033", align: "left", ...el, content: (el.runs as { text: string }[]).map(run => run.text).join("") })) }])),
  } };
}

async function open(page: Page, file: ReturnType<typeof deck>, trial = true) {
  await page.goto(trial ? "/" : "/?slideText=legacy");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({ name: "Tiptap trial.slslides", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await expect(page.getByLabel("File title")).toHaveValue("Tiptap slide trial");
  if (trial) await expect(page.locator(".slide-canvas .slide-tiptap-text").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function moveToEnd(page: Page, editor: Locator) {
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ArrowRight");
  // Native arrow navigation updates DOM selection before selectionchange reaches ProseMirror.
  await expect.poll(() => editor.evaluate(root => {
    const instance = (root as unknown as { editor?: { state: { selection: { empty: boolean } } } }).editor;
    return window.getSelection()?.isCollapsed && (!instance || instance.state.selection.empty);
  })).toBe(true);
}

async function geometry(box: Locator) {
  return box.evaluate(root => {
    const origin = root.getBoundingClientRect();
    const walker = document.createTreeWalker(root.querySelector(".element-textarea")!, NodeFilter.SHOW_TEXT);
    const glyphs: { char: string; x: number; y: number; width: number; height: number }[] = [];
    let node;
    while ((node = walker.nextNode())) {
      for (let index = 0; index < (node.textContent?.length ?? 0); index++) {
        const char = node.textContent![index];
        if (/\s/.test(char)) continue;
        const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 1);
        const r = range.getBoundingClientRect();
        if (r.width && r.height) glyphs.push({ char, x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height });
      }
    }
    return glyphs;
  });
}

function sameGeometry(before: Awaited<ReturnType<typeof geometry>>, after: Awaited<ReturnType<typeof geometry>>) {
  expect(after.map(g => g.char)).toEqual(before.map(g => g.char));
  before.forEach((g, i) => {
    for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(after[i][key] - g[key])).toBeLessThan(0.01);
  });
}

for (const width of [1440, 1000]) test(`static and live text have identical geometry at viewport ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await open(page, deck(specimens.map((s, i) => ({ ...s, x: 30 + i % 3 * 310, y: 40 + Math.floor(i / 3) * 240, height: s.autofit ? 130 : 190 }))));
  for (const specimen of specimens) {
    const box = page.locator(`.slide-canvas [data-element-id="${specimen.id}"]`);
    const before = await geometry(box);
    expect(before.length).toBeGreaterThan(10);
    await box.locator(".element-editor").dblclick();
    await expect(box.locator(".ProseMirror")).toBeFocused();
    sameGeometry(before, await geometry(box));
    await page.locator(".slide-canvas").click({ position: { x: 5, y: 5 } });
    await expect(page.locator(".slide-canvas .ProseMirror")).toHaveCount(0);
    sameGeometry(before, await geometry(box));
  }
});

test("real typing continues symbol bullets, nests items, and survives slide undo", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await open(page, deck([{ id: "words", runs: [{ text: "▪ ", font: "SuiteLeaf Sprig", paraHang: 24 }, { text: "First" }] }]));
  const box = page.locator('.slide-canvas [data-element-id="words"]');
  await box.locator(".element-editor").dblclick();
  const editor = box.locator(".ProseMirror");
  await expect(editor).toBeFocused();
  await moveToEnd(page, editor);
  await page.keyboard.press("Enter");
  await page.keyboard.type("New item", { delay: 15 });
  await expect(editor.locator("[data-slide-content]")).toHaveText(["First", "New item"]);
  await expect(editor.locator("li")).toHaveCount(2);
  await page.keyboard.press("Tab");
  await expect(editor.locator("ul ul")).toHaveCount(1);
  await page.keyboard.press("Shift+Tab");
  await expect(editor.locator("ul ul")).toHaveCount(0);
  await page.keyboard.type("!");
  await expect(editor).toContainText("New item!");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).not.toContainText("New item!");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(editor).toContainText("New item!");
  await page.locator(".slide-canvas").click({ position: { x: 5, y: 5 } });
  await box.locator(".element-editor").dblclick();
  await expect(box.locator(".ProseMirror [data-slide-content]")).toHaveText(["First", "New item!"]);
  expect(errors).toEqual([]);
});

test("indenting the first Office bullet changes its position and level color in both views", async ({ page }, info) => {
  await open(page, deck([{ id: "words", width: 700, height: 350, fontSize: 59, runs: [
    { text: "§ ", font: "SuiteLeaf Sprig", color: "#333399", listDepth: 0, listColors: ["#333399", "#000000"], listFontSizes: [59, 52], paraHang: 27 },
    { text: "Public imagination", color: "#333399", fontSize: 59 },
    { text: "\n", paragraphBreak: true, listDepth: 0 },
    { text: "§ ", font: "SuiteLeaf Sprig", color: "#333399" }, { text: "Economy", color: "#333399", fontSize: 59 },
  ] }]));
  const box = page.locator('.slide-canvas [data-element-id="words"]');
  const word = box.getByText("Public imagination", { exact: true });
  const x = () => word.evaluate(node => node.getBoundingClientRect().x);
  const before = await x();
  const size = await word.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  await box.locator(".element-editor").dblclick();
  await expect(box.locator(".ProseMirror")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(word).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect.poll(() => word.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(size * 52 / 59, 1);
  expect(await x()).toBeGreaterThan(before + 10);
  await page.locator(".slide-canvas").click({ position: { x: 5, y: 5 } });
  await expect(box.locator(".ProseMirror")).toHaveCount(0);
  await expect(word).toHaveCSS("color", "rgb(0, 0, 0)");
  await page.screenshot({ path: info.outputPath("indented-first-bullet.png") });
  await box.locator(".element-editor").dblclick();
  await expect(box.locator(".ProseMirror")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(word).toHaveCSS("color", "rgb(51, 51, 153)");
  await expect.poll(() => word.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeCloseTo(size, 1);
  expect(Math.abs(await x() - before)).toBeLessThan(0.01);
});

test("dense-slide benchmark compares one live editor with the current implementation", async ({ browser }, info) => {
  test.setTimeout(180000);
  const results: Record<string, unknown>[] = [];
  for (const count of [20, 100]) for (const trial of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const elements = Array.from({ length: count }, (_, i) => ({ id: `box-${i}`, x: 20 + i % 10 * 92, y: 20 + Math.floor(i / 10) * 48, width: 88, height: 42, fontSize: 12, runs: [{ text: `Box ${i}`, bold: true }] }));
    const start = Date.now();
    await open(page, deck(elements, 3), trial);
    const importMs = Date.now() - start;
    await cdp.send("HeapProfiler.collectGarbage");
    const metrics = await cdp.send("Performance.getMetrics");
    const heapMB = (metrics.metrics.find(m => m.name === "JSHeapUsedSize")?.value ?? 0) / 1024 / 1024;
    const inactiveEditors = await page.locator(".slide-canvas .ProseMirror").count();
    const activateMs = await page.locator('.slide-canvas [data-element-id="box-0"]').evaluate(root => new Promise<number>(resolve => {
      const start = performance.now();
      root.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const check = () => {
        if (root.querySelector('[contenteditable="true"]')) requestAnimationFrame(() => resolve(performance.now() - start));
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }));
    const editor = page.locator('.slide-canvas [data-element-id="box-0"] [contenteditable="true"]');
    await expect(editor).toBeFocused();
    await moveToEnd(page, editor);
    await editor.evaluate(root => {
      (window as unknown as { slideTiming: number[] }).slideTiming = [];
      root.addEventListener("beforeinput", () => {
        const start = performance.now();
        requestAnimationFrame(() => (window as unknown as { slideTiming: number[] }).slideTiming.push(performance.now() - start));
      }, { capture: true });
    });
    await page.keyboard.type(" performance check", { delay: 15 });
    await expect(editor).toContainText("Box 0 performance check");
    const samples = await page.evaluate(() => (window as unknown as { slideTiming: number[] }).slideTiming);
    expect(samples.length).toBeGreaterThan(10);
    samples.sort((a, b) => a - b);
    const activeEditors = await page.locator(".slide-canvas .ProseMirror").count();
    if (trial) { expect(inactiveEditors).toBe(0); expect(activeEditors).toBe(1); }
    const row = { boxesPerSlide: count, slides: 3, mode: trial ? "tiptap" : "current", importMs, activateMs: +activateMs.toFixed(1), inputToFrameP50Ms: +samples[Math.floor(samples.length * 0.5)].toFixed(1), inputToFrameP95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(1), heapMB: +heapMB.toFixed(1), inactiveEditors, activeEditors };
    results.push(row);
    console.log(JSON.stringify(row));
    await context.close();
  }
  await info.attach("slide-text-benchmark.json", { body: JSON.stringify(results, null, 2), contentType: "application/json" });
});

test("mixed-size Office bullets fit their box in display and editing", async ({ page }) => {
  const { readFileSync } = await import("node:fs");
  const body = JSON.parse(readFileSync(new URL("../fixtures/slide-clipping.json", import.meta.url), "utf8"));
  const file = deck([body]);
  Object.assign(file.content, { pointWidth: 1920, pointHeight: 1080 });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, file);
  const box = page.locator('.slide-canvas [data-element-id="clipping-body"]');
  const check = async () => {
    const bounds = await box.evaluate(root => {
      const editor = root.querySelector<HTMLElement>(".element-editor")!;
      const paragraphs = [...editor.querySelectorAll<HTMLElement>("[data-slide-para]")];
      const last = paragraphs.at(-1)!;
      return { bottom: last.getBoundingClientRect().bottom, edge: editor.getBoundingClientRect().bottom,
        sizes: paragraphs.map(p => parseFloat(getComputedStyle(p).fontSize)) };
    });
    expect(bounds.bottom).toBeLessThan(bounds.edge);
    expect(bounds.sizes[1] / bounds.sizes[0]).toBeCloseTo(56 / 64, 3);
  };
  await check();
  const before = await geometry(box);
  await box.locator(".element-editor").dblclick();
  await expect(box.locator(".ProseMirror")).toBeFocused();
  await check();
  sameGeometry(before, await geometry(box));
});

test("paragraph animation badges follow their first lines as the box wraps and resizes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, deck([{ id: "animated", x: 100, width: 400, height: 420, paragraphBuilds: [
    { start: 1, end: 1, order: 1 }, { start: 2, end: 2, order: 2 },
  ], runs: [{ text: "" }, { text: "\n", paragraphBreak: true },
    { text: "• First item with enough words to wrap onto another line" },
    { text: "\n", paragraphBreak: true }, { text: "• Second item" }],
  }]));
  const box = page.locator('.slide-canvas [data-element-id="animated"]');
  for (const width of [1440, 1000]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const index of [1, 2]) {
      const badge = box.locator(`[data-animation-paragraph="${index}"]`);
      await expect(badge).toBeVisible();
      await expect.poll(async () => {
        const b = (await badge.boundingBox())!;
        const p = (await box.locator("[data-office-paragraph]").nth(index).boundingBox())!;
        return b.y + b.height / 2 - p.y;
      }).toBeGreaterThan(0);
      const b = (await badge.boundingBox())!;
      const p = (await box.locator("[data-office-paragraph]").nth(index).boundingBox())!;
      expect(b.x + b.width).toBeLessThan(p.x);
      expect(b.y).toBeLessThan(p.y + 30);
    }
  }
  await page.screenshot({ path: "test-results/paragraph-animation-badges.png" });
});
