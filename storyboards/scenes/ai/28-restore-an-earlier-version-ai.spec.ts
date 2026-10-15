import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { askAgent, caption, clusterReady, describeRun, expect, startServer, test, typeSlowly } from "../harness";

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

function paragraphs(native: string): string[] {
  const file = JSON.parse(native) as {
    content?: { content?: { type?: string; content?: { text?: string }[] }[] };
  };
  const lines: string[] = [];
  for (const node of file.content?.content ?? []) {
    if (node.type !== "paragraph") continue;
    const text = (node.content ?? []).map((part) => part.text ?? "").join("");
    if (text) lines.push(text);
  }
  return lines;
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

const prompt =
  "Sam rewrote this watering rota this morning. Restore Rosa Diaz's version from yesterday evening, 18:02, so the document is the agreed rota again. Keep Sam's rewrite in the history.";

test.skip(!clusterReady, "Needs the suiteleaf-node binary and auth bundle.");

test("28-restore-an-earlier-version-ai", async ({ page }) => {
  const office = await startServer();
  const yesterday = at(1, 18, 2);
  const morning = [at(0, 9, 6), at(0, 9, 10), at(0, 9, 14)];
  const fileId = crypto.randomUUID();
  const agreed = document(fileId, monday, yesterday);
  const drafts = [
    document(fileId, ["Monday — Sam, greenhouse, 7am", ...monday.slice(1)], morning[0]),
    document(fileId, [tuesday[0], tuesday[1], ...monday.slice(2)], morning[1]),
    document(fileId, tuesday, morning[2]),
  ];
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

    await page.goto(office.url);
    await caption(page, "Rosa signs in. Sam rewrote the watering rota this morning, and she wants Monday evening's version back.");
    await signIn(page, "rosa@riverside-garden.org");
    await page
      .getByRole("heading", { name: "SuiteDrive" })
      .evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "start" }));
    await page.getByRole("button", { name: "Garden club", exact: true }).click();
    await page.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Document content" });
    await expect(editor).toContainText("Friday — Rosa, seed library, 8am");
    await caption(page, "The rota is open on Sam's rewrite. She asks the assistant to restore her version and keep his.", 1000);

    const run = await askAgent(page, prompt);
    const why = describeRun(run);
    expect(run.state, why).toBe("done");

    await expect(editor, why).toContainText("Monday — Rosa, greenhouse, 7am");
    await expect(editor, why).toContainText("Wednesday — Priya, compost, 6pm");
    await expect(editor, why).toContainText("Thursday — Leo, north fence, 7am");
    await expect(editor, why).not.toContainText("Friday — Rosa, seed library");
    await expect(editor, why).not.toContainText("all the beds");
    await expect(page.getByRole("status"), why).toHaveText("Saved to SuiteDrive", { timeout: 20000 });

    const saved = await page.evaluate(async (id) => {
      const session = JSON.parse(localStorage.getItem("suiteleaf:node-session")!) as {
        url: string;
        token: string;
      };
      const headers = { authorization: `Bearer ${session.token}` };
      const head = await (
        await fetch(`${session.url}/api/drive/items/${id}/content`, { headers })
      ).text();
      const listed = (await (
        await fetch(`${session.url}/api/drive/items/${id}/versions`, { headers })
      ).json()) as { versions: { id: string }[] };
      const versions: string[] = [];
      for (const version of listed.versions) {
        versions.push(
          await (
            await fetch(`${session.url}/api/drive/items/${id}/content?version=${version.id}`, { headers })
          ).text(),
        );
      }
      const items = (await (await fetch(`${session.url}/api/drive/items`, { headers })).json()) as {
        items: { id: string; kind: string; name: string; parentId: string | null }[];
      };
      const copies: string[] = [];
      for (const item of items.items) {
        if (item.kind !== "file" || item.id === id) continue;
        copies.push(
          await (await fetch(`${session.url}/api/drive/items/${item.id}/content`, { headers })).text(),
        );
      }
      return { head, versions, copies };
    }, file.id);

    expect(paragraphs(saved.head), why).toEqual(monday);
    const kept = [...saved.versions, ...saved.copies].some(
      (body) => JSON.stringify(paragraphs(body)) === JSON.stringify(tuesday),
    );
    expect(kept, why).toBe(true);
    await caption(page, "The rota is Monday evening's again, and Sam's rewrite is still in the history.", 1800);
  } finally {
    office.stop();
  }
});
