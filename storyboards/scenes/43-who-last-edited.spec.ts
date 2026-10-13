import { execFileSync } from "node:child_process";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { createFile, mimeFor, serializeFile } from "@suiteleaf/core";
import {
  beat,
  caption,
  clusterReady,
  expect,
  startServer,
  test,
  typeSlowly,
} from "./harness";

const password = "garden-club-2026";

interface Account {
  token: string;
  user: { id: string; name: string; email: string };
}

function at(daysAgo: number, hour: number, minute: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function document(paragraphs: string[], when: string) {
  const id = crypto.randomUUID();
  return JSON.stringify({
    format: "suiteleaf",
    version: 1,
    id,
    title: "Watering rota",
    createdAt: when,
    updatedAt: when,
    kind: "doc",
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Watering rota" }],
        },
        ...paragraphs.map((text) => ({
          type: "paragraph",
          content: [{ type: "text", text }],
        })),
      ],
    },
  });
}

async function account(url: string, name: string, email: string): Promise<Account> {
  const response = await fetch(`${url}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify({ name, email, password }),
  });
  const body = (await response.json()) as Account & { message?: string };
  if (!response.ok || !body.token || !body.user)
    throw new Error(body.message || `Could not create ${email} (${response.status})`);
  return body;
}

async function api(url: string, token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${url}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${text}`);
  }
  return response;
}

async function asUser(page: Page, url: string, who: Account) {
  await page.goto(url);
  await page.evaluate((session) => {
    localStorage.setItem("suiteleaf:node-session", JSON.stringify(session));
  }, { url, token: who.token, user: who.user });
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.locator(".account-name")).toContainText(who.user.name);
}

async function showDrive(page: Page) {
  await page
    .getByRole("heading", { name: "SuiteDrive" })
    .evaluate((el) => el.scrollIntoView({ behavior: "instant", block: "start" }));
  await beat(page, 500);
}

const fileRow = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

async function center(row: Locator) {
  await row.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await beat(row.page(), 400);
}

async function openFolder(page: Page, shared: boolean) {
  await showDrive(page);
  await page.getByRole("tab", { name: shared ? "Shared with me" : "My Drive" }).click();
  await beat(page, 300);
  await page.getByRole("button", { name: "Garden club", exact: true }).click();
  await beat(page, 400);
}

function clockOf(text: string) {
  const match = text.match(
    /(?:Today|Yesterday) \d{2}:\d{2}|\d{1,2} [A-Za-z]{3} \d{2}:\d{2}/,
  );
  if (!match) throw new Error(`No local time in: ${text}`);
  return match[0];
}

async function openContext(browser: Browser, url: string, who: Account) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await asUser(page, url, who);
  return { context, page };
}

/** Click the end of the rota and type a new paragraph, like a person. */
async function addThursday(page: Page) {
  const editor = page.getByRole("textbox", { name: "Document content" });
  await expect(editor).toContainText("Wednesday — Priya");
  const line = (await editor.locator("p").last().boundingBox())!;
  await page.mouse.click(line.x + Math.max(line.width - 8, 8), line.y + line.height / 2);
  await page.keyboard.press("End");
  await beat(page, 200);
  await page.keyboard.press("Enter");
  await typeSlowly(page, "Thursday: ask Alex to cover.", 30);
}

test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");

test("43-who-last-edited", async ({ page, browser }) => {
  const server = await startServer();
  const morning = at(0, 9, 14);
  const yesterday = at(1, 16, 40);
  const extra: BrowserContext[] = [];
  try {
    const rosa = await account(server.url, "Rosa Diaz", "rosa@riverside-garden.org");
    const sam = await account(server.url, "Sam Okafor", "sam@riverside-garden.org");
    const alex = await account(server.url, "Alex Nguyen", "alex@riverside-garden.org");
    const folder = (await (
      await api(server.url, rosa.token, "/api/drive/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Garden club", kind: "folder" }),
      })
    ).json()) as { id: string };
    const rota = (await (
      await api(server.url, rosa.token, "/api/drive/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Watering rota.sldoc",
          kind: "file",
          parentId: folder.id,
          mime: mimeFor("doc"),
        }),
      })
    ).json()) as { id: string };
    const agreed = document(
      [
        "Monday — Rosa, greenhouse, 7am",
        "Tuesday — Sam, raised beds, 7am",
        "Wednesday — Priya, compost, 6pm",
      ],
      yesterday,
    );
    await api(server.url, rosa.token, `/api/drive/items/${rota.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor("doc") },
      body: agreed,
    });
    const slides = createFile("slide", "Spring fair");
    const fair = (await (
      await api(server.url, rosa.token, "/api/drive/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Spring fair.slslides",
          kind: "file",
          parentId: folder.id,
          mime: mimeFor("slide"),
        }),
      })
    ).json()) as { id: string };
    const fairVersion = (
      (await (
        await api(server.url, rosa.token, `/api/drive/items/${fair.id}/content`, {
          method: "PUT",
          headers: { "content-type": mimeFor("slide") },
          body: serializeFile(slides),
        })
      ).json()) as { headVersionId: string }
    ).headVersionId;
    const share = (id: string, role: "editor" | "viewer") =>
      api(server.url, rosa.token, `/api/drive/items/${folder.id}/acl`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ principalType: "user", principalId: id, role }),
      });
    await share(sam.user.id, "editor");
    await share(alex.user.id, "viewer");
    const samVersion = (
      (await (
        await api(server.url, sam.token, `/api/drive/items/${rota.id}/content`, {
          method: "PUT",
          headers: { "content-type": mimeFor("doc") },
          body: document(
            [
              "Monday — Rosa, greenhouse, 7am",
              "Tuesday — Sam, raised beds, 7am",
              "Wednesday — Priya, compost, 6pm",
            ],
            morning,
          ),
        })
      ).json()) as { headVersionId: string }
    ).headVersionId;
    execFileSync("python3", [
      "-c",
      `import sqlite3,sys
db,pairs=sys.argv[1],sys.argv[2].split("|")
con=sqlite3.connect(db, timeout=30)
for pair in pairs:
    vid, iso = pair.split(",", 1)
    con.execute('UPDATE "drive_version" SET "createdAt" = ? WHERE "id" = ?', (iso, vid))
con.commit()`,
      `${server.dataDir}/suitedb.sqlite`,
      `${samVersion},${morning}|${fairVersion},${yesterday}`,
    ]);

    const header = (p: Page) => p.locator(".last-edited");
    const history = (p: Page) => p.getByRole("complementary", { name: "Version history" });

    await asUser(page, server.url, rosa);
    await caption(page, "Rosa opens Garden club. She has not opened the rota yet.");
    await openFolder(page, false);
    const rotaRow = fileRow(page, "Watering rota.sldoc");
    const fairRow = fileRow(page, "Spring fair.slslides");
    await center(rotaRow);
    await expect(rotaRow).toContainText("Sam Okafor");
    await expect(rotaRow).toContainText("Today 09:14");
    await expect(fairRow).toContainText("Rosa Diaz");
    await expect(fairRow).toContainText("Yesterday 16:40");
    await caption(
      page,
      "Rosa owns both files. The row names who last edited: Sam on the rota, Rosa on the slides.",
      2200,
    );

    await caption(page, "She opens the rota. Version history stays closed.");
    await rotaRow.click();
    await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
      "Wednesday — Priya",
    );
    await expect(header(page)).toHaveText("Last edited by Sam Okafor · Today 09:14");
    await expect(history(page)).toHaveCount(0);
    await beat(page, 1600);

    // Leave without saving, so the head author is still Sam.
    await page.goto(server.url);
    await asUser(page, server.url, sam);
    await caption(page, "Sam already has Garden club open. The rota still says he edited it at 09:14.");
    await openFolder(page, true);
    const samRow = fileRow(page, "Watering rota.sldoc");
    await center(samRow);
    await expect(samRow).toContainText("Sam Okafor");
    await expect(samRow).toContainText("Today 09:14");

    const samFile = await openContext(browser, server.url, sam);
    extra.push(samFile.context);
    await openFolder(samFile.page, true);
    await fileRow(samFile.page, "Watering rota.sldoc").click();
    await expect(header(samFile.page)).toHaveText("Last edited by Sam Okafor · Today 09:14");
    await expect(history(samFile.page)).toHaveCount(0);
    await beat(samFile.page, 2500);
    await expect(header(samFile.page)).toHaveText("Last edited by Sam Okafor · Today 09:14");

    const rosaEdit = await openContext(browser, server.url, rosa);
    extra.push(rosaEdit.context);
    await openFolder(rosaEdit.page, false);
    await fileRow(rosaEdit.page, "Watering rota.sldoc").click();
    await expect(header(rosaEdit.page)).toHaveText("Last edited by Sam Okafor · Today 09:14");

    await caption(
      page,
      "On her computer, Rosa adds “Thursday: ask Alex to cover.” Sam does not reload.",
      1800,
    );
    let savedAt = 0;
    let rowAt = 0;
    let fileAt = 0;
    const typing = (async () => {
      await addThursday(rosaEdit.page);
      await expect(rosaEdit.page.getByRole("status")).toHaveText("Saved to SuiteDrive", {
        timeout: 20000,
      });
      await expect(header(rosaEdit.page)).toContainText("Last edited by Rosa Diaz · Today");
      savedAt = Date.now();
    })();
    const rowWatch = (async () => {
      await expect(samRow).toContainText("Rosa Diaz", { timeout: 30000 });
      await expect(samRow).toContainText(/Today \d{2}:\d{2}/);
      rowAt = Date.now();
    })();
    const fileWatch = (async () => {
      await expect(header(samFile.page)).toContainText("Last edited by Rosa Diaz · Today", {
        timeout: 30000,
      });
      fileAt = Date.now();
    })();
    await Promise.all([typing, rowWatch, fileWatch]);
    expect(rowAt - savedAt).toBeLessThan(5000);
    expect(fileAt - savedAt).toBeLessThan(5000);
    const liveTime = clockOf(await header(samFile.page).innerText());
    await Promise.all(extra.map((context) => context.close()));
    extra.length = 0;
    await beat(page, 1200);
    await caption(
      page,
      "The row switches to Rosa Diaz and the new time. Sam had this list open the whole time.",
      2000,
    );

    await samRow.click();
    await expect(page.getByRole("textbox", { name: "Document content" })).toContainText(
      "Thursday: ask Alex to cover.",
    );
    await expect(header(page)).toContainText(`Last edited by Rosa Diaz · ${liveTime}`);
    await expect(history(page)).toHaveCount(0);
    await caption(page, "Sam opens the rota. The header names Rosa, and the history panel is still closed.", 1800);

    await page.goto(server.url);
    await asUser(page, server.url, alex);
    await caption(page, "Alex can only view. He opens the same folder.", 1200);
    await openFolder(page, true);
    const alexRow = fileRow(page, "Watering rota.sldoc");
    await center(alexRow);
    await expect(alexRow).toContainText("Rosa Diaz");
    await expect(alexRow).toContainText(liveTime);
    await expect(page.getByRole("button", { name: "Rename Watering rota.sldoc" })).toHaveCount(0);
    await caption(
      page,
      "The row names Rosa. Alex can read that without opening version history.",
      1800,
    );
    await alexRow.click();
    await expect(page.getByText("View only")).toBeVisible();
    await expect(header(page)).toContainText(`Last edited by Rosa Diaz · ${liveTime}`);
    await expect(history(page)).toHaveCount(0);
    await beat(page, 1400);

    await page.goto(server.url);
    await asUser(page, server.url, rosa);
    await openFolder(page, false);
    await center(fileRow(page, "Watering rota.sldoc"));
    await fileRow(page, "Watering rota.sldoc").click();
    await expect(header(page)).toContainText(`Last edited by Rosa Diaz · ${liveTime}`);
    const shown = clockOf(await header(page).innerText());
    await caption(page, "Rosa opens the clock. The newest version is hers, at the same time.");
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    const panel = history(page);
    await expect(panel.getByText("Current version", { exact: true })).toBeVisible();
    await expect(panel.getByText(`${shown} · Rosa Diaz`)).toBeVisible();
    await beat(page, 1800);
  } finally {
    await Promise.all(extra.map((context) => context.close().catch(() => {})));
    server.stop();
  }
});
