import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

/** Uses the existing Git preview: this check never creates or deletes deployments. */
export async function checkVercelPreview(env = process.env, {
  request = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 120,
} = {}) {
  for (const key of ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID", "PREVIEW_SHA", "VERCEL_AUTOMATION_BYPASS_SECRET"]) {
    assert(env[key], `Configure ${key} for the Vercel preview check.`);
  }
  assert(/^[a-f0-9]{40}$/i.test(env.PREVIEW_SHA), "Expected a full PR commit SHA.");
  const query = new URLSearchParams({
    teamId: env.VERCEL_ORG_ID,
    projectId: env.VERCEL_PROJECT_ID,
    sha: env.PREVIEW_SHA,
    target: "preview",
    limit: "1",
  });
  const api = async (path) => {
    const response = await request(`https://api.vercel.com${path}`, {
      headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    assert(response.ok, `Vercel API returned HTTP ${response.status}.`);
    return response.json();
  };
  const project = await api(`/v9/projects/${encodeURIComponent(env.VERCEL_PROJECT_ID)}?teamId=${encodeURIComponent(env.VERCEL_ORG_ID)}`);
  assert.equal(project.id, env.VERCEL_PROJECT_ID, "Unexpected Vercel project.");
  assert.equal(project.accountId, env.VERCEL_ORG_ID, "Unexpected Vercel team.");
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { deployments } = await api(`/v7/deployments?${query}`);
    const deployment = deployments[0];
    if (deployment) {
      assert(!["ERROR", "CANCELED", "BLOCKED"].includes(deployment.state),
        `Vercel preview ended in ${deployment.state}; inspect its Vercel build logs.`);
      if (deployment.state === "READY") {
        // Authenticate the deployment identity before sending any bypass credential.
        const detail = await api(`/v13/deployments/${encodeURIComponent(deployment.uid)}?teamId=${encodeURIComponent(env.VERCEL_ORG_ID)}`);
        assert.equal(detail.projectId, env.VERCEL_PROJECT_ID, "Unexpected Vercel project.");
        assert.equal(detail.ownerId, env.VERCEL_ORG_ID, "Unexpected deployment owner.");
        assert.equal(detail.meta?.githubCommitSha, env.PREVIEW_SHA, "Preview is for a different commit.");
        assert(detail.target === null || detail.target === "preview", "Expected a preview deployment.");
        assert.equal(detail.readyState, "READY");
        assert(/^[a-z0-9-]+\.vercel\.app$/i.test(detail.url), "Expected a generated Vercel deployment hostname.");
        const origin = `https://${detail.url}`;
        const get = async (path) => {
          const response = await request(`${origin}${path}`, {
            headers: { "x-vercel-protection-bypass": env.VERCEL_AUTOMATION_BYPASS_SECRET },
            redirect: "error",
            signal: AbortSignal.timeout(60_000),
          });
          assert(response.ok, `Preview ${path} returned HTTP ${response.status}.`);
          return response;
        };
        const info = await (await get("/api/node/info")).json();
        assert.equal(info.mode, "cluster");
        assert.equal(info.database, "postgres");
        assert.equal(info.storage, "vercel-blob");
        assert.equal(info.auth?.enabled, true);
        const providers = await (await get("/api/auth/suiteleaf/providers")).json();
        assert.equal(providers.inviteOnly, true);
        assert((await (await get("/")).text()).includes('<div id="root">'), "Preview did not serve the web app.");
        return origin;
      }
    }
    if (attempt + 1 < attempts) await sleep(15_000);
  }
  throw new Error("Timed out waiting for this PR commit's Vercel preview. Check Git integration, ignored builds, and preview settings.");
}

export async function runPreviewCheck(env = process.env, options, log = console) {
  try {
    const origin = await checkVercelPreview(env, options);
    log.log(`Vercel preview smoke test passed: ${origin}`);
    return 0;
  } catch (error) {
    // Do not print response bodies or request errors: they may contain credentials.
    const reason = error instanceof assert.AssertionError
      ? error.message.split("\n")[0]
      : "Check deployment status, network access, and smoke-test endpoints.";
    log.error(`Vercel preview check failed: ${reason} No deployment was created by this check.`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runPreviewCheck();
}
