import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { copyFilename } from "../../apps/web/src/editors/version-history-model";
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
const monday = [
  "Monday — Rosa, greenhouse, 7am",
  "Tuesday — Sam, raised beds, 7am",
  "Wednesday — Priya, compost, 6pm",
  "Thursday — Leo, north fence, 7am",
];
const tuesday = [
  "Monday — Sam, greenhouse, 6am",
  "Tuesday — Sam, all the beds, 7am",
  "Thursday — Leo, north fence, 7am",
  "Friday — Rosa, seed library, 8am",
];

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

async function api(
  url: string,
  token: string,
  path: string,
  init: RequestInit = {},
) {
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
  await beat(page, 600);
}

test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");

test("28-restore-an-earlier-version", async ({ page }) => {
  const office = await startServer();
  const library = await startServer({ dataDir: office.dataDir, p2p: office.p2p });
  const yesterday = at(1, 18, 2);
  const morning = [at(0, 9, 6), at(0, 9, 10), at(0, 9, 14)];
  const fileId = crypto.randomUUID();
  const agreed = document(fileId, monday, yesterday);
  const drafts = [
    document(fileId, ["Monday — Sam, greenhouse, 7am", ...monday.slice(1)], morning[0]),
    document(fileId, [tuesday[0], tuesday[1], ...monday.slice(2)], morning[1]),
    document(fileId, tuesday, morning[2]),
  ];
  const copyName = copyFilename("Watering rota", "Sam Okafor", morning[2], "sldoc");
  try {
    const rosa = await account(office.url, "Rosa Diaz", "rosa@riverside-garden.org");
    const sam = await account(office.url, "Sam Okafor", "sam@riverside-garden.org");
    const folder = (await (
      await api(office.url, rosa.token, "/api/drive/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Garden club", kind: "folder" }),
      })
    ).json()) as { id: string };
    const file = (await (
      await api(office.url, rosa.token, "/api/drive/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Watering rota.sldoc",
          kind: "file",
          parentId: folder.id,
          mime: "application/vnd.suiteleaf.doc+json",
        }),
      })
    ).json()) as { id: string };
    const put = async (token: string, body: string) =>
      (
        (await (
          await api(office.url, token, `/api/drive/items/${file.id}/content`, {
            method: "PUT",
            headers: { "content-type": "application/vnd.suiteleaf.doc+json" },
            body,
          })
        ).json()) as { headVersionId: string }
      ).headVersionId;
    const rosaVersion = await put(rosa.token, agreed);
    await api(office.url, rosa.token, `/api/drive/items/${file.id}/acl`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        principalType: "user",
        principalId: sam.user.id,
        role: "editor",
      }),
    });
    const samVersions = [];
    for (const body of drafts) samVersions.push(await put(sam.token, body));
    const stamps = [
      [rosaVersion, yesterday],
      [samVersions[0], morning[0]],
      [samVersions[1], morning[1]],
      [samVersions[2], morning[2]],
    ]
      .map(([id, iso]) => `${id},${iso}`)
      .join("|");
    execFileSync(
      "python3",
      [
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
      ],
    );

    await page.goto(office.url);
    await caption(page, "Rosa signs in. She wants Monday's agreed rota back, without losing Sam's rewrite.");
    await signIn(page, "rosa@riverside-garden.org");
    await showDrive(page);
    await page.getByRole("button", { name: "Garden club", exact: true }).click();
    await beat(page, 400);
    await caption(page, "She opens the watering rota. Sam rewrote it this morning.");
    await page.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Document content" });
    await expect(editor).toContainText("Friday — Rosa, seed library, 8am");
    await expect(page.getByRole("button", { name: "Version history", exact: true })).toBeVisible();
    await beat(page, 800);

    await caption(page, "Version history is in the File menu too, with its shortcut.", 1200);
    await page.getByRole("button", { name: "File", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: /Version history/ })).toContainText(
      "Cmd+Alt+Shift+H",
    );
    await beat(page, 1200);
    await page.keyboard.press("Escape");

    await caption(page, "One click on the clock opens the history. Newest first, with names and times.", 1000);
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "Version history" });
    await expect(panel.getByText("Current version", { exact: true })).toBeVisible();
    await expect(panel.getByText("Today 09:14 · Sam Okafor")).toBeVisible();
    await expect(panel.getByText("Yesterday 18:02 · Rosa Diaz")).toBeVisible();
    await panel.getByRole("button", { name: "Show earlier autosaves" }).click();
    await page.mouse.move(480, 420);
    await expect(panel.getByText("Today 09:10 · Sam Okafor")).toBeVisible();
    await expect(panel.getByText("Today 09:06 · Sam Okafor")).toBeVisible();
    await caption(page, "Sam's autosaves from the same ten minutes fold under the arrow.", 1800);
    await panel.getByRole("button", { name: "Hide earlier autosaves" }).click();

    await caption(page, "She opens Monday evening. Sam's additions are green; what he deleted is red.", 900);
    await panel.getByRole("button", { name: "Yesterday 18:02 · Rosa Diaz", exact: true }).click();
    const preview = page.locator(".version-preview");
    await expect(preview.locator("u").filter({ hasText: "Friday" })).toBeVisible();
    await expect(preview.locator("s").filter({ hasText: "Wednesday" })).toBeVisible();
    await expect(preview).toContainText("Comparing with the current version");
    await expect(panel.getByText("4 paragraphs change")).toBeVisible();
    await beat(page, 1600);

    await caption(page, "Or she can see only what changed in that version. This one is the earliest.", 900);
    await panel.getByRole("button", { name: "Changes in this version" }).click();
    await expect(preview).toContainText("nothing before it to compare");
    await expect(preview).toContainText("Wednesday — Priya, compost, 6pm");
    await beat(page, 1200);
    await panel.getByRole("button", { name: "Compare with current" }).click();

    await caption(page, "The preview is read-only. Typing here changes nothing.", 800);
    await preview.locator(".document-content").click();
    await page.keyboard.type("oops");
    await expect(preview).not.toContainText("oops");
    await expect(page.locator(".live-editor .document-content")).toContainText(
      "Friday — Rosa, seed library, 8am",
    );
    await beat(page, 800);

    await caption(page, "She names Monday's version so she can find it again.", 800);
    await panel.getByRole("button", { name: "Actions for Yesterday 18:02 · Rosa Diaz" }).click();
    await page.getByRole("menuitem", { name: "Name this version" }).click();
    await page.getByLabel("Version name").click();
    await typeSlowly(page, "Agreed rota");
    await beat(page, 400);
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(panel.getByText("Agreed rota", { exact: true })).toBeVisible();
    await panel.getByRole("checkbox", { name: "Named versions only" }).check();
    await expect(panel.getByText("Today 09:14 · Sam Okafor")).toHaveCount(0);
    await expect(panel.getByText("Agreed rota", { exact: true })).toBeVisible();
    await caption(page, "Named versions only. The name is kept on the server.", 1600);

    await page.reload();
    await expect(editor).toContainText("Friday — Rosa, seed library, 8am");
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    await expect(panel.getByText("Agreed rota", { exact: true })).toBeVisible();
    await caption(page, "She reloads. Agreed rota is still there.", 1400);

    await caption(
      page,
      "Three clicks from the editor: the clock, the version, and Restore. The note says what will change.",
      1400,
    );
    await page.getByRole("button", { name: "Close version history" }).click();
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    await panel.getByRole("button", { name: /^Agreed rota/ }).click();
    await expect(
      panel.getByText(
        'Restore "Agreed rota"? 4 paragraphs change. The current version stays in history.',
      ),
    ).toBeVisible();
    await beat(page, 1200);
    await panel.getByRole("button", { name: "Restore this version" }).click();
    await expect(panel).toHaveCount(0);
    await expect(editor).toContainText("Wednesday — Priya, compost, 6pm");
    await expect(editor).not.toContainText("Friday — Rosa");
    await expect(page.getByRole("status")).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
    await beat(page, 800);
    const saved = () =>
      page.evaluate(async (id) => {
        const session = JSON.parse(localStorage.getItem("suiteleaf:node-session")!);
        const response = await fetch(`${session.url}/api/drive/items/${id}/content`, {
          headers: { authorization: `Bearer ${session.token}` },
        });
        return response.text();
      }, file.id);
    expect(await saved()).toBe(agreed);

    await caption(page, "Back in the history, restoring added a new version. Sam's rewrite is still listed.", 900);
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    await expect(panel.getByText('Restored "Agreed rota" · Rosa Diaz')).toBeVisible();
    await expect(panel.getByText("Today 09:14 · Sam Okafor")).toBeVisible();
    await expect(panel.getByText("Agreed rota", { exact: true })).toBeVisible();
    await beat(page, 1400);

    await caption(page, "She keeps Sam's draft as its own file, in the same folder.", 900);
    await panel.getByRole("button", { name: "Today 09:14 · Sam Okafor", exact: true }).click();
    await panel.getByRole("button", { name: "Actions for Today 09:14 · Sam Okafor" }).click();
    await page.getByRole("menuitem", { name: "Make a copy" }).click();
    await expect(panel.getByText(copyName)).toBeVisible();
    await beat(page, 1200);
    await page.getByRole("button", { name: "Back to files" }).click();
    await showDrive(page);
    await expect(page.getByRole("button", { name: copyName, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Watering rota.sldoc", exact: true })).toBeVisible();
    await caption(page, `“${copyName.replace(".sldoc", "")}” is next to the rota.`, 1800);

    await page.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    await expect(editor).toContainText("Wednesday — Priya, compost, 6pm");
    await caption(page, "She can still change her mind. Restoring 09:14 brings Sam's text back exactly.", 1100);
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    await panel.getByRole("button", { name: "Today 09:14 · Sam Okafor", exact: true }).click();
    await panel.getByRole("button", { name: "Restore this version" }).click();
    await expect(editor).toContainText("Friday — Rosa, seed library, 8am");
    await expect(editor).not.toContainText("Wednesday — Priya");
    await expect(page.getByRole("status")).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
    expect(await saved()).toBe(drafts[2]);
    await beat(page, 1000);

    await expect
      .poll(async () => {
        const session = JSON.parse(
          await page.evaluate(() => localStorage.getItem("suiteleaf:node-session")),
        ) as { token: string };
        const response = await fetch(`${library.url}/api/drive/items/${file.id}/versions`, {
          headers: { authorization: `Bearer ${session.token}` },
        });
        if (!response.ok) return "";
        const body = (await response.json()) as { versions: { name: string | null }[] };
        return body.versions.some((version) => version.name === "Agreed rota") ? "named" : "";
      }, { timeout: 30000 })
      .toBe("named");

    await caption(page, "On the club's other server, Rosa signs in. The name came with the file.", 1200);
    await page.goto(library.url);
    await signIn(page, "rosa@riverside-garden.org");
    await showDrive(page);
    await page.getByRole("button", { name: "Garden club", exact: true }).click();
    await page.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    await expect(editor).toContainText("Friday — Rosa, seed library, 8am", { timeout: 30000 });
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    await expect(panel.getByText("Agreed rota", { exact: true })).toBeVisible();
    await expect(panel.getByText("Sam Okafor").first()).toBeVisible();
    await caption(page, "Agreed rota, Sam's rewrite, and both restores are on this server too.", 2000);
  } finally {
    office.stop();
    library.stop();
  }
});
