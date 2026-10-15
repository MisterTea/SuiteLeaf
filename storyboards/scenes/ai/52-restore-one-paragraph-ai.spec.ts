import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { askAgent, caption, clusterReady, describeRun, expect, startServer, test, typeSlowly } from "../harness";

const password = "garden-club-2026";
const prompt =
  'Restore only the north-bed paragraph from the version named "Agreed rota", so that paragraph becomes "North bed: 6am". Leave every other paragraph as it is, including "Thursday: ask Alex to cover." and the bold "South bed: 7am". Do not restore the whole version and do not make another file.';

function at(daysAgo: number, hour: number, minute: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  const latest = Date.now() - 2 * 60 * 1000;
  if (d.getTime() > latest) d.setTime(latest);
  return d.toISOString();
}

function earlierToday() {
  const now = new Date();
  const d = new Date(now.getTime() - 30 * 60 * 1000);
  if (d.toDateString() !== now.toDateString()) d.setHours(0, 1, 0, 0);
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

async function api(url: string, token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${url}${path}`, { ...init, headers });
  if (!response.ok) {
    const textBody = await response.text();
    throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${textBody}`);
  }
  return response;
}

/** Rosa signs in herself. The assistant never types the password. */
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

test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");

test("52-restore-one-paragraph-ai", async ({ page }) => {
  const office = await startServer();
  const yesterday = at(1, 18, 2);
  const morning = earlierToday();
  const fileId = crypto.randomUUID();
  const agreed = document(
    fileId,
    [paragraph("North bed: 6am"), paragraph("South bed: 7am")],
    yesterday,
  );
  const tuesday = document(
    fileId,
    [
      paragraph("North bed: 8am"),
      paragraph("South bed: 7am", [{ type: "bold" }]),
      paragraph("Thursday: ask Alex to cover."),
    ],
    morning,
  );
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
    await caption(page, "Rosa signs in. She wants Monday's north-bed time back, and Sam's Thursday line kept.");
    await signIn(page, "rosa@riverside-garden.org");
    await page
      .getByRole("heading", { name: "SuiteDrive" })
      .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    await page.getByRole("button", { name: "Garden club", exact: true }).click();
    await page.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Document content" });
    await expect(editor).toContainText("North bed: 8am");
    await expect(editor).toContainText("Thursday: ask Alex to cover.");
    await expect(editor.locator("strong")).toHaveText("South bed: 7am");
    await caption(page, "The rota is open. She asks the assistant to restore only the north-bed paragraph.", 1000);

    const run = await askAgent(page, prompt);
    const why = describeRun(run);
    expect(run.state, why).toBe("done");

    await expect(editor, why).toContainText("North bed: 6am");
    await expect(editor, why).not.toContainText("8am");
    await expect(editor, why).toContainText("Thursday: ask Alex to cover.");
    await expect(editor.locator("strong"), why).toHaveText("South bed: 7am");
    await expect(page.getByRole("status"), why).toHaveText("Saved to SuiteDrive", { timeout: 20000 });

    const head = await (
      await api(office.url, rosa.token, `/api/drive/items/${file.id}/content`)
    ).text();
    const listed = (await (
      await api(office.url, rosa.token, `/api/drive/items/${file.id}/versions`)
    ).json()) as { versions: { id: string; name: string | null }[] };
    const folderItems = (await (
      await api(office.url, rosa.token, `/api/drive/items?parent=${folder.id}`)
    ).json()) as { items: { kind: string; name: string }[] };

    expect(head, why).toContain("North bed: 6am");
    expect(head, why).toContain("Thursday: ask Alex to cover.");
    expect(head, why).toContain('"type":"bold"');
    expect(head, why).not.toContain("North bed: 8am");
    expect(listed.versions[0]?.name, why).toBe("Restored the north-bed paragraph");
    expect(listed.versions.some((version) => version.name === "Agreed rota"), why).toBe(true);
    expect(listed.versions.some((version) => version.id === samVersion), why).toBe(true);
    expect(
      folderItems.items.filter((item) => item.kind === "file").map((item) => item.name),
      why,
    ).toEqual(["Watering rota.sldoc"]);
    await caption(page, "Monday's 6am is back. Thursday stays, South bed is still bold, and there is still one rota.", 1800);
  } finally {
    office.stop();
  }
});
