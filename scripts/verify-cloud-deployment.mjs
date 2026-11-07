// Verify a staged production deployment, then remove only this script's fixtures.
// Uses the ignored production env/setup files; never prints credentials.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { neon } from "@neondatabase/serverless";
import { chromium } from "@playwright/test";

const base = new URL(process.argv[2] ?? "");
assert(
  base.protocol === "https:" &&
    base.hostname.endsWith(".vercel.app") &&
    !base.username &&
    !base.password,
  "Use the verified staged Vercel deployment URL.",
);
process.loadEnvFile(process.argv[3] ?? ".env.cloud.production.local");
const sql = neon(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
const setup = JSON.parse(readFileSync(".env.cloud.setup.local", "utf8"));
const stateFile = resolve(".env.cloud.release-check.local");
let state;
let phase = "preflight";
const persist = () =>
  writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
const url = (path) => new URL(path, base).href;
async function api(path, method = "GET", account, body, headers = {}) {
  const response = await fetch(url(path), {
    method,
    signal: AbortSignal.timeout(60_000),
    headers: {
      origin: base.origin,
      ...(account?.token ? { authorization: `Bearer ${account.token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : body instanceof Uint8Array
            ? body
            : JSON.stringify(body),
  });
  return response;
}
async function json(response) {
  assert(
    response.ok,
    `Cloud API returned HTTP ${response.status} during ${phase}.`,
  );
  const body = await response.text();
  return body ? JSON.parse(body) : undefined;
}
async function cleanup() {
  if (!state) return;
  const emails = state.accounts.map((account) => account.email);
  assert(
    emails.every((email) =>
      /^vercel-release-check-[a-f0-9]+-(owner|member)@suiteleaf\.test$/.test(
        email,
      ),
    ),
    "Refusing to clean non-verification accounts.",
  );
  const users =
    await sql`SELECT id,email FROM "user" WHERE email=ANY(${emails}::text[])`;
  const ids = users.map((user) => user.id);
  for (const user of users) {
    const account = state.accounts.find(
      (account) => account.email === user.email,
    );
    if (!account.token) {
      const signed = await json(
        await api("/api/auth/sign-in/email", "POST", undefined, {
          email: account.email,
          password: account.password,
        }),
      );
      account.token = signed.token;
    }
    const files =
      await sql`SELECT id FROM drive_item WHERE "ownerId"=${user.id} ORDER BY kind`;
    for (const file of files) {
      await json(
        await api(`/api/drive/items/${file.id}`, "PATCH", account, {
          trashed: true,
        }),
      );
      await json(await api(`/api/drive/items/${file.id}`, "DELETE", account));
    }
  }
  await sql.transaction([
    sql`DELETE FROM "session" WHERE "userId"=ANY(${ids}::text[])`,
    sql`DELETE FROM account WHERE "userId"=ANY(${ids}::text[])`,
    sql`DELETE FROM audit_event WHERE "actorId"=ANY(${ids}::text[])`,
    sql`DELETE FROM cloud_invite WHERE email=ANY(${emails}::text[])`,
    sql`DELETE FROM "user" WHERE id=ANY(${ids}::text[])`,
  ]);
  assert.equal(
    (await sql`SELECT id FROM "user" WHERE id=ANY(${ids}::text[])`).length,
    0,
    "Verification accounts were not removed.",
  );
  unlinkSync(stateFile);
  console.log(
    "Removed release-check accounts and documents; administrator setup remains available.",
  );
}
async function main() {
  if (existsSync(stateFile)) {
    state = JSON.parse(readFileSync(stateFile, "utf8"));
    await cleanup();
    state = undefined;
  }
  assert.equal(
    (await sql`SELECT id FROM "user" LIMIT 1`).length,
    0,
    "Initial release verification requires a fresh database; existing accounts were left untouched.",
  );
  const info = await json(await api("/api/node/info"));
  assert.equal(info.mode, "cluster");
  assert.equal(info.database, "postgres");
  assert.equal(info.storage, "vercel-blob");
  assert.equal(info.auth.enabled, true);
  assert.equal(
    (await json(await api("/api/auth/suiteleaf/providers"))).inviteOnly,
    true,
  );
  assert.equal((await api("/api/drive/items")).status, 401);
  console.log(
    "Verified server mode, Neon, private Blob, and sign-in enforcement.",
  );
  const suffix = randomBytes(8).toString("hex");
  state = {
    accounts: ["owner", "member"].map((role) => ({
      email: `vercel-release-check-${suffix}-${role}@suiteleaf.test`,
      name: `Release ${role}`,
      password: randomBytes(24).toString("hex"),
    })),
  };
  persist();
  const [owner, member] = state.accounts;
  phase = "registration";
  assert.equal(
    (await api("/api/auth/sign-up/email", "POST", undefined, owner)).status,
    403,
  );
  const registered = await json(
    await api("/api/auth/sign-up/email", "POST", undefined, owner, {
      "x-suiteleaf-invite": setup.token,
    }),
  );
  owner.token = registered.token;
  owner.id = registered.user.id;
  persist();
  assert.equal(registered.user.role, "admin");
  const invitation = await json(
    await api("/api/admin/invitations", "POST", owner, { email: member.email }),
  );
  const invite = new URLSearchParams(
    new URL(invitation.url).hash.split("?")[1],
  ).get("invite");
  const joined = await json(
    await api("/api/auth/sign-up/email", "POST", undefined, member, {
      "x-suiteleaf-invite": invite,
    }),
  );
  member.token = joined.token;
  member.id = joined.user.id;
  persist();
  assert.equal(
    (
      await api("/api/auth/sign-up/email", "POST", undefined, member, {
        "x-suiteleaf-invite": invite,
      })
    ).status,
    403,
  );
  console.log(
    "Verified protected administrator setup and one-use invitations.",
  );
  phase = "documents and history";
  const item = await json(
    await api("/api/drive/items", "POST", owner, {
      name: "Release check.sldoc",
      kind: "file",
      mime: "application/json",
    }),
  );
  const path = `/api/drive/items/${item.id}`;
  const at = new Date().toISOString();
  const native = {
    format: "suiteleaf",
    version: 1,
    id: randomUUID(),
    kind: "doc",
    title: "Release check",
    createdAt: at,
    updatedAt: at,
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "A private cloud document 🌱" }],
        },
      ],
    },
  };
  const firstText = JSON.stringify(native);
  const first = await json(
    await api(`${path}/content`, "PUT", owner, firstText),
  );
  assert.equal(
    await (await api(`${path}/content`, "GET", owner)).text(),
    firstText,
  );
  assert.equal((await api(`${path}/content`, "GET", member)).status, 403);
  await json(
    await api(`${path}/acl`, "PUT", owner, {
      principalType: "user",
      principalId: member.id,
      role: "editor",
    }),
  );
  const nextText = JSON.stringify({
    ...native,
    title: "Updated release check",
  });
  const next = await json(
    await api(`${path}/content`, "PUT", member, nextText, {
      "if-match": `"${first.headVersionId}"`,
    }),
  );
  assert.equal(
    (
      await api(`${path}/content`, "PUT", owner, firstText, {
        "if-match": `"${first.headVersionId}"`,
      })
    ).status,
    409,
  );
  assert.equal(
    await (
      await api(`${path}/content?version=${first.headVersionId}`, "GET", owner)
    ).text(),
    firstText,
  );
  await json(
    await api(
      `${path}/versions/${first.headVersionId}/restore`,
      "POST",
      owner,
      undefined,
      { "if-match": `"${next.headVersionId}"` },
    ),
  );
  assert.equal(
    await (await api(`${path}/content`, "GET", owner)).text(),
    firstText,
  );
  console.log(
    "Verified private document storage, sharing, save conflicts, and history restore.",
  );
  phase = "large resumable upload and streamed download";
  const large = await json(
    await api("/api/drive/items", "POST", owner, {
      name: "Release large download.bin",
      kind: "file",
      mime: "application/octet-stream",
    }),
  );
  const largeBytes = randomBytes(6 * 1024 * 1024 + 37);
  for (let start = 0; start < largeBytes.length; start += 1024 * 1024) {
    const end = Math.min(start + 1024 * 1024, largeBytes.length);
    await json(
      await api(
        `/api/drive/items/${large.id}/content`,
        "PUT",
        owner,
        largeBytes.subarray(start, end),
        {
          "content-type": "application/octet-stream",
          "content-range": `bytes ${start}-${end - 1}/${largeBytes.length}`,
        },
      ),
    );
  }
  const downloaded = await api(
    `/api/drive/items/${large.id}/content`,
    "GET",
    owner,
  );
  assert(downloaded.ok);
  assert(
    Buffer.from(await downloaded.arrayBuffer()).equals(largeBytes),
    "Large streamed document bytes changed.",
  );
  console.log(
    "Verified a resumable upload and streamed download larger than 6 MiB.",
  );
  phase = "hosted WebSockets";
  const sockets = [];
  try {
    for (const account of [owner, member]) {
      const endpoint = new URL(`${path}/session`, base);
      endpoint.protocol = "wss:";
      const socket = new WebSocket(endpoint);
      sockets.push(socket);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("WebSocket join timed out")),
          30_000,
        );
        socket.addEventListener(
          "open",
          () =>
            socket.send(
              JSON.stringify({
                type: "auth",
                accessToken: account.token,
                protocol: 1,
              }),
            ),
          { once: true },
        );
        socket.addEventListener(
          "error",
          () => {
            clearTimeout(timeout);
            reject(new Error("WebSocket connection failed"));
          },
          { once: true },
        );
        socket.addEventListener("message", (event) => {
          if (JSON.parse(String(event.data)).type === "joined") {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
    }
  } finally {
    for (const socket of sockets) socket.close();
  }
  console.log(
    "Verified authenticated hosted WebSocket room joins for two users.",
  );
  phase = "browser typing";
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1500, height: 1000 },
    });
    await context.addInitScript(
      ({ origin, token, id }) =>
        localStorage.setItem(
          "suiteleaf:node-session",
          JSON.stringify({
            url: origin,
            token,
            user: { id, name: "Release owner", role: "admin" },
          }),
        ),
      { origin: base.origin, token: owner.token, id: owner.id },
    );
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    await page.goto(base.origin);
    await page.getByRole("button", { name: "New document" }).click();
    const editor = page.getByRole("textbox", { name: "Document content" });
    await editor.click();
    await page.keyboard.type("Typed through the Vercel deployment.");
    await page
      .getByRole("status")
      .first()
      .filter({ hasText: "Saved to SuiteDrive" })
      .waitFor();
    await page.reload();
    await editor.waitFor();
    await page.waitForFunction(() =>
      document
        .querySelector('[aria-label="Document content"]')
        ?.textContent?.includes("Typed through the Vercel deployment."),
    );
    mkdirSync("test-results/cloud-browser", { recursive: true });
    await page.screenshot({
      path: "test-results/cloud-browser/vercel-document.png",
    });
    await context.close();
  } finally {
    await browser.close();
  }
  console.log(
    "Verified real browser typing and reload persistence against the staged deployment.",
  );
  phase = "AI Gateway";
  const completion = await api("/api/ai/v1/completions", "POST", owner, {
    prompt: "Reply with exactly: cloud-ready",
    stream: true,
  });
  assert(completion.ok, `Hosted assistant returned HTTP ${completion.status}.`);
  const stream = await completion.text();
  const text = stream
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)).choices?.[0]?.text ?? "")
    .join("");
  assert(
    text.includes("cloud-ready") && stream.includes("[DONE]"),
    "Hosted assistant did not complete its response.",
  );
  console.log(
    "Verified authenticated AI Gateway streaming from the deployed container.",
  );
  const cancelled = new AbortController();
  const cancellationTimeout = setTimeout(() => cancelled.abort(), 60_000);
  try {
    const response = await fetch(url("/api/ai/v1/completions"), {
      method: "POST",
      signal: cancelled.signal,
      headers: {
        origin: base.origin,
        authorization: `Bearer ${owner.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt: "Count from one to one hundred, writing every number in words.",
        max_tokens: 512,
        stream: true,
      }),
    });
    assert(
      response.ok,
      `Hosted cancellation returned HTTP ${response.status}.`,
    );
    const reader = response.body.getReader();
    const first = await reader.read();
    assert(
      !first.done && first.value.length > 0,
      "No streamed content arrived before cancellation.",
    );
    cancelled.abort();
    await reader.cancel().catch(() => {});
    assert(cancelled.signal.aborted);
  } finally {
    clearTimeout(cancellationTimeout);
    cancelled.abort();
  }
  console.log("Verified cancellation of a live hosted AI response.");
}
try {
  await main();
} catch (error) {
  console.error(
    `Release verification failed during ${phase}: ${error instanceof assert.AssertionError || error?.message?.startsWith("Cloud API") ? error.message : "Inspect the deployment's runtime logs."}`,
  );
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch {
    console.error(
      "Release fixture cleanup needs retrying; keep this deployment staged. State is saved in .env.cloud.release-check.local.",
    );
    process.exitCode = 1;
  }
}
