import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { officeFileInput, ready } from "../fixtures";
import { askAgent, beat, caption, describeRun, electronApps, electronMode, expect, openApp, test } from "../harness";

const fileName = "Quarterly studio budget.slsheet";
const resource = (file: any, name: string): string =>
  file.content.workbook.resources.find((r: { name: string }) => r.name === name)?.data ?? "";

/**
 * Where the app's saved copies land: browser downloads on the web; in the
 * desktop app, what its Save As dialog writes (answered with a folder).
 */
async function savesTo(page: Page, app?: ElectronApplication) {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-17-ai-"));
  if (app)
    await app.evaluate(({ dialog }, folder) => {
      (dialog as unknown as Record<string, unknown>).showSaveDialog = async (
        _window: unknown,
        options: { defaultPath: string },
      ) => ({ canceled: false, filePath: `${folder}/${options.defaultPath.split(/[\\/]/).pop()}` });
    }, dir);
  else page.on("download", (d) => void d.saveAs(join(dir, d.suggestedFilename())));
  return async () => {
    await expect.poll(() => readdirSync(dir).filter((n) => n.endsWith(".slsheet")).length, { timeout: 10000 }).toBeGreaterThan(0);
    await beat(page, 300);
    const name = readdirSync(dir).find((n) => n.endsWith(".slsheet"))!;
    return JSON.parse(readFileSync(join(dir, name), "utf8"));
  };
}

/** Jordan's own computer: another browser profile, or another copy of the desktop app. */
async function otherComputer(browser: any, baseURL: string | undefined) {
  if (electronMode) {
    const data = mkdtempSync(join(tmpdir(), "storyboard-17-jordan-"));
    const app = await electron.launch({
      args: [resolve(import.meta.dirname, "../../../apps/desktop/out/main/index.js"), `--user-data-dir=${join(data, "profile")}`],
      env: {
        ...process.env,
        SUITELEAF_TEST_DATA: join(data, "library"),
        SUITELEAF_SETTINGS: join(data, "settings.json"),
        SUITELEAF_HIDE_WINDOWS: "1",
      } as Record<string, string>,
    });
    const page = await app.firstWindow();
    await page.evaluate(() => localStorage.setItem("suiteleaf:display-name", "Jordan"));
    await page.reload();
    return {
      page,
      app,
      close: async () => {
        await app.close();
        rmSync(data, { recursive: true, force: true });
      },
    };
  }
  const context = await browser.newContext({ baseURL, acceptDownloads: true });
  await context.addInitScript(() => localStorage.setItem("suiteleaf:display-name", "Jordan"));
  const page: Page = await context.newPage();
  await page.goto("/");
  return { page, app: undefined, close: () => context.close() };
}

test("17-review-a-budget-with-notes-and-comments-ai", async ({ page, browser, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const savedCopy = await savesTo(page, electronApps.get(page));
  await openApp(page);
  await caption(page, "Alex is reviewing the studio budget before passing it to Jordan, who owns Research.");
  await page.getByRole("button", { name: "Sample budget" }).click();
  await ready(page);
  await caption(page, "Engineering's actual needs explaining, and there's a question for Jordan. Alex asks the assistant.", 1800);
  await caption(page, "", 0);

  const run = await askAgent(
    page,
    "Add a note to Engineering's actual saying it includes the contractor invoice from September. Then leave Jordan a comment on Engineering's remaining: it's $1,200 under budget, can Research use $600 of it for the user study? Sign it as Alex, then download the file so I can send it to Jordan.",
  );
  const why = describeRun(run);
  expect(run.state, why).toBe("done");

  const file = await savedCopy();
  const notes = resource(file, "SHEET_NOTE_PLUGIN"),
    threads = resource(file, "SHEET_UNIVER_THREAD_COMMENT_PLUGIN");
  const saved = `${why}\nNotes: ${notes}\nComments: ${threads}`;
  const sheetId = file.content.workbook.sheetOrder[0];
  const c3 = JSON.parse(notes || "{}")[sheetId]?.[2]?.[2];
  expect(c3?.note, saved).toMatch(/contractor invoice/i);
  expect(c3?.note, saved).toMatch(/September/i);
  const thread = (JSON.parse(threads || "{}")[sheetId] ?? []).find((c: any) => c.ref === "D3" && !c.parentId);
  const text = JSON.stringify(thread?.text ?? "");
  expect(text, saved).toMatch(/\$?600/);
  expect(text, saved).toMatch(/Research/);
  expect(thread?.authorName, saved).toBe("Alex");

  await page.getByRole("button", { name: "Close assistant" }).click();
  await caption(page, "Hovering C3 reads the note back.", 300);
  const host = (await page.locator(".sheet-host").boundingBox())!;
  const note = page.locator('[data-u-comp="note-textarea"]');
  await page.mouse.move(host.x + 46 + 250 - 10, host.y + 58 + 48, { steps: 12 });
  await expect(note, saved).toBeVisible();
  await beat(page, 1600);
  await page.mouse.move(host.x + 600, host.y + 360, { steps: 10 });
  await expect(note).toBeHidden();

  await caption(page, "The Comments panel lists the question on D3, signed by Alex.", 300);
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  const sidebar = page.getByRole("complementary", { name: "Sidebar panel" });
  await expect(sidebar.getByText(/600/), saved).toBeVisible();
  await expect(sidebar.getByText("Alex", { exact: true }), saved).toBeVisible();
  await expect(sidebar.getByText(/D3/).first(), saved).toBeVisible();
  await beat(page, 1800);
  await caption(
    page,
    `The file Gemma ${electronMode ? "saved" : "downloaded"} carries the note and the signed comment. Alex sends it to Jordan.`,
    2200,
  );
  await caption(page, "Jordan opens the copy on their own computer, replies, and sends it back.", 300);

  // Jordan works on their own computer; only Alex's screen is recorded.
  const jordan = await otherComputer(browser, baseURL);
  const jordanSaves = await savesTo(jordan.page, jordan.app);
  await officeFileInput(jordan.page).setInputFiles({
    name: fileName,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await ready(jordan.page);
  await jordan.page.getByRole("button", { name: "Comments", exact: true }).click();
  const jordanPanel = jordan.page.getByRole("complementary", { name: "Sidebar panel" });
  await expect(jordanPanel.getByText("Alex", { exact: true }), saved).toBeVisible();
  await jordanPanel.getByText(/600/).first().click();
  await jordanPanel.locator("canvas#univer-doc-main-canvas").click();
  await jordan.page.keyboard.type("Yes, Research will take the $600. Thanks!");
  await jordanPanel.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(jordanPanel.getByText("Jordan", { exact: true })).toBeVisible();
  await jordan.page.getByRole("button", { name: electronMode ? "Save As" : "Download", exact: true }).click();
  const reply = await jordanSaves();
  await jordan.close();

  await page.getByRole("button", { name: "Back to files" }).click();
  await officeFileInput(page).setInputFiles({
    name: fileName,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(reply)),
  });
  if (!electronMode) {
    // The desktop app opens a returned file as a copy without asking.
    await caption(page, "SuiteLeaf notices the budget is already here. Alex keeps both, to compare.", 300);
    await beat(page, 1200);
    await page.getByRole("dialog").getByRole("button", { name: "Keep both" }).click();
  }
  await ready(page);
  await expect(page.getByLabel("File title")).toHaveValue("Quarterly studio budget copy");
  await caption(page, "Alex opens Jordan's copy. The reply sits under the question, each signed by its writer.", 300);
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await expect(sidebar.getByText("Yes, Research will take the $600. Thanks!")).toBeVisible();
  await expect(sidebar.getByText("Jordan", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Alex", { exact: true })).toBeVisible();
  await beat(page, 1600);
  await caption(page, "Clicking the thread highlights D3. The tick resolves it once it's settled.", 300);
  await sidebar.getByText(/600/).first().click();
  await beat(page, 2600);
  expect(errors, why).toEqual([]);
});
