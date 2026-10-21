import type { Download, Page } from "@playwright/test";
import JSZip from "jszip";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askAgent, beat, caption, describeRun, electronApps, electronMode, expect, openApp, test, typeSlowly } from "../harness";

/** The minutes as Ben wrote them in the original storyboard, before any page setup. */
const minutes: [string, string?][] = [
  ["Meeting minutes, 8 October", "Heading 1"],
  ["Present: Ben, Ruth, Marek, Asha, Joy. Apologies: Tom."],
  ["The committee agreed the budget for the rainwater tanks and set the date of the harvest supper. Ruth will order timber for the shed roof before the end of the month. Asha will run the seed swap in November."],
  ["Appendix A: plot assignments", "Heading 1"],
  ["Plots 1 to 12: north beds. Plots 13 to 30: south beds. Plot 31: school gardening club."],
  ["Appendix B: work party rota", "Heading 1"],
  ["Tuesdays: Ruth and Marek. Saturdays: Asha, Joy and Ben."],
];

/**
 * The style menu sits inside the font group. On a short toolbar that group
 * stays closed until opened, so the combobox is not on screen yet.
 */
async function chooseParagraphStyle(page: Page, label: string) {
  const style = page.locator('select[aria-label="Paragraph style"]');
  if (!(await style.isVisible()))
    await page.locator(".docs-toolbar .font-popover").evaluate((el: HTMLDetailsElement) => {
      el.open = true;
    });
  await style.selectOption({ label });
}

async function writeMinutes(page: Page) {
  await page.getByRole("button", { name: "New document" }).click();
  const title = page.getByLabel("File title");
  await expect(title).toBeVisible();
  await title.click();
  await title.press("ControlOrMeta+A");
  await typeSlowly(page, "October meeting minutes");
  const editor = page.getByRole("textbox", { name: "Document content" });
  await editor.click();
  await page.getByRole("toolbar", { name: "Document formatting" }).waitFor();
  for (const [i, [text, style]] of minutes.entries()) {
    await page.keyboard.insertText(text);
    if (style) await chooseParagraphStyle(page, style);
    if (i < minutes.length - 1) {
      await page.keyboard.press(process.platform === "darwin" ? "Meta+ArrowRight" : "End");
      await page.keyboard.press("Enter");
    }
    await beat(page, 150);
  }
  await expect(editor.locator("h1")).toHaveCount(3);
  return editor;
}

/**
 * Files the app exports: browser downloads on the web; in the desktop app,
 * what its save dialog writes (answered with a folder standing in for Downloads).
 */
async function collectExports(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-07-ai-"));
  const downloads: Download[] = [];
  const app = electronApps.get(page);
  if (app)
    await app.evaluate(({ dialog }, dir) => {
      (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async (_window: unknown, options: { defaultPath?: string }) => ({
        canceled: false,
        filePath: `${dir}/${(options.defaultPath ?? "export").split(/[\\/]/).pop()}`,
      });
    }, dir);
  else page.on("download", (d) => downloads.push(d));
  return async () => {
    if (app) return readdirSync(dir).map((name) => ({ name, bytes: readFileSync(join(dir, name)) }));
    return Promise.all(downloads.map(async (d) => ({ name: d.suggestedFilename(), bytes: readFileSync((await d.path())!) })));
  };
}

test("07-page-setup-and-export-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Ben has typed up the garden club's October minutes.");
  const editor = await writeMinutes(page);
  await expect(page.locator(".editor-status")).toContainText("1 page");
  const exported = await collectExports(page);
  await caption(page, "Members want a printable Word copy and the website wants a web page. He asks the assistant.");
  const run = await askAgent(
    page,
    'Put Appendix A and Appendix B each on their own page. Add the header "Riverside Garden Club" and the footer "Minutes: draft for members" with page numbers, then export the minutes for Word and as a web page.',
  );
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  await expect(page.locator(".manual-page-break"), why).toHaveCount(2);
  await expect(editor.locator(".manual-page-break + h1"), why).toHaveText(["Appendix A: plot assignments", "Appendix B: work party rota"]);
  await expect(page.locator(".editor-status"), why).toContainText("3 pages");
  const headers = page.locator(".page-header");
  await expect(headers, why).toHaveCount(3);
  await expect(headers, why).toHaveText(Array(3).fill("Riverside Garden Club"));
  const footers = page.locator(".page-footer");
  await expect(footers, why).toHaveCount(3);
  for (const [i, footer] of (await footers.all()).entries()) {
    await expect(footer, why).toContainText("Minutes: draft for members");
    await expect(footer, why).toContainText(`${i + 1} / 3`);
  }
  for (const [text] of minutes) await expect(editor, why).toContainText(text);
  await page.getByRole("button", { name: "Close assistant" }).click();
  await page.mouse.move(640, 300, { steps: 12 });
  await footers.first().evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
  await beat(page, 700);
  await caption(page, "Each appendix starts a new page. Page 1 ends with the footer and \"1 / 3\"; page 2 starts with the club's name.", 2600);

  const files = await exported();
  const docx = files.find((f) => f.name.endsWith(".docx"));
  const html = files.find((f) => f.name.endsWith(".html"));
  expect(docx?.name, `${why}\nExported: ${files.map((f) => f.name).join(", ")}`).toBe("October meeting minutes.docx");
  expect(html?.name, `${why}\nExported: ${files.map((f) => f.name).join(", ")}`).toBe("October meeting minutes.html");

  const zip = await JSZip.loadAsync(docx!.bytes);
  const parts = Object.keys(zip.files);
  const header = await zip.file(parts.find((p) => /word\/header\d*\.xml/.test(p))!)!.async("string");
  expect(header).toContain("Riverside Garden Club");
  const footer = await zip.file(parts.find((p) => /word\/footer\d*\.xml/.test(p))!)!.async("string");
  expect(footer).toContain("Minutes: draft for members");
  expect(footer).toContain("NUMPAGES");
  const body = await zip.file("word/document.xml")!.async("string");
  for (const [text] of minutes) expect(body).toContain(text);
  await caption(page, `"${docx!.name}" is in ${electronMode ? "his chosen folder" : "Downloads"}, with the header, the footer and page numbers.`, 2200);

  const web = html!.bytes.toString("utf8");
  expect(web).toContain("<h1>Appendix A: plot assignments</h1>");
  expect(web).toContain("Tuesdays: Ruth and Marek.");
  expect(web).toContain('<header class="page-header">Riverside Garden Club</header>');
  expect(web).toContain('<footer class="page-footer">Minutes: draft for members</footer>');
  await caption(page, `So is "${html!.name}": the club name above the minutes, the footer below.`, 2200);
  await beat(page, 600);
});
