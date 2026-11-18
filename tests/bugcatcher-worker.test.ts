import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { decodeDataUrl, issueFor, parseReport, type Env } from "../services/bugcatcher/src/index";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function env(): Env {
  return {
    GITHUB_TOKEN: "test-token",
    GITHUB_REPO: "MisterTea/SuiteLeaf-issues",
    GITHUB_REPO_ID: "1462191815",
  };
}

const post = (body: unknown, raw?: string) =>
  new Request("https://bugs.example/report", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("parseReport", () => {
  it("accepts a valid report and trims it", () => {
    expect(parseReport({ type: "bug", text: "  hi  ", screenshot: PNG, context: " /x " })).toEqual({
      type: "bug",
      text: "hi",
      screenshot: PNG,
      context: "/x",
    });
  });

  it.each([
    [null, /JSON object/],
    [{ type: "other", text: "x" }, /type/],
    [{ type: "bug", text: "  " }, /empty/],
    [{ type: "bug", text: "x".repeat(20_001) }, /too long/],
    [{ type: "bug", text: "x", screenshot: "data:text/html,hi" }, /PNG or JPEG/],
    [{ type: "bug", text: "x", context: 5 }, /context/],
  ])("rejects %j", (body, message) => {
    expect(parseReport(body)).toMatch(message);
  });
});

describe("helpers", () => {
  it("decodes PNG data URLs and rejects others", () => {
    expect(decodeDataUrl(PNG)?.mime).toBe("image/png");
    expect(decodeDataUrl("data:image/gif;base64,AA==")).toBeNull();
  });

  it("builds a labelled issue with the screenshot embedded", () => {
    const issue = issueFor({ type: "feature", text: "Dark mode\nplease", context: "ctx" }, "https://s/x.png");
    expect(issue.title).toBe("[Feature] Dark mode");
    expect(issue.labels).toEqual(["feature"]);
    expect(issue.body).toContain("Feature request");
    expect(issue.body).toContain("### Context\nctx");
    expect(issue.body).toContain("![Screenshot](https://s/x.png)");
  });
});

describe("worker", () => {
  it("uploads the screenshot to GitHub user-attachments and creates the issue", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "https://github.com/user-attachments/assets/abc-123" }), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ number: 7 }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await worker.fetch(post({ type: "bug", text: "Crash on save", screenshot: PNG }), env());
    expect(await res.json()).toEqual({ success: true, number: 7 });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const [uploadUrl, uploadInit] = fetchMock.mock.calls[0];
    expect(uploadUrl).toBe(
      "https://uploads.github.com/user-attachments/assets?name=screenshot.png&content_type=image%2Fpng&repository_id=1462191815",
    );
    expect(uploadInit.headers.Authorization).toBe("Bearer test-token");
    expect(uploadInit.headers["Content-Type"]).toBe("image/png");

    const [issueUrl, issueInit] = fetchMock.mock.calls[1];
    expect(issueUrl).toBe("https://api.github.com/repos/MisterTea/SuiteLeaf-issues/issues");
    expect(issueInit.headers.Authorization).toBe("Bearer test-token");
    const sent = JSON.parse(issueInit.body);
    expect(sent.labels).toEqual(["bug"]);
    expect(sent.body).toContain("![Screenshot](https://github.com/user-attachments/assets/abc-123)");
  });

  it("rejects bad input without calling GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await worker.fetch(post(null, "not json"), env())).status).toBe(400);
    expect((await worker.fetch(post({ type: "bug", text: "" }), env())).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized screenshot", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const big = "data:image/png;base64," + "A".repeat(12 * 1024 * 1024);
    expect((await worker.fetch(post({ type: "bug", text: "x", screenshot: big }), env())).status).toBe(413);
  });

  it("returns 502 if GitHub attachment upload fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upload error", { status: 500 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await worker.fetch(post({ type: "bug", text: "x", screenshot: PNG }), env());
    expect(res.status).toBe(502);
  });

  it("hides GitHub issue creation failures behind a generic 502", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad credentials", { status: 401 })));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await worker.fetch(post({ type: "bug", text: "x" }), env());
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("credentials");
  });

  it("answers CORS preflight and 404s everything else", async () => {
    const e = env();
    expect((await worker.fetch(new Request("https://b/report", { method: "OPTIONS" }), e)).status).toBe(200);
    expect((await worker.fetch(new Request("https://b/report"), e)).status).toBe(404);
  });
});
