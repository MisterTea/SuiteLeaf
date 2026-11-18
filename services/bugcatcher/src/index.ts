/**
 * Bugcatcher: a public endpoint that turns in-app bug reports and feature
 * requests into GitHub issues on the private SuiteLeaf-issues repository.
 *
 * The GitHub token lives only in the GITHUB_TOKEN Worker secret. Screenshots
 * are uploaded directly to GitHub's user-attachments endpoint (the same
 * mechanism used by `gh issue create --attach`) so GitHub hosts them natively.
 */

export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  GITHUB_REPO_ID?: string;
}

export interface Report {
  type: "bug" | "feature";
  text: string;
  /** PNG or JPEG data URL. */
  screenshot?: string;
  /** Free-form context such as app version or page. */
  context?: string;
}

const MAX_TEXT = 20_000;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const DEFAULT_REPO_ID = "1462191815";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

/** Validate an untrusted request body. Returns an error message or the report. */
export function parseReport(body: unknown): Report | string {
  if (!body || typeof body !== "object") return "Body must be a JSON object.";
  const { type, text, screenshot, context } = body as Record<string, unknown>;
  if (type !== "bug" && type !== "feature") return 'type must be "bug" or "feature".';
  if (typeof text !== "string" || !text.trim()) return "text must not be empty.";
  if (text.length > MAX_TEXT) return "text is too long.";
  if (
    screenshot !== undefined &&
    screenshot !== "" &&
    (typeof screenshot !== "string" || !/^data:image\/(png|jpeg);base64,/.test(screenshot))
  )
    return "screenshot must be a PNG or JPEG data URL.";
  if (context !== undefined && (typeof context !== "string" || context.length > 2000))
    return "context must be a short string.";
  return {
    type,
    text: text.trim(),
    screenshot: screenshot || undefined,
    context: (context as string | undefined)?.trim() || undefined,
  };
}

export function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const match = /^data:(image\/(?:png|jpeg));base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mime: match[1] };
}

export function issueFor(report: Report, screenshotUrl?: string) {
  const bug = report.type === "bug";
  const firstLine = report.text.split("\n")[0].trim().slice(0, 70);
  const parts = [
    `### Type\n${bug ? "Bug report" : "Feature request"}`,
    `### Description\n${report.text}`,
  ];
  if (report.context) parts.push(`### Context\n${report.context}`);
  if (screenshotUrl) parts.push(`### Screenshot\n![Screenshot](${screenshotUrl})`);
  return {
    title: `[${bug ? "Bug" : "Feature"}] ${firstLine}`,
    body: parts.join("\n\n"),
    labels: [bug ? "bug" : "feature"],
  };
}

async function uploadGitHubAttachment(
  image: { bytes: Uint8Array; mime: string },
  env: Env,
): Promise<string> {
  const ext = image.mime === "image/png" ? "png" : "jpg";
  const repoId = env.GITHUB_REPO_ID || DEFAULT_REPO_ID;
  const params = new URLSearchParams({
    name: `screenshot.${ext}`,
    content_type: image.mime,
    repository_id: repoId,
  });
  const res = await fetch(`https://uploads.github.com/user-attachments/assets?${params}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/json",
      "Content-Type": image.mime,
      "User-Agent": "SuiteLeaf-Bugcatcher",
    },
    body: image.bytes,
  });
  if (!res.ok) {
    throw new Error(`Attachment upload failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { url: string };
  return data.url;
}

async function createReport(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Body must be JSON." }, 400);
  }
  const report = parseReport(body);
  if (typeof report === "string") return json({ success: false, error: report }, 400);

  let screenshotUrl: string | undefined;
  if (report.screenshot) {
    const image = decodeDataUrl(report.screenshot);
    if (!image) return json({ success: false, error: "Invalid screenshot." }, 400);
    if (image.bytes.length > MAX_SCREENSHOT_BYTES)
      return json({ success: false, error: "Screenshot is too large." }, 413);
    try {
      screenshotUrl = await uploadGitHubAttachment(image, env);
    } catch (err) {
      console.error("GitHub attachment upload failed", err);
      return json({ success: false, error: "Could not upload screenshot. Please try again later." }, 502);
    }
  }

  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "SuiteLeaf-Bugcatcher",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(issueFor(report, screenshotUrl)),
  });
  if (!res.ok) {
    console.error("GitHub issue creation failed", res.status, await res.text());
    return json({ success: false, error: "Could not file the report. Please try again later." }, 502);
  }
  // The repo is private; return only the number, not a link the reporter cannot open.
  const issue = (await res.json()) as { number: number };
  return json({ success: true, number: issue.number });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (pathname === "/report" && request.method === "POST") return createReport(request, env);
    return new Response("Not found", { status: 404 });
  },
};
