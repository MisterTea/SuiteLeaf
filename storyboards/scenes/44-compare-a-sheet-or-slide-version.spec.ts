import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { mimeFor, serializeFile } from "@suiteleaf/core";
import { versionWhen } from "../../apps/web/src/editors/version-history-model";
import {
  ROSTER_EARLIER,
  ROSTER_MORNING,
  ROSTER_YESTERDAY,
  deckFile,
  rosterFile,
} from "../../tests/compare-fixtures";
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

const password = "spring-fair-2026";

function at(daysAgo: number, hour: number, minute: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function document(id: string, paragraphs: string[], when: string) {
  return JSON.stringify({
    format: "suiteleaf",
    version: 1,
    id,
    title: "Quarterly Report",
    createdAt: when,
    updatedAt: when,
    kind: "doc",
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Quarterly Report" }],
        },
        ...paragraphs.map((text) => ({
          type: "paragraph",
          content: [{ type: "text", text }],
        })),
      ],
    },
  });
}

async function account(url: string, name: string, email: string) {
  const response = await fetch(`${url}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify({ name, email, password }),
  });
  const body = (await response.json()) as {
    token?: string;
    user?: { id: string; name: string };
    message?: string;
  };
  if (!response.ok || !body.token || !body.user)
    throw new Error(body.message || `Could not create ${email} (${response.status})`);
  return { token: body.token, user: body.user };
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

async function signIn(page: Page, email: string) {
  const card = page.getByLabel("Sign in to SuiteLeaf");
  await expect(card).toBeVisible();
  await card.getByLabel("Email or username", { exact: true }).click();
  await typeSlowly(page, email, 18);
  await card.getByLabel("Password", { exact: true }).click();
  await typeSlowly(page, password, 16);
  await card.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function showDrive(page: Page) {
  await page
    .getByRole("heading", { name: "SuiteDrive" })
    .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  await beat(page, 500);
}

test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");

test("44-compare-a-sheet-or-slide-version", async ({ page }) => {
  const office = await startServer();
  const rosterId = crypto.randomUUID();
  const deckId = crypto.randomUUID();
  const reportId = crypto.randomUUID();
  const earlierAt = at(2, 16, 40);
  const rosterYesterday = at(1, 18, 5);
  const rosterMorning = at(0, 9, 12);
  const deckYesterday = at(1, 19, 20);
  const deckMorning = at(0, 10, 4);
  const reportYesterday = at(1, 17, 10);
  const reportMorning = at(0, 11, 20);
  try {
    const lena = await account(office.url, "Lena Cho", "lena@spring-fair.org");
    const dev = await account(office.url, "Dev Patel", "dev@spring-fair.org");
    const folder = (await (
      await api(office.url, lena.token, "/api/drive/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Spring fair", kind: "folder" }),
      })
    ).json()) as { id: string };

    const create = async (token: string, name: string, mime: string) =>
      (
        (await (
          await api(office.url, token, "/api/drive/items", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, kind: "file", parentId: folder.id, mime }),
          })
        ).json()) as { id: string }
      ).id;

    const put = async (token: string, itemId: string, mime: string, body: string) =>
      (
        (await (
          await api(office.url, token, `/api/drive/items/${itemId}/content`, {
            method: "PUT",
            headers: { "content-type": mime },
            body,
          })
        ).json()) as { headVersionId: string }
      ).headVersionId;

    const rosterItem = await create(
      lena.token,
      "Volunteer roster.slsheet",
      mimeFor("sheet"),
    );
    const rosterVersions = [
      await put(
        lena.token,
        rosterItem,
        mimeFor("sheet"),
        serializeFile(rosterFile(rosterId, earlierAt, ROSTER_EARLIER, false)),
      ),
      await put(
        lena.token,
        rosterItem,
        mimeFor("sheet"),
        serializeFile(rosterFile(rosterId, rosterYesterday, ROSTER_YESTERDAY, false)),
      ),
      await put(
        lena.token,
        rosterItem,
        mimeFor("sheet"),
        serializeFile(rosterFile(rosterId, rosterMorning, ROSTER_MORNING, true)),
      ),
    ];

    const deckItem = await create(
      lena.token,
      "Fundraiser pitch.slslides",
      mimeFor("slide"),
    );
    const deckOld = await put(
      lena.token,
      deckItem,
      mimeFor("slide"),
      serializeFile(deckFile(deckId, deckYesterday, "Fundraiser pitch", true)),
    );
    await api(office.url, lena.token, `/api/drive/items/${deckItem}/acl`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        principalType: "user",
        principalId: dev.user.id,
        role: "editor",
      }),
    });
    const deckNew = await put(
      dev.token,
      deckItem,
      mimeFor("slide"),
      serializeFile(deckFile(deckId, deckMorning, "Spring fair", false)),
    );

    const reportItem = await create(
      lena.token,
      "Quarterly Report.sldoc",
      mimeFor("doc"),
    );
    const reportOld = await put(
      lena.token,
      reportItem,
      mimeFor("doc"),
      document(reportId, ["Revenue grew in the north.", "Hiring is paused."], reportYesterday),
    );
    const reportNew = await put(
      lena.token,
      reportItem,
      mimeFor("doc"),
      document(reportId, ["Revenue grew in the west.", "Hiring is open."], reportMorning),
    );

    const stamps = [
      [rosterVersions[0], earlierAt],
      [rosterVersions[1], rosterYesterday],
      [rosterVersions[2], rosterMorning],
      [deckOld, deckYesterday],
      [deckNew, deckMorning],
      [reportOld, reportYesterday],
      [reportNew, reportMorning],
    ]
      .map(([id, iso]) => `${id},${iso}`)
      .join("|");
    execFileSync("python3", [
      "-c",
      `import sqlite3,sys
db,pairs=sys.argv[1],sys.argv[2].split("|")
con=sqlite3.connect(db, timeout=30)
for pair in pairs:
    vid, iso = pair.split(",", 1)
    con.execute('UPDATE "drive_version" SET "createdAt" = ? WHERE "id" = ?', (iso, vid))
con.commit()`,
      `${office.dataDir}/suitedb.sqlite`,
      stamps,
    ]);

    const yesterdayRoster = `${versionWhen(rosterYesterday)} · Lena Cho`;
    const yesterdayDeck = `${versionWhen(deckYesterday)} · Lena Cho`;
    const yesterdayReport = `${versionWhen(reportYesterday)} · Lena Cho`;

    await page.goto(office.url);
    await caption(
      page,
      "Lena checks the volunteer roster on the team server, before she decides whether yesterday is worth restoring.",
    );
    await signIn(page, "lena@spring-fair.org");
    await showDrive(page);
    await page.getByRole("button", { name: "Spring fair", exact: true }).click();
    await beat(page, 400);
    await page.getByRole("button", { name: "Volunteer roster.slsheet", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sheet tools", exact: true })).toBeVisible();
    await beat(page, 900);

    await caption(
      page,
      "This morning she confirmed six people and bolded the header. Noah was already confirmed.",
      1600,
    );
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "Version history" });
    await expect(panel.getByText("Current version", { exact: true })).toBeVisible();
    await caption(page, "The clock opens the history. She picks yesterday's roster.", 1100);
    await panel.getByRole("button", { name: yesterdayRoster, exact: true }).click();
    const sheetPreview = page.locator(".sheet-version-preview");
    await expect(panel.getByText("8 cells change", { exact: true })).toBeVisible();
    await expect(sheetPreview.locator("s").filter({ hasText: "Maybe" }).first()).toBeVisible();
    await expect(sheetPreview.locator("u").filter({ hasText: "Waitlist" })).toBeVisible();
    await expect(sheetPreview.locator(".sheet-compare-badge", { hasText: "Bold" }).first()).toBeVisible();
    await expect(sheetPreview.locator('[data-change="same"]', { hasText: "Noah" })).toBeVisible();
    await caption(
      page,
      "Old statuses are struck in red, new ones are green, and the header's bold is marked. Eight cells. Noah's row stays.",
      2200,
    );

    await panel.getByRole("button", { name: "Changes in this version" }).click();
    await expect(panel.getByText("6 cells change in this version", { exact: true })).toBeVisible();
    await expect(sheetPreview.locator("s").filter({ hasText: "Invited" }).first()).toBeVisible();
    await expect(sheetPreview.locator(".sheet-compare-badge", { hasText: "Bold" })).toHaveCount(0);
    await caption(
      page,
      "Changes in this version is only what yesterday itself did. The header was not bold yet.",
      2000,
    );
    await panel.getByRole("button", { name: "Compare with current" }).click();
    await expect(panel.getByText("8 cells change", { exact: true })).toBeVisible();
    await beat(page, 900);

    await caption(page, "The preview is read-only. Typing here changes nothing.", 900);
    await sheetPreview.click();
    await page.keyboard.type("oops");
    await expect(sheetPreview).not.toContainText("oops");
    await beat(page, 700);

    await caption(page, "She closes the panel and does not restore. The morning roster is still the live file.", 1000);
    await page.getByRole("button", { name: "Close version history" }).click();
    await expect(sheetPreview).toHaveCount(0);
    await selectCells(page, "A1");
    await expect(page.getByRole("button", { name: "Bold (Cmd+B)" })).toHaveAttribute("aria-pressed", "true");
    await selectCells(page, "B2");
    await beat(page, 1400);

    await page.getByRole("button", { name: "Back to files" }).click();
    await showDrive(page);
    await caption(page, "Dev rewrote the fundraiser pitch this morning. Lena opens that deck next.", 1200);
    await page.getByRole("button", { name: "Fundraiser pitch.slslides", exact: true }).click();
    await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Spring fair");
    await beat(page, 800);
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    await panel.getByRole("button", { name: yesterdayDeck, exact: true }).click();
    const slidePreview = page.locator(".slide-version-preview");
    await expect(panel.getByText("2 slides change", { exact: true })).toBeVisible();
    await expect(slidePreview.locator("s").filter({ hasText: "Fundraiser pitch" })).toBeVisible();
    await expect(slidePreview.locator("u").filter({ hasText: "Spring fair" })).toBeVisible();
    await caption(
      page,
      "The old title is struck in red. Spring fair is green. The deleted slide is still in the filmstrip.",
      2000,
    );
    await slidePreview.getByRole("button", { name: "Thank you, deleted slide" }).click();
    await expect(slidePreview.locator(".slide-compare-flag")).toHaveText("Deleted");
    await expect(slidePreview.locator("s").filter({ hasText: "Thank you" })).toBeVisible();
    await caption(page, "The thank-you slide is ghosted in red, so a deleted slide is not a surprise.", 2000);
    await slidePreview.click();
    await page.keyboard.type("oops");
    await expect(slidePreview).not.toContainText("oops");
    await beat(page, 500);
    await page.getByRole("button", { name: "Close version history" }).click();
    await expect(page.locator(".slide-canvas textarea").first()).toHaveValue("Spring fair");
    await expect(page.locator(".thumbnail-row")).toHaveCount(2);
    await caption(page, "She does not restore. The live deck is still Spring fair, with no thank-you slide.", 1600);

    await page.getByRole("button", { name: "Back to files" }).click();
    await showDrive(page);
    await caption(page, "A document still compares the way it already did, in green and red.", 1100);
    await page.getByRole("button", { name: "Quarterly Report.sldoc", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Document content" })).toContainText("Hiring is open.");
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    await panel.getByRole("button", { name: yesterdayReport, exact: true }).click();
    const docPreview = page.locator(".version-preview");
    await expect(docPreview.locator("s").filter({ hasText: "north" })).toBeVisible();
    await expect(docPreview.locator("u").filter({ hasText: "west" })).toBeVisible();
    await expect(panel.getByText("2 paragraphs change")).toBeVisible();
    await expect(docPreview).toContainText("Comparing with the current version");
    await caption(page, "Two paragraphs change. She closes without restoring.", 1800);
    await expect(panel.getByRole("button", { name: "Restore this version" })).toBeVisible();
    await page.getByRole("button", { name: "Close version history" }).click();
    await expect(page.getByRole("textbox", { name: "Document content" })).toContainText("Hiring is open.");
    await expect(page.getByRole("textbox", { name: "Document content" })).not.toContainText("paused");
    await beat(page, 800);
  } finally {
    office.stop();
  }
});
