import { createHash } from "node:crypto";
import {
  createFile,
  mimeFor,
  nativeFilename,
  serializeFile,
  type SheetFile,
  type SlideFile,
} from "@suiteleaf/core";
import type { Page } from "@playwright/test";
import {
  beat,
  caption,
  clusterReady,
  expect,
  selectCells,
  startServer,
  test,
  typeSlowly,
} from "./harness";

const password = "garden-club";

interface Account {
  token: string;
  user: { id: string; name: string; email: string };
}

async function signup(url: string, name: string, email: string): Promise<Account> {
  const response = await fetch(`${url}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify({ name, email, password }),
  });
  if (!response.ok)
    throw new Error(`Could not create ${email}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function authed(url: string, token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const response = await fetch(`${url}${path}`, { ...init, headers });
  if (!response.ok)
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  return response;
}

async function storeFile(
  url: string,
  token: string,
  file: ReturnType<typeof createFile>,
) {
  const item = await (
    await authed(url, token, "/api/drive/items", {
      method: "POST",
      body: JSON.stringify({
        name: nativeFilename(file),
        kind: "file",
        mime: mimeFor(file.kind),
      }),
    })
  ).json();
  await authed(url, token, `/api/drive/items/${item.id}/content`, {
    method: "PUT",
    headers: { "content-type": mimeFor(file.kind) },
    body: serializeFile(file),
  });
  return item.id as string;
}

async function share(
  url: string,
  token: string,
  id: string,
  userId: string,
  role: "viewer" | "commenter" | "editor",
) {
  await authed(url, token, `/api/drive/items/${id}/acl`, {
    method: "PUT",
    body: JSON.stringify({ principalType: "user", principalId: userId, role }),
  });
}

async function digest(url: string, token: string, id: string) {
  const response = await authed(url, token, `/api/drive/items/${id}/content`);
  return createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
}

async function signIn(page: Page, email: string) {
  const card = page.getByLabel("Sign in to SuiteLeaf");
  await expect(card).toBeVisible();
  await card.getByLabel("Email or username", { exact: true }).click();
  await typeSlowly(page, email);
  await card.getByLabel("Password", { exact: true }).click();
  await typeSlowly(page, password, 20);
  await card.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function showDrive(page: Page) {
  await page
    .getByRole("heading", { name: "SuiteDrive" })
    .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  await beat(page, 700);
}

const formulaEditor = (page: Page) =>
  page.locator("[data-u-comp='formula-bar'] [data-u-comp='formula-editor']").first();

async function formulaBar(page: Page) {
  return (await page.locator(".sheet-host").getAttribute("data-active-value")) ?? "";
}

function plotSheet() {
  const file = createFile("sheet", "Plot assignments") as SheetFile;
  const sheetId = file.content.workbook.sheetOrder[0];
  const sheet = file.content.workbook.sheets[sheetId];
  const rows = [
    ["Plot", "Bed", "Gardener"],
    ["1", "North", "Rosa"],
    ["2", "South", "Alex"],
    ["3", "North", "Sam"],
    ["4", "East", "Priya"],
  ];
  sheet.cellData = Object.fromEntries(
    rows.map((row, r) => [
      r,
      Object.fromEntries(row.map((v, c) => [c, { v, t: 1 }])),
    ]),
  );
  const text = "Who has the north bed?";
  file.content.workbook.resources = [
    {
      name: "SHEET_UNIVER_THREAD_COMMENT_PLUGIN",
      data: JSON.stringify({
        [sheetId]: [
          {
            id: "plot-c4",
            threadId: "plot-c4",
            ref: "C4",
            dT: "2026-04-02T15:00:00.000Z",
            personId: "Owner_rosa",
            authorName: "Rosa Diaz",
            text: {
              dataStream: `${text}\r\n`,
              paragraphs: [{ startIndex: text.length }],
              sectionBreaks: [{ startIndex: text.length + 1 }],
            },
            unitId: file.content.workbook.id,
            subUnitId: sheetId,
            row: 3,
            column: 2,
          },
        ],
      }),
    },
  ];
  return file;
}

function fairSlides() {
  const file = createFile("slide", "Spring fair") as SlideFile;
  const slide = file.content.slides[file.content.slideOrder[0]];
  slide.elements[0].content = "Spring fair";
  slide.elements[1].content = "Meet by the north gate";
  return file;
}

test("41-viewer-of-a-sheet-or-deck", async ({ page, context }) => {
  test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");
  test.setTimeout(300_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    let current: Element | null = null;
    const change = (el: Element | null) => {
      current = el;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    };
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => current,
    });
    Element.prototype.requestFullscreen = function () {
      return change(this);
    };
    document.exitFullscreen = () => change(null);
  });

  const server = await startServer();
  try {
    const rosa = await signup(server.url, "Rosa Diaz", "rosa@gardenclub.org");
    const alex = await signup(server.url, "Alex Rivera", "alex@gardenclub.org");
    const priya = await signup(server.url, "Priya Shah", "priya@gardenclub.org");
    const sheetId = await storeFile(server.url, rosa.token, plotSheet());
    const deckId = await storeFile(server.url, rosa.token, fairSlides());
    await share(server.url, rosa.token, sheetId, alex.user.id, "viewer");
    await share(server.url, rosa.token, deckId, alex.user.id, "viewer");
    await share(server.url, rosa.token, sheetId, priya.user.id, "commenter");
    const sheetBefore = await digest(server.url, rosa.token, sheetId);
    const deckBefore = await digest(server.url, rosa.token, deckId);

    await page.goto(server.url);
    await caption(page, "Alex signs in to look up the garden plots. He can read, not change them.");
    await signIn(page, "alex@gardenclub.org");
    await showDrive(page);
    await page.getByRole("tab", { name: "Shared with me" }).click();
    const sheetRow = page.getByRole("button", { name: "Plot assignments.slsheet", exact: true });
    await expect(sheetRow).toContainText("Rosa Diaz");
    await expect(sheetRow).toContainText("Can view");
    await caption(page, "Shared with me lists the sheet as view only, before he opens it.", 1600);
    await sheetRow.click();
    await expect(page.getByText("View only", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sheet tools", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bold (Cmd+B)" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Undo (Cmd+Z)" })).toBeDisabled();
    await expect(page.getByLabel("Font family")).toBeDisabled();
    await expect(formulaEditor(page)).toHaveAttribute("data-view-locked", "");
    await expect(
      page.getByRole("toolbar", { name: "Spreadsheet formatting" }).getByLabel("Zoom"),
    ).toBeEnabled();
    await expect(page.getByRole("button", { name: "Print (Cmd+P)" })).toBeEnabled();
    await caption(
      page,
      "View only is already on. The formula bar and editing tools are grey. Zoom and Print still work.",
      2200,
    );

    let uploads = 0;
    page.on("request", (request) => {
      if (request.method() === "PUT" && request.url().includes("/content")) uploads += 1;
    });
    await selectCells(page, "C4");
    await expect.poll(() => formulaBar(page)).toBe("Sam");
    await caption(page, "He clicks Sam's plot and types. The letters never land in the cell.", 1200);
    await typeSlowly(page, "Alex");
    await expect.poll(() => formulaBar(page)).toBe("Sam");
    await page.keyboard.press("Enter");
    await beat(page, 400);
    await selectCells(page, "C4");
    await expect.poll(() => formulaBar(page)).toBe("Sam");
    await page.evaluate(() => navigator.clipboard.writeText("Alex"));
    await page.keyboard.press("ControlOrMeta+v");
    await page.keyboard.press("Delete");
    await beat(page, 500);
    await selectCells(page, "C4");
    await expect.poll(() => formulaBar(page)).toBe("Sam");
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
    await expect(page.getByText("Save failed")).toHaveCount(0);
    await expect(page.getByText("Saving", { exact: false }).filter({ hasText: /^Saving/ })).toHaveCount(0);
    expect(uploads).toBe(0);
    await caption(page, "Paste and Delete do the same. Nothing starts a save, and nothing reports an error.", 1800);

    await caption(page, "Three clicks: Data, Filter views, Bed: North. Only on his screen.", 1000);
    await page.getByRole("button", { name: "Data", exact: true }).click();
    await beat(page, 400);
    await page.getByRole("menuitem", { name: "Filter views" }).click();
    await beat(page, 400);
    await page.getByRole("menuitem", { name: "Bed: North" }).click();
    const filterBar = page.locator(".filter-view-bar");
    await expect(filterBar).toContainText("Showing Bed is North");
    await expect(filterBar).toContainText("only on this screen");
    await expect.poll(async () => Number(await filterBar.getAttribute("data-filtered"))).toBeGreaterThan(0);
    await beat(page, 1600);
    await caption(page, "South and East drop out. Rosa's file is not touched.", 1400);

    await page.getByRole("button", { name: "Back to files" }).click();
    await showDrive(page);
    await page.getByRole("tab", { name: "Shared with me" }).click();
    await sheetRow.click();
    await expect(page.getByText("View only", { exact: true })).toBeVisible();
    await expect(page.locator(".filter-view-bar")).toHaveCount(0);
    await selectCells(page, "B3");
    await expect.poll(() => formulaBar(page)).toContain("South");
    await caption(page, "He opens it again. Every bed is back, including South.", 1600);

    await caption(page, "Priya can comment. She still cannot change a cell.", 1000);
    await page.getByRole("button", { name: "Back to files" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, "priya@gardenclub.org");
    await showDrive(page);
    await page.getByRole("tab", { name: "Shared with me" }).click();
    await sheetRow.click();
    await expect(page.getByText("Can comment", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bold (Cmd+B)" })).toBeDisabled();
    await expect(formulaEditor(page)).toHaveAttribute("data-view-locked", "");
    await selectCells(page, "C4");
    await typeSlowly(page, "nope");
    await expect.poll(() => formulaBar(page)).toBe("Sam");
    await page.getByRole("button", { name: "Comments", exact: true }).click();
    const commentsPanel = page.getByRole("complementary", { name: "Sidebar panel" });
    await expect(commentsPanel.getByText("Comment Management")).toBeVisible();
    await expect(commentsPanel.getByText("Rosa Diaz")).toBeVisible();
    await expect(commentsPanel.getByText("C4 · Sheet1")).toBeVisible();
    await caption(page, "Rosa's question is on Sam's cell. Priya replies.", 1400);
    await page.getByText("Rosa Diaz", { exact: true }).click();
    await beat(page, 400);
    await commentsPanel.locator("canvas").last().click({ force: true });
    await page.keyboard.type("Sam has the north bed.", { delay: 40 });
    const submit = page.locator("button:not([disabled])", { hasText: /^Comment$/ });
    await expect(submit.first()).toBeEnabled();
    await submit.first().click();
    await expect(commentsPanel.getByText("Priya Shah").first()).toBeVisible();
    await beat(page, 1400);
    expect(uploads).toBe(0);

    const sheetAfter = await digest(server.url, rosa.token, sheetId);
    const deckAfter = await digest(server.url, rosa.token, deckId);
    expect(sheetAfter).toBe(sheetBefore);
    expect(deckAfter).toBe(deckBefore);

    await caption(page, "Alex opens the spring fair slides, also view only.", 1000);
    await page.getByRole("button", { name: "Back to files" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, "alex@gardenclub.org");
    await showDrive(page);
    await page.getByRole("tab", { name: "Shared with me" }).click();
    const deckRow = page.getByRole("button", { name: "Spring fair.slslides", exact: true });
    await expect(deckRow).toContainText("Can view");
    await deckRow.click();
    await expect(page.getByText("View only", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Theme" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "+ New slide" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Insert text box" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Slideshow", exact: true })).toBeEnabled();
    const title = page.locator(".slide-canvas .element-textarea").first();
    await expect(title).toHaveValue("Spring fair");
    await title.click();
    await expect(page.getByRole("button", { name: "Bold", exact: true })).toBeDisabled();
    await caption(page, "Bold, Theme, New slide, and the text tools are grey. Present stays on.", 1800);
    await page.keyboard.press("ControlOrMeta+b");
    await typeSlowly(page, " extra");
    await expect(title).toHaveValue("Spring fair");
    await expect(page.getByText("Unsaved changes")).toHaveCount(0);
    await expect(page.getByText("Save failed")).toHaveCount(0);
    expect(uploads).toBe(0);
    await caption(page, "Typing and Bold change nothing, and nothing tries to save.", 1600);

    await caption(page, "Slideshow still plays the deck.", 900);
    await page.getByRole("button", { name: "Slideshow", exact: true }).click();
    const show = page.locator(".presenter-overlay");
    await expect(show).toBeVisible();
    await expect(show).toContainText("Spring fair");
    await beat(page, 1600);
    await page.keyboard.press("Escape");
    await expect(show).toHaveCount(0);
    await expect(page.getByText("View only", { exact: true })).toBeVisible();
    await caption(page, "Esc returns to the same read-only slides.", 1400);

    await caption(page, "Rosa opens the sheet. Her tools are on, and Sam is still Sam.", 1000);
    await page.getByRole("button", { name: "Back to files" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, "rosa@gardenclub.org");
    await showDrive(page);
    await page.getByRole("button", { name: "Plot assignments.slsheet", exact: true }).click();
    await expect(page.getByText("View only", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Bold (Cmd+B)" })).toBeEnabled();
    await expect(
      page.getByRole("toolbar", { name: "Spreadsheet formatting" }).getByLabel("Zoom"),
    ).toBeEnabled();
    await selectCells(page, "C4");
    await expect.poll(() => formulaBar(page)).toContain("Sam");
    await selectCells(page, "D2");
    await typeSlowly(page, "ok");
    await page.keyboard.press("Enter");
    await selectCells(page, "D2");
    await expect.poll(() => formulaBar(page)).toBe("ok");
    await caption(page, "She can type. Alex's keystrokes were never stored.", 1600);

    await page.getByRole("button", { name: "Back to files" }).click();
    await showDrive(page);
    await page.getByRole("button", { name: "Spring fair.slslides", exact: true }).click();
    await expect(page.getByRole("button", { name: "Theme" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "+ New slide" })).toBeEnabled();
    const rosaTitle = page.locator(".slide-canvas .element-textarea").first();
    await expect(rosaTitle).toHaveValue("Spring fair");
    await rosaTitle.click();
    await rosaTitle.evaluate((el) => {
      const field = el as HTMLTextAreaElement;
      field.setSelectionRange(field.value.length, field.value.length);
    });
    await typeSlowly(page, "!");
    await expect(rosaTitle).toHaveValue("Spring fair!");
    await caption(page, "The slides still say what Rosa wrote, and she can add to them.", 1800);
  } finally {
    server.stop();
  }
});
