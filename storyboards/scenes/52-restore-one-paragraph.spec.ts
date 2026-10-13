import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
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
const prompt =
  'Restore the north-bed paragraph from "Agreed rota"? It becomes "North bed: 6am". The rest of the document stays as it is.';

function at(daysAgo: number, hour: number, minute: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  // Version history lists the newest createdAt first. A same-day 09:14 is
  // still in the future after midnight, which would sort Sam ahead of the restore.
  const latest = Date.now() - 2 * 60 * 1000;
  if (d.getTime() > latest) d.setTime(latest);
  return d.toISOString();
}

function text(value: string, marks?: { type: string }[]) {
  return marks ? { type: "text", text: value, marks } : { type: "text", text: value };
}

function paragraph(value: string, marks?: { type: string }[]) {
  return { type: "paragraph", content: [text(value, marks)] };
}

function document(id: string, blocks: object[], when: string) {
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
          content: [text("Watering rota")],
        },
        ...blocks,
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
    const textBody = await response.text();
    throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${textBody}`);
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

test("52-restore-one-paragraph", async ({ page }) => {
  const office = await startServer();
  const library = await startServer({ dataDir: office.dataDir, p2p: office.p2p });
  const yesterday = at(1, 18, 2);
  // Sam's save has to sort after the agreed version and before the restore.
  // A clock time of 09:14 today is still in the future before that hour, so
  // history would list it ahead of the restore.
  const morning = at(1, 21, 14);
  const morningLabel = "Yesterday 21:14";
  const fileId = crypto.randomUUID();
  const agreed = document(fileId, [
    paragraph("North bed: 6am"),
    paragraph("South bed: 7am"),
  ], yesterday);
  const tuesday = document(fileId, [
    paragraph("North bed: 8am"),
    paragraph("South bed: 7am", [{ type: "bold" }]),
    paragraph("Thursday: ask Alex to cover."),
  ], morning);
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
    const samVersion = await put(sam.token, tuesday);
    await api(office.url, rosa.token, `/api/drive/items/${file.id}/versions/${rosaVersion}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Agreed rota" }),
    });
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
      `${rosaVersion},${yesterday}|${samVersion},${morning}`,
    ]);

    await page.goto(office.url);
    await caption(page, "Rosa opens the watering rota. She wants Monday's times back, and Sam's Thursday line kept.");
    await signIn(page, "rosa@riverside-garden.org");
    await showDrive(page);
    await page.getByRole("button", { name: "Garden club", exact: true }).click();
    await beat(page, 400);
    await page.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Document content" });
    await expect(editor).toContainText("North bed: 8am");
    await expect(editor).toContainText("Thursday: ask Alex to cover.");
    await expect(editor.locator("strong")).toHaveText("South bed: 7am");
    await beat(page, 1200);

    await caption(page, "The clock, then Monday's Agreed rota. The page compares it with the file she has open.", 1000);
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "Version history" });
    await panel.getByRole("button", { name: /^Agreed rota/ }).click();
    const preview = page.locator(".version-preview");
    await expect(preview).toContainText("Comparing with the current version");
    await expect(preview.locator("s").filter({ hasText: "6am" })).toBeVisible();
    await expect(preview.locator("u").filter({ hasText: "8am" })).toBeVisible();
    await expect(preview.locator("u").filter({ hasText: "Thursday: ask Alex to cover." })).toBeVisible();
    await caption(page, "North bed shows Monday's 6am. Thursday is marked as added later. Typing does nothing.", 900);
    await preview.getByText("Watering rota", { exact: true }).click();
    await page.keyboard.type("oops");
    await expect(preview).not.toContainText("oops");
    await expect(page.locator(".live-editor .document-content")).toContainText("North bed: 8am");
    await beat(page, 900);

    await caption(
      page,
      "Three clicks from the editor: the clock, Agreed rota, and Restore this paragraph. The note names what stays.",
      1200,
    );
    await page.getByRole("button", { name: "Close version history" }).click();
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    await panel.getByRole("button", { name: /^Agreed rota/ }).click();
    const north = preview.locator(".paragraph-restore").filter({ hasText: prompt });
    await expect(north).toBeVisible();
    await expect(preview.locator(".paragraph-restore")).toHaveCount(2);
    await expect(preview.getByText(/south-bed/)).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Restore this version" })).toBeVisible();
    await beat(page, 1600);
    const before = await page.evaluate(async (id) => {
      const session = JSON.parse(localStorage.getItem("suiteleaf:node-session")!) as {
        token: string;
        url: string;
      };
      const response = await fetch(`${session.url}/api/drive/items/${id}/content`, {
        headers: { authorization: `Bearer ${session.token}` },
      });
      return response.text();
    }, file.id);
    await north.getByRole("button", { name: "Restore this paragraph" }).click();

    await expect(panel).toHaveCount(0);
    await expect(editor).toContainText("North bed: 6am");
    await expect(editor).not.toContainText("8am");
    await expect(editor).toContainText("Thursday: ask Alex to cover.");
    await expect(editor.locator("strong")).toHaveText("South bed: 7am");
    await expect(page.getByRole("status")).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
    await caption(page, "Monday's 6am is back. Thursday stays, and South bed is still bold.", 1800);

    await caption(page, "The partial restore is a new version. Agreed rota and Sam's Tuesday file are still listed.", 900);
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    await expect(panel.getByText("Restored the north-bed paragraph", { exact: true })).toBeVisible();
    await expect(panel.getByText("Agreed rota", { exact: true })).toBeVisible();
    await expect(panel.getByText(`${morningLabel} · Sam Okafor`)).toBeVisible();
    await expect(editor).toContainText("North bed: 6am");
    await expect(editor).toContainText("Thursday: ask Alex to cover.");
    await beat(page, 1600);

    const versions = (await (
      await api(office.url, rosa.token, `/api/drive/items/${file.id}/versions`)
    ).json()) as {
      versions: { id: string; name: string | null }[];
    };
    expect(versions.versions[0]?.name).toBe("Restored the north-bed paragraph");
    expect(versions.versions.some((version) => version.name === "Agreed rota")).toBe(true);
    expect(versions.versions.some((version) => version.id === samVersion)).toBe(true);
    const previousId = versions.versions[1]?.id;
    expect(previousId).toBeTruthy();
    const previousBody = await (
      await api(office.url, rosa.token, `/api/drive/items/${file.id}/content?version=${previousId}`)
    ).text();
    const samBody = await (
      await api(office.url, rosa.token, `/api/drive/items/${file.id}/content?version=${samVersion}`)
    ).text();
    expect(samBody).toBe(tuesday);
    expect(previousBody).toContain("North bed: 8am");
    expect(previousBody).toContain("Thursday: ask Alex to cover.");
    expect(previousBody).toContain('"type":"bold"');
    expect(previousBody).not.toContain("North bed: 6am");
    if (previousId === samVersion) expect(previousBody).toBe(before);
    const files = (await (
      await api(office.url, rosa.token, `/api/drive/items?parent=${folder.id}`)
    ).json()) as { items: { kind: string; name: string }[] };
    expect(files.items.filter((item) => item.kind === "file").map((item) => item.name)).toEqual([
      "Watering rota.sldoc",
    ]);

    await expect
      .poll(async () => {
        const response = await fetch(`${library.url}/api/drive/items/${file.id}/versions`, {
          headers: { authorization: `Bearer ${rosa.token}` },
        });
        if (!response.ok) return "";
        const body = (await response.json()) as { versions: { name: string | null }[] };
        const names = body.versions.map((version) => version.name);
        return names.includes("Agreed rota") && names.includes("Restored the north-bed paragraph")
          ? "synced"
          : "";
      }, { timeout: 30000 })
      .toBe("synced");

    await caption(page, "On the club's other server, the mix is there, and Agreed rota is still the name.", 1000);
    await page.goto(library.url);
    await signIn(page, "rosa@riverside-garden.org");
    await showDrive(page);
    await page.getByRole("button", { name: "Garden club", exact: true }).click();
    await expect(page.getByRole("button", { name: "Watering rota.sldoc", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /draft/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    await expect(editor).toContainText("North bed: 6am", { timeout: 30000 });
    await expect(editor).toContainText("Thursday: ask Alex to cover.");
    await expect(editor.locator("strong")).toHaveText("South bed: 7am");
    await page.getByRole("button", { name: "Version history", exact: true }).click();
    await expect(panel.getByText("Agreed rota", { exact: true })).toBeVisible();
    await expect(panel.getByText("Restored the north-bed paragraph", { exact: true })).toBeVisible();
    await caption(page, "6am, the Thursday line, and the named Monday version all travelled with the file.", 2000);
  } finally {
    office.stop();
    library.stop();
  }
});
