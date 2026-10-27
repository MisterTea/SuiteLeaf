import { expect, test, type Locator, type Page } from "@playwright/test";

const DECK = `---
marp: true
---

# Launch plan

Ship the **beta** in May.

---

# Risks

- Hiring
- Budget
`;

async function openDeck(page: Page, markdown = DECK) {
  await page.goto("/");
  await page
    .locator('input[type="file"]:not([webkitdirectory])')
    .first()
    .setInputFiles({ name: "plan.md", mimeType: "text/markdown", buffer: Buffer.from(markdown) });
  const canvas = page.locator(".slide-canvas");
  await canvas.waitFor();
  await expect(canvas).not.toHaveAttribute("aria-busy", "true");
  return { canvas, markdown: page.getByLabel("Presentation markdown") };
}

function overlapY(a: { y: number; height: number }, b: { y: number; height: number }) {
  return Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
}

test("shows the slide on the left and its markdown on the right, both on screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { canvas, markdown } = await openDeck(page);
  const slide = (await canvas.boundingBox())!;
  const code = (await markdown.boundingBox())!;
  expect(slide.x + slide.width).toBeLessThanOrEqual(code.x);
  expect(overlapY(slide, code)).toBeGreaterThan(slide.height / 2);
  for (const box of [slide, code]) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1440);
    expect(box.y + Math.min(box.height, 200)).toBeLessThanOrEqual(900);
  }
  const left = (await page.locator(".slide-stage-viewport").boundingBox())!;
  const right = (await page.locator(".marp-pane").boundingBox())!;
  expect(Math.abs(left.width - right.width)).toBeLessThan(4);
});

test("dragging the border between the slide and its markdown resizes both, and the split is kept", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { canvas } = await openDeck(page);
  const left = page.locator(".slide-stage-viewport");
  const right = page.locator(".marp-pane");
  const handle = page.getByRole("separator", { name: "Resize the slide and markdown panes" });
  const before = { left: (await left.boundingBox())!, right: (await right.boundingBox())! };
  const grip = (await handle.boundingBox())!;
  expect(Math.abs(grip.x + grip.width / 2 - before.right.x)).toBeLessThan(3);

  await page.mouse.move(grip.x + grip.width / 2, grip.y + 200);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 - 250, grip.y + 200, { steps: 10 });
  await page.mouse.up();
  const after = { left: (await left.boundingBox())!, right: (await right.boundingBox())! };
  expect(after.left.width).toBeCloseTo(before.left.width - 250, -1);
  expect(after.right.width).toBeCloseTo(before.right.width + 250, -1);
  expect(after.left.x + after.left.width).toBeLessThanOrEqual(after.right.x + 1);
  const slide = (await canvas.boundingBox())!;
  expect(slide.x + slide.width).toBeLessThanOrEqual(after.right.x);

  await handle.focus();
  await page.keyboard.press("Home");
  expect((await left.boundingBox())!.width).toBeGreaterThanOrEqual(279);

  await page.keyboard.press("End");
  expect((await right.boundingBox())!.width).toBeGreaterThanOrEqual(279);
  const kept = Number(await handle.getAttribute("aria-valuenow"));
  await openDeck(page);
  await expect(handle).toHaveAttribute("aria-valuenow", String(kept));

  await handle.dblclick();
  await expect(handle).toHaveAttribute("aria-valuenow", "50");
  const even = { left: (await left.boundingBox())!, right: (await right.boundingBox())! };
  expect(Math.abs(even.left.width - even.right.width)).toBeLessThan(4);

  await page.setViewportSize({ width: 640, height: 900 });
  await expect(handle).toBeHidden();
});

test("stacks the markdown under the slide in a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  const { canvas, markdown } = await openDeck(page);
  const slide = (await canvas.boundingBox())!;
  const code = (await markdown.boundingBox())!;
  expect(code.y).toBeGreaterThanOrEqual(slide.y + slide.height - 1);
  expect(code.width).toBeGreaterThan(400);
});

test("typing on the slide rewrites only those words in the markdown", async ({ page }) => {
  const { canvas, markdown } = await openDeck(page);
  const title = canvas.locator("textarea.element-textarea").first();
  await expect(title).toHaveValue("Launch plan");
  await title.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" v2");
  await expect(markdown).toHaveValue(DECK.replace("# Launch plan", "# Launch plan v2"));

  const body = canvas.locator("[data-element-id]").filter({ hasText: "Ship the beta in May." });
  await body.dblclick();
  const editor = body.locator("[contenteditable='true']");
  await editor.click();
  await expect(editor).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.type(" Maybe June.");
  await expect(markdown).toHaveValue(
    DECK.replace("# Launch plan", "# Launch plan v2").replace("in May.", "in May. Maybe June."),
  );

  const titleSize = () =>
    canvas
      .locator("textarea.element-textarea")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el.closest("[data-element-id]")!).fontSize));
  const typed = await titleSize();
  await page.locator(".slide-stage-viewport").click({ position: { x: 4, y: 4 } });
  expect(Math.abs((await titleSize()) - typed)).toBeLessThan(1);
  await expect(canvas).not.toHaveAttribute("aria-busy", "true");
  await expect(canvas.locator("textarea.element-textarea").first()).toHaveValue("Launch plan v2");
  expect(Math.abs((await titleSize()) - typed)).toBeLessThan(1);
  await expect(canvas).toContainText("Ship the beta in May. Maybe June.");
});

test("underline and color chosen on the slide are written as HTML and drawn after layout", async ({ page }) => {
  const source = DECK.replace("in May.", "in May. See [notes](https://example.com).");
  const { canvas, markdown } = await openDeck(page, source);
  const body = canvas.locator("[data-element-id]").filter({ hasText: "Ship the beta" });
  await body.dblclick();
  const editor = body.locator("[contenteditable='true']");
  await editor.click();
  const select = (word: string) =>
    editor.evaluate((root, word) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent!.indexOf(word);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + word.length);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
        return;
      }
      throw new Error(`${word} not found`);
    }, word);

  await select("May");
  await page.getByRole("button", { name: "Underline", exact: true }).click();
  await expect(markdown).toHaveValue(source.replace("in May.", "in <u>May</u>."));
  await select("beta");
  await page.getByRole("button", { name: "Accent colour for the selection" }).click();
  const styled = source
    .replace("in May.", "in <u>May</u>.")
    .replace("**beta**", '<span style="color: #188038">**beta**</span>');
  await expect(markdown).toHaveValue(styled);

  await page.locator(".slide-stage-viewport").click({ position: { x: 4, y: 4 } });
  await expect(canvas).not.toHaveAttribute("aria-busy", "true");
  await expect(markdown).toHaveValue(styled);
  await expect(canvas).toHaveClass(/marp-painted/);
  const look = (word: string) =>
    page.locator(".slide-canvas .marp-backdrop[data-state=shown]").evaluate((frame, word) => {
      const doc = (frame as HTMLIFrameElement).contentDocument!;
      const node = [...doc.querySelectorAll("section *")]
        .reverse()
        .find((el) => el.textContent?.trim() === word);
      if (!node) return null;
      const view = doc.defaultView!;
      let underline = false;
      for (let at: Element | null = node; at && at.tagName !== "SECTION"; at = at.parentElement)
        underline ||= view.getComputedStyle(at).textDecorationLine.includes("underline");
      return { underline, color: view.getComputedStyle(node).color };
    }, word);
  await expect.poll(() => look("May")).toMatchObject({ underline: true });
  await expect.poll(() => look("beta")).toMatchObject({ color: "rgb(24, 128, 56)" });

  await body.dblclick();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect(markdown).toHaveValue(styled.replace("(https://example.com).", "(https://example.com).!"));
});

test("a bullet that wraps keeps MARP's hanging indent while it is being typed in", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const item =
    "This bullet is long enough that it has to wrap onto a second line, and then it keeps going onto a third line";
  const { canvas } = await openDeck(page, `---\nmarp: true\n---\n\n# Plan\n\n- ${item}\n- Short\n`);
  await expect(canvas).toHaveClass(/marp-painted/);

  /** Left edge of each line of the first item's words, skipping its bullet, in page pixels. */
  const lineStarts = (root: Element, offset: { x: number; scale: number }) => {
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const lines = new Map<number, number>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? "";
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "\n" && lines.size) return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, left]) => left);
        if (!/\S/.test(text[i]) || text[i] === "•") continue;
        const range = doc.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        const top = Math.round(rect.top / 4);
        lines.set(top, Math.min(lines.get(top) ?? Infinity, offset.x + rect.left * offset.scale));
      }
    }
    return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, left]) => left);
  };

  const drawn = await page
    .locator(".slide-canvas .marp-backdrop[data-state=shown]")
    .evaluate((frame, source) => {
      const iframe = frame as HTMLIFrameElement;
      const li = [...iframe.contentDocument!.querySelectorAll("li")].find((el) =>
        el.textContent?.includes("keeps going"),
      )!;
      const outer = iframe.getBoundingClientRect();
      const measure = new Function(`return (${source})`)() as typeof lineStarts;
      return measure(li, { x: outer.x, scale: outer.width / iframe.offsetWidth });
    }, lineStarts.toString());
  expect(drawn.length).toBeGreaterThanOrEqual(2);

  const box = canvas.locator("[data-element-id]").filter({ hasText: "keeps going" });
  await expect(box.locator("textarea")).toHaveCount(0);
  await box.click();
  const editor = box.locator("[contenteditable='true']");
  await expect(editor).toBeFocused();
  const typed = await editor.evaluate(
    (root, source) => (new Function(`return (${source})`)() as typeof lineStarts)(root, { x: 0, scale: 1 }),
    lineStarts.toString(),
  );
  expect(typed).toHaveLength(drawn.length);
  for (const [i, left] of typed.entries()) expect(Math.abs(left - drawn[i])).toBeLessThan(2);
});

test("choosing a box scrolls the markdown to it, and the slide follows the markdown caret", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const slides = Array.from({ length: 12 }, (_, i) => `# Slide ${i + 1}\n\nBody ${i + 1} has a few words.\n`);
  const source = `---\nmarp: true\n---\n\n${slides.join("\n---\n\n")}`;
  const { canvas, markdown } = await openDeck(page, source);
  const active = page.locator(".thumbnail-row.active");
  const lineOf = (text: string) => source.slice(0, source.indexOf(text)).split("\n").length - 1;
  const view = () =>
    markdown.evaluate((area: HTMLTextAreaElement) => ({
      top: area.scrollTop,
      height: area.clientHeight,
      line: parseFloat(getComputedStyle(area).lineHeight),
      pad: parseFloat(getComputedStyle(area).paddingTop),
      caret: area.selectionStart,
    }));
  const shows = async (line: number) => {
    const now = await view();
    const y = now.pad + line * now.line;
    return y >= now.top && y + now.line <= now.top + now.height;
  };
  expect(await shows(lineOf("Body 11 has"))).toBe(false);

  await page.getByRole("option", { name: /^Slide 11:/ }).click();
  await canvas.locator("[data-element-id]").filter({ hasText: "Body 11 has" }).click();
  await expect.poll(() => shows(lineOf("Body 11 has"))).toBe(true);
  expect((await view()).caret).toBe(source.indexOf("Body 11 has"));
  await expect(markdown).not.toBeFocused();

  await markdown.evaluate((area: HTMLTextAreaElement) => (area.scrollTop = 0));
  const start = await view();
  await markdown.click({ position: { x: 40, y: start.pad + (lineOf("Body 3 has") + 0.5) * start.line } });
  await expect(active).toHaveAttribute("aria-label", /^Slide 3:/);
  for (let i = 0; i < lineOf("# Slide 4") - lineOf("Body 3 has"); i++) await page.keyboard.press("ArrowDown");
  await expect(active).toHaveAttribute("aria-label", /^Slide 4:/);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(active).toHaveAttribute("aria-label", /^Slide 4:/);
  await page.keyboard.press("ArrowUp");
  await expect(active).toHaveAttribute("aria-label", /^Slide 3:/);
  await page.keyboard.press("PageDown");
  await expect(active).not.toHaveAttribute("aria-label", /^Slide 3:/);
  const paged = await view();
  expect(paged.caret).toBeGreaterThan(source.indexOf("Body 3 has"));
  expect(await shows(source.slice(0, paged.caret).split("\n").length - 1)).toBe(true);
  await page.keyboard.press("PageUp");
  await expect(active).toHaveAttribute("aria-label", /^Slide 3:/);
});

const RAW = `---
marp: true
---

# Raw HTML

Text with H<sub>2</sub>O inside.

<svg width="300" height="120"><rect width="300" height="120" rx="16" fill="#818cf8"/></svg>

<div class="note" style="position:absolute; right:60px; bottom:60px; padding:12px 18px; background:#f59e0b">Positioned</div>

<img src="missing.png" onerror="window.parent.pwned = true">
`;

async function openRaw(page: Page) {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await page
    .locator('input[type="file"]:not([webkitdirectory])')
    .first()
    .setInputFiles({ name: "raw.md", mimeType: "text/markdown", buffer: Buffer.from(RAW) });
  await page.getByRole("button", { name: "Import without pictures" }).click();
  const canvas = page.locator(".slide-canvas");
  await expect(canvas).not.toHaveAttribute("aria-busy", "true");
  await expect(canvas).toHaveClass(/marp-painted/);
  return { canvas, markdown: page.getByLabel("Presentation markdown"), pageErrors };
}

test("authored HTML cannot run code, and the slide shows it where MARP draws it", async ({ page }) => {
  const { canvas, pageErrors } = await openRaw(page);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as unknown as { pwned?: boolean }).pwned)).toBeUndefined();
  expect(pageErrors).toEqual([]);

  const blocks = canvas.locator(".marp-html");
  await expect(blocks).toHaveCount(3);
  const slide = (await canvas.boundingBox())!;
  const note = (await blocks.nth(1).boundingBox())!;
  expect(note.x).toBeGreaterThan(slide.x + slide.width * 0.6);
  expect(note.y).toBeGreaterThan(slide.y + slide.height * 0.6);
  const drawn = await page.locator(".slide-canvas .marp-backdrop[data-state=shown]").evaluate((frame) => {
    const iframe = frame as HTMLIFrameElement;
    const rect = iframe.contentDocument!.querySelector(".note")!.getBoundingClientRect();
    const outer = iframe.getBoundingClientRect();
    const scale = outer.width / iframe.offsetWidth;
    return { x: outer.x + rect.x * scale, y: outer.y + rect.y * scale, width: rect.width * scale };
  });
  expect(Math.abs(drawn.x - note.x)).toBeLessThan(3);
  expect(Math.abs(drawn.y - note.y)).toBeLessThan(3);
  expect(Math.abs(drawn.width - note.width)).toBeLessThan(3);
});

test("double-clicking an HTML block selects its markdown, and typing hides only that box's drawing", async ({ page }) => {
  const { canvas, markdown } = await openRaw(page);
  await canvas.locator(".marp-html").first().dblclick();
  await expect(markdown).toBeFocused();
  expect(
    await markdown.evaluate((area: HTMLTextAreaElement) => area.value.slice(area.selectionStart, area.selectionEnd)),
  ).toBe('<svg width="300" height="120"><rect width="300" height="120" rx="16" fill="#818cf8"/></svg>');

  const hidden = () =>
    page
      .locator(".slide-canvas .marp-backdrop[data-state=shown]")
      .evaluate((frame) =>
        [...(frame as HTMLIFrameElement).contentDocument!.querySelectorAll<HTMLElement>("[data-sl-lines]")]
          .filter((node) => node.style.visibility === "hidden")
          .map((node) => node.textContent?.trim()),
      );
  const text = canvas.locator("textarea.element-textarea").nth(1);
  await text.click();
  await expect.poll(hidden).toEqual(["Text with H2O inside."]);
  await page.keyboard.press("End");
  await page.keyboard.type(" Really");
  await expect(markdown).toHaveValue(RAW.replace("H<sub>2</sub>O inside.", "H<sub>2</sub>O inside. Really"));
  await page.locator(".slide-stage-viewport").click({ position: { x: 4, y: 4 } });
  await expect.poll(hidden).toEqual([]);
  await expect(canvas).not.toHaveAttribute("aria-busy", "true");
});

test("typing markdown redraws the slide, and invalid markdown is reported on the slide pane", async ({ page }) => {
  const { canvas, markdown } = await openDeck(page);
  await page.getByRole("option", { name: /^Slide 2:/ }).click();
  await markdown.fill(DECK.replace("- Budget", "- Budget\n- Timeline"));
  await expect(canvas).toContainText("Timeline");

  await markdown.fill(`${DECK}\n\`\`\`js\nconst unfinished = true;\n`);
  const alert = page.getByRole("alert").filter({ hasText: "The markdown is invalid." });
  await expect(alert).toBeVisible();
  await expect(page.locator(".slide-canvas")).toHaveCount(0);
  const notice = (await alert.boundingBox())!;
  const code = (await markdown.boundingBox())!;
  expect(notice.x + notice.width).toBeLessThanOrEqual(code.x);

  await markdown.fill(`${DECK}\n\`\`\`js\nconst unfinished = false;\n\`\`\`\n`);
  await expect(alert).toHaveCount(0);
  await expect(page.locator(".slide-canvas")).toBeVisible();
  await expect(page.locator(".slide-canvas")).not.toHaveAttribute("aria-busy", "true");
});

async function colorAt(page: Page, target: Locator, fx: number, fy: number) {
  const box = (await target.boundingBox())!;
  const png = await page.screenshot({
    clip: { x: box.x + box.width * fx, y: box.y + box.height * fy, width: 1, height: 1 },
  });
  return page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, `data:image/png;base64,${png.toString("base64")}`);
}

test("thumbnails and the slideshow show what the theme draws, as the editor does", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const themed = DECK.replace(
    "---\n\n# Launch plan",
    "---\n\n<style>\nsection { box-shadow: inset 0 -80px 0 rgb(0, 128, 0); }\n</style>\n\n# Launch plan",
  );
  const { canvas } = await openDeck(page, themed);
  await expect(canvas).toHaveClass(/marp-painted/);
  const green = [0, 128, 0];
  const near = (color: number[]) => color.every((value, i) => Math.abs(value - green[i]) < 12);
  await expect.poll(async () => near(await colorAt(page, canvas, 0.5, 0.97))).toBe(true);

  const thumbnail = page.locator(".thumbnail-row").nth(1).locator(".thumbnail-preview");
  await expect(thumbnail.locator(".slide-surface.marp-painted")).toHaveCount(1);
  await expect.poll(async () => near(await colorAt(page, thumbnail, 0.5, 0.95))).toBe(true);

  await page.locator(".slideshow-btn").first().click();
  const slide = page.locator(".presenter-slide-box");
  const showing = slide.locator(".slide-still:not(.slide-still-waiting) > .slide-surface");
  await expect(showing).toHaveClass(/marp-painted/);
  await expect.poll(async () => near(await colorAt(page, slide, 0.5, 0.97))).toBe(true);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".presenter-counter")).toHaveText("Slide 2 of 2");
  await expect(showing).toHaveClass(/marp-painted/);
  await expect.poll(async () => near(await colorAt(page, slide, 0.5, 0.97))).toBe(true);
});
