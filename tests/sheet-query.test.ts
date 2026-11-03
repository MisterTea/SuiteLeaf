import { describe, expect, it } from "vitest";
import { createFile, parseFile, type SheetFile } from "../packages/core/src";
import { sourceUrlProblem } from "../packages/core/src/sheet-query-url";
import {
  queryDocument,
  remapQuery,
  refreshGridQuery,
  refreshDatabaseQuery,
  refreshQuery,
  refreshIsDue,
  refreshRemoteQuery,
  runScheduledRefresh,
  savedQuerySchema,
  writeQueryOutput,
} from "../packages/core/src/sheet-query";

const source = [
  { bed: "North", crop: "Tomato" },
  { bed: "South", crop: "Bean" },
];

describe("sheet queries", () => {
  it("sorts plain numbers in numeric order", () => {
    const rows = [
      { bed: "10", note: "kept" },
      { bed: "2", note: "second" },
    ];
    const run = refreshQuery(
      queryDocument([{ op: "sort", column: "bed", direction: "asc" }]),
      rows,
      null,
      "2026-11-01T00:00:00.000Z",
    );
    expect(run.ok).toBe(true);
    if (run.ok) expect(run.rows[0]).toEqual({ bed: "2", note: "second" });
    if (run.ok) expect(run.rows[1]).toEqual({ bed: "10", note: "kept" });
    expect(rows[0]?.bed).toBe("10");
  });

  it("keeps rows that do not equal the filter value", () => {
    const rows = [
      { bed: "North", crop: "Tomato" },
      { bed: "South", crop: "secret-value" },
    ];
    const document = queryDocument([
      { op: "filter", column: "crop", equals: "Tomato", match: "ne" },
    ]);
    const run = refreshQuery(document, rows, null, "2026-11-01T00:00:00.000Z");
    expect(run.ok).toBe(true);
    if (run.ok) expect(run.rows).toEqual([{ bed: "South", crop: "secret-value" }]);
    expect(rows[0]).toEqual({ bed: "North", crop: "Tomato" });
    expect(document.steps[0]).toEqual({
      op: "filter",
      column: "crop",
      equals: "Tomato",
      match: "ne",
    });
    const file = createFile("sheet", "Beds") as SheetFile;
    file.content.queries = [{ id: "beds", document }];
    const reopened = parseFile(JSON.stringify(file));
    if (reopened.kind !== "sheet") throw new Error("expected a spreadsheet");
    expect(reopened.content.queries?.[0]?.document.steps).toEqual(document.steps);
    expect(savedQuerySchema.safeParse(reopened.content.queries?.[0]).success).toBe(true);
  });

  it("keeps a row whose column contains the text", () => {
    const rows = [
      { bed: "North", crop: "Water the beds" },
      { bed: "South", crop: "secret-value" },
    ];
    const document = queryDocument([
      { op: "filter", column: "crop", equals: "beds", match: "contains" },
    ]);
    const run = refreshQuery(document, rows, null, "2026-11-01T00:00:00.000Z");
    expect(run.ok).toBe(true);
    if (run.ok) expect(run.rows).toEqual([{ bed: "North", crop: "Water the beds" }]);
    expect(rows[1]?.crop).toBe("secret-value");
    expect(JSON.stringify(run)).not.toContain("secret-value");
    const blank = refreshQuery(
      queryDocument([{ op: "filter", column: "crop", equals: "", match: "contains" }]),
      [{ crop: "" }, { crop: "Beds" }],
      null,
      "2026-11-01T00:00:00.000Z",
    );
    expect(blank.ok && blank.rows).toEqual([{ crop: "" }]);
  });

  it("matches a plain number written two ways in a filter", () => {
    const rows = [
      { plot: "10", note: "kept" },
      { plot: "10.0", note: "also" },
      { plot: "north", note: "secret-value" },
    ];
    const same = refreshQuery(
      queryDocument([{ op: "filter", column: "plot", equals: "10" }]),
      rows,
      null,
      "2026-11-01T00:00:00.000Z",
    );
    expect(same.ok && same.rows).toEqual([
      { plot: "10", note: "kept" },
      { plot: "10.0", note: "also" },
    ]);
    expect(JSON.stringify(same)).not.toContain("secret-value");
    const other = refreshQuery(
      queryDocument([{ op: "filter", column: "plot", equals: "10", match: "ne" }]),
      rows,
      null,
      "2026-11-01T00:00:00.000Z",
    );
    expect(other.ok && other.rows).toEqual([{ plot: "north", note: "secret-value" }]);
    expect(rows[1]?.plot).toBe("10.0");
  });

  it("fills a named parameter at refresh and leaves it in the saved step", () => {
    const document = queryDocument([{ op: "filter", column: "bed", equals: "{{plot}}" }]);
    const missing = refreshQuery(document, source, null, "2026-11-01T00:00:00.000Z");
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("expected a missing parameter");
    expect(missing.error).toBe("Name the value for plot.");
    expect(missing.error).not.toContain("secret-value");
    const run = refreshQuery(
      document,
      [{ bed: "North", crop: "Tomato" }, { bed: "secret-value", crop: "Bean" }],
      null,
      "2026-11-01T00:00:00.000Z",
      undefined,
      undefined,
      { plot: "North" },
    );
    expect(run.ok).toBe(true);
    if (!run.ok) throw new Error(run.error);
    expect(run.rows).toEqual([{ bed: "North", crop: "Tomato" }]);
    expect(JSON.stringify(document)).toBe(
      JSON.stringify({ version: 1, steps: [{ op: "filter", column: "bed", equals: "{{plot}}" }] }),
    );
    expect(JSON.stringify(document)).not.toContain("secret-value");
    expect(JSON.stringify(run.rows)).not.toContain("secret-value");
  });

  it("repeats the same steps on a later refresh", () => {
    const document = queryDocument([
      { op: "filter", column: "crop", equals: "Tomato" },
      { op: "rename", from: "bed", to: "plot" },
      { op: "select", columns: ["plot"] },
    ]);
    const first = refreshQuery(
      document,
      source,
      null,
      "2026-10-30T22:00:00.000Z",
    );
    const second = refreshQuery(
      document,
      source,
      null,
      "2026-10-30T23:00:00.000Z",
    );
    expect(first).toEqual({
      ok: true,
      rows: [{ plot: "North" }],
      refreshedAt: "2026-10-30T22:00:00.000Z",
      stale: false,
    });
    expect(second.ok && second.rows).toEqual(first.ok && first.rows);
  });

  it("keeps the last successful rows when a column disappears", () => {
    const document = queryDocument([{ op: "select", columns: ["crop"] }]);
    const saved = refreshQuery(
      document,
      source,
      null,
      "2026-10-30T22:00:00.000Z",
    );
    expect(saved.ok).toBe(true);
    const drifted = refreshQuery(
      document,
      [{ bed: "North" }],
      saved.ok ? { rows: saved.rows, refreshedAt: saved.refreshedAt } : null,
      "2026-10-30T23:00:00.000Z",
    );
    expect(drifted).toMatchObject({
      ok: false,
      stale: true,
      rows: [{ crop: "Tomato" }, { crop: "Bean" }],
      refreshedAt: "2026-10-30T22:00:00.000Z",
    });
    expect(drifted.ok === false && drifted.error).toContain("crop");
  });

  it("writes the result into an empty range and leaves a neighbor alone", () => {
    const document = queryDocument([
      { op: "filter", column: "crop", equals: "Tomato" },
      { op: "select", columns: ["bed"] },
    ]);
    const run = refreshQuery(document, source, null, "2026-10-30T22:00:00.000Z");
    const grid = { "0": { "4": { v: "note" } } };
    const placed = writeQueryOutput(grid, run, { startRow: 1, startColumn: 0 });
    expect(placed.wrote).toBe(true);
    expect(placed.grid["0"]["4"]).toEqual({ v: "note" });
    expect(placed.grid["1"]["0"]).toEqual({ v: "bed" });
    expect(placed.grid["2"]["0"]).toEqual({ v: "North" });
    expect(grid["1"]).toBeUndefined();
    expect(placed.placement).toEqual({
      startRow: 1,
      startColumn: 0,
      writtenRows: 2,
      writtenColumns: 1,
    });
  });

  it("refuses a cell outside the previous output and keeps a failed refresh", () => {
    const document = queryDocument([{ op: "select", columns: ["crop"] }]);
    const run = refreshQuery(document, source, null, "2026-10-30T22:00:00.000Z");
    const grid = { "2": { "0": { v: "mine" } } };
    const blocked = writeQueryOutput(grid, run, { startRow: 0, startColumn: 0 });
    expect(blocked.wrote).toBe(false);
    expect(blocked.error).toContain("Row 2, column 0");
    expect(blocked.grid).toBe(grid);
    const first = writeQueryOutput(
      { "9": { "0": { v: "mine" } } },
      run,
      { startRow: 0, startColumn: 0 },
    );
    const drifted = refreshQuery(
      document,
      [{ bed: "North" }],
      run.ok ? { rows: run.rows, refreshedAt: run.refreshedAt } : null,
      "2026-10-30T23:00:00.000Z",
    );
    const kept = writeQueryOutput(first.grid, drifted, {
      startRow: 0,
      startColumn: 0,
      previous: first.placement,
    });
    expect(kept.wrote).toBe(false);
    expect(kept.grid["1"]["0"]).toEqual({ v: "Tomato" });
    expect(kept.grid).toBe(first.grid);
    const shorter = refreshQuery(
      queryDocument([{ op: "filter", column: "crop", equals: "Tomato" }, { op: "select", columns: ["crop"] }]),
      source,
      null,
      "2026-10-30T23:00:00.000Z",
    );
    const shrunk = writeQueryOutput(first.grid, shorter, {
      startRow: 0,
      startColumn: 0,
      previous: first.placement,
    });
    expect(shrunk.wrote).toBe(true);
    expect(shrunk.grid["2"]).toBeUndefined();
    expect(shrunk.grid["1"]["0"]).toEqual({ v: "Tomato" });
    expect(shrunk.grid["9"]["0"]).toEqual({ v: "mine" });
    expect(first.grid["2"]["0"]).toEqual({ v: "Bean" });
  });

  it("reads a source range and writes the filtered rows beside it", () => {
    const grid = {
      "0": { "0": { v: "bed" }, "1": { v: "crop" }, "4": { v: "note" } },
      "1": { "0": { v: "North" }, "1": { v: "Tomato" } },
      "2": { "0": { v: "South" }, "1": { v: "Bean" } },
    };
    const document = queryDocument([
      { op: "filter", column: "crop", equals: "Tomato" },
      { op: "select", columns: ["bed"] },
    ]);
    const placed = refreshGridQuery(
      grid,
      document,
      { startRow: 0, startColumn: 0, rows: 3, columns: 2 },
      { startRow: 0, startColumn: 3 },
      null,
      "2026-10-30T22:00:00.000Z",
    );
    expect(placed.write.wrote).toBe(true);
    expect(placed.write.grid["0"]["3"]).toEqual({ v: "bed" });
    expect(placed.write.grid["1"]["3"]).toEqual({ v: "North" });
    expect(placed.write.grid["0"]["0"]).toEqual({ v: "bed" });
    expect(placed.write.grid["0"]["4"]).toEqual({ v: "note" });
    expect(grid["0"]["3"]).toBeUndefined();
    const drifted = refreshGridQuery(
      {
        "0": { "0": { v: "bed" }, "3": { v: "bed" } },
        "1": { "0": { v: "North" }, "3": { v: "North" } },
      },
      document,
      { startRow: 0, startColumn: 0, rows: 2, columns: 2 },
      { startRow: 0, startColumn: 3, previous: placed.write.placement },
      placed.run.ok ? { rows: placed.run.rows, refreshedAt: placed.run.refreshedAt } : null,
      "2026-10-30T23:00:00.000Z",
    );
    expect(drifted.run.ok).toBe(false);
    expect(drifted.write.wrote).toBe(false);
    expect(drifted.write.grid["1"]["3"]).toEqual({ v: "North" });
  });

  it("refuses to store a credential on the query", () => {
    expect(() => queryDocument([], { apiKey: "secret" })).toThrow(
      "A query cannot store a credential.",
    );
    try {
      queryDocument([], { apiKey: "secret" });
    } catch (error) {
      expect(String(error)).not.toContain("apiKey");
      expect(String(error)).not.toContain("secret");
    }
    const document = queryDocument([{ op: "select", columns: ["crop"] }]);
    expect(JSON.stringify(document)).not.toContain("secret");
  });

  it("does not fetch a credential hidden in the path or the fragment", async () => {
    expect(sourceUrlProblem("https://tables.example/beds")).toBeNull();
    expect(sourceUrlProblem("https://tables.example/beds#north")).toBeNull();
    const path = "https://tables.example/beds/token/secret-value";
    const fragment = "https://tables.example/beds#api_key=secret-value";
    expect(sourceUrlProblem(path)).toBe("The source address cannot include a credential.");
    expect(sourceUrlProblem(fragment)).toBe("The source address cannot include a credential.");
    expect(sourceUrlProblem(path)).not.toContain("secret-value");
    const document = queryDocument([{ op: "select", columns: ["crop"] }]);
    let asked = false;
    const result = await refreshRemoteQuery({
      document,
      url: path,
      allowed: true,
      fetchRows: async () => {
        asked = true;
        return { ok: true, status: 200, rows: [{ crop: "Tomato" }] };
      },
      previous: null,
      refreshedAt: "2026-11-01T14:00:00.000Z",
    });
    expect(asked).toBe(false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain("secret-value");
  });

  it("refreshes an https table and keeps the last rows when the view cannot fetch", async () => {
    const document = queryDocument([{ op: "filter", column: "crop", equals: "Tomato" }]);
    const previous = { rows: [{ crop: "Tomato" }], refreshedAt: "2026-10-30T22:00:00.000Z" };
    const blocked = await refreshRemoteQuery({
      document,
      url: "https://tables.example/beds",
      allowed: false,
      fetchRows: async () => {
        throw new Error("token=secret-value");
      },
      previous,
      refreshedAt: "2026-10-30T23:00:00.000Z",
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.stale).toBe(true);
    expect(blocked.rows).toEqual(previous.rows);
    expect(blocked.error).toBe("This view cannot refresh the source.");
    expect(blocked.error).not.toContain("secret-value");

    const local = await refreshRemoteQuery({
      document,
      url: "http://tables.example/beds",
      allowed: true,
      fetchRows: async () => {
        throw new Error("should not fetch");
      },
      previous,
      refreshedAt: "2026-10-30T23:00:00.000Z",
    });
    expect(local.ok).toBe(false);
    if (!local.ok) expect(local.error).toBe("The source address is not https.");

    let asked = false;
    const credential = await refreshRemoteQuery({
      document,
      url: "https://user:secret-value@tables.example/beds?token=secret-value",
      allowed: true,
      fetchRows: async () => {
        asked = true;
        return { ok: true, status: 200, rows: [{ crop: "Tomato" }] };
      },
      previous,
      refreshedAt: "2026-10-30T23:00:00.000Z",
    });
    expect(asked).toBe(false);
    expect(credential.ok).toBe(false);
    if (!credential.ok) {
      expect(credential.error).toBe("The source address cannot include a credential.");
      expect(credential.error).not.toContain("secret-value");
    }
    expect(
      refreshIsDue(
        {
          url: "https://user:secret-value@tables.example/beds",
          everyMs: 60_000,
          lastRunAt: null,
        },
        Date.parse("2026-10-30T23:00:00.000Z"),
      ),
    ).toBe(false);

    const failed = await refreshRemoteQuery({
      document,
      url: "https://tables.example/beds",
      allowed: true,
      fetchRows: async () => ({ ok: false, status: 500, rows: [{ crop: "token=secret-value" }] }),
      previous,
      refreshedAt: "2026-10-30T23:00:00.000Z",
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.stale).toBe(true);
      expect(failed.rows).toEqual([{ crop: "Tomato" }]);
      expect(failed.error).not.toContain("secret-value");
    }

    const drifted = await refreshRemoteQuery({
      document,
      url: "https://tables.example/beds",
      allowed: true,
      fetchRows: async () => ({ ok: true, status: 200, rows: [{ bed: "North" }] }),
      previous,
      refreshedAt: "2026-10-30T23:00:00.000Z",
    });
    expect(drifted.ok).toBe(false);
    if (!drifted.ok) {
      expect(drifted.stale).toBe(true);
      expect(drifted.error).toContain("crop");
      expect(drifted.rows).toEqual([{ crop: "Tomato" }]);
    }

    const fetched = await refreshRemoteQuery({
      document,
      url: "https://tables.example/beds",
      allowed: true,
      fetchRows: async (url) => {
        expect(url).toBe("https://tables.example/beds");
        return { ok: true, status: 200, rows: source };
      },
      previous,
      refreshedAt: "2026-10-31T00:00:00.000Z",
    });
    expect(fetched).toEqual({
      ok: true,
      rows: [{ bed: "North", crop: "Tomato" }],
      refreshedAt: "2026-10-31T00:00:00.000Z",
      stale: false,
    });
    expect(JSON.stringify(document)).not.toContain("tables.example");
  });

  it("fetches a scheduled https table only after the interval and only when allowed", async () => {
    const document = queryDocument([{ op: "select", columns: ["crop"] }]);
    const previous = { rows: [{ crop: "Tomato" }], refreshedAt: "2026-10-30T22:00:00.000Z" };
    const schedule = {
      url: "https://tables.example/beds",
      everyMs: 60_000,
      lastRunAt: "2026-10-31T00:00:00.000Z",
    };
    const early = await runScheduledRefresh({
      document,
      schedule,
      now: "2026-10-31T00:00:30.000Z",
      allowed: true,
      fetchRows: async () => {
        throw new Error("should not fetch");
      },
      previous,
    });
    expect(early.fetched).toBe(false);
    expect(early.run).toBeNull();
    expect(early.schedule.lastRunAt).toBe(schedule.lastRunAt);

    const blocked = await runScheduledRefresh({
      document,
      schedule: { ...schedule, lastRunAt: null },
      now: "2026-10-31T01:00:00.000Z",
      allowed: false,
      fetchRows: async () => {
        throw new Error("token=secret-value");
      },
      previous,
    });
    expect(blocked.fetched).toBe(false);
    expect(blocked.schedule.lastRunAt).toBeNull();
    expect(blocked.run && !blocked.run.ok && blocked.run.stale).toBe(true);
    expect(blocked.run && !blocked.run.ok && blocked.run.error).not.toContain("secret-value");

    const tooSoon = await runScheduledRefresh({
      document,
      schedule: { ...schedule, everyMs: 1_000, lastRunAt: null },
      now: "2026-10-31T01:00:00.000Z",
      allowed: true,
      fetchRows: async () => {
        throw new Error("should not fetch");
      },
      previous,
    });
    expect(tooSoon.fetched).toBe(false);

    const ran = await runScheduledRefresh({
      document,
      schedule: { ...schedule, lastRunAt: null },
      now: "2026-10-31T01:00:00.000Z",
      allowed: true,
      fetchRows: async () => ({ ok: false, status: 500 }),
      previous,
    });
    expect(ran.fetched).toBe(true);
    expect(ran.schedule.lastRunAt).toBe("2026-10-31T01:00:00.000Z");
    expect(ran.run && !ran.run.ok && ran.run.rows).toEqual([{ crop: "Tomato" }]);
  });

  it("runs one read-only database query and keeps the last rows when that read fails", async () => {
    const document = queryDocument([{ op: "filter", column: "crop", equals: "Tomato" }]);
    const previous = { rows: [{ crop: "Tomato" }], refreshedAt: "2026-10-30T22:00:00.000Z" };
    const change = await refreshDatabaseQuery({
      document,
      sql: "INSERT INTO beds VALUES ('token=secret-value')",
      allowed: true,
      query: async () => {
        throw new Error("should not query");
      },
      previous,
      refreshedAt: "2026-10-31T01:00:00.000Z",
    });
    expect(change.ok).toBe(false);
    if (!change.ok) {
      expect(change.error).toBe("The database query must be one read.");
      expect(change.stale).toBe(true);
      expect(change.error).not.toContain("secret-value");
    }

    const blocked = await refreshDatabaseQuery({
      document,
      sql: "SELECT crop FROM beds",
      allowed: false,
      query: async () => {
        throw new Error("password=secret-value");
      },
      previous,
      refreshedAt: "2026-10-31T01:00:00.000Z",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).not.toContain("secret-value");

    const failed = await refreshDatabaseQuery({
      document,
      sql: "SELECT crop FROM beds",
      allowed: true,
      query: async () => {
        throw new Error("password=secret-value");
      },
      previous,
      refreshedAt: "2026-10-31T01:00:00.000Z",
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.stale).toBe(true);
      expect(failed.rows).toEqual([{ crop: "Tomato" }]);
      expect(failed.error).toBe("The database query did not answer.");
      expect(failed.error).not.toContain("secret-value");
    }

    const read = await refreshDatabaseQuery({
      document,
      sql: "SELECT crop, bed FROM beds",
      allowed: true,
      query: async (sql) => {
        expect(sql).toBe("SELECT crop, bed FROM beds");
        return { ok: true, rows: source };
      },
      previous,
      refreshedAt: "2026-10-31T02:00:00.000Z",
    });
    expect(read).toEqual({
      ok: true,
      rows: [{ bed: "North", crop: "Tomato" }],
      refreshedAt: "2026-10-31T02:00:00.000Z",
      stale: false,
    });
    expect(JSON.stringify(document)).not.toContain("SELECT");
  });

  it("remaps a renamed column and leaves an unmapped query stale", () => {
    const document = queryDocument([
      { op: "filter", column: "crop", equals: "Tomato" },
      { op: "select", columns: ["crop", "bed"] },
    ]);
    const drifted = [
      { plant: "Tomato", bed: "North" },
      { plant: "Bean", bed: "South" },
    ];
    const previous = {
      rows: [{ crop: "Tomato", bed: "North" }],
      refreshedAt: "2026-10-30T00:00:00.000Z",
    };
    const failed = refreshQuery(
      document,
      drifted,
      previous,
      "2026-10-31T00:00:00.000Z",
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.stale).toBe(true);
      expect(failed.rows).toEqual(previous.rows);
      expect(failed.error).toContain("crop");
    }
    expect(() => remapQuery(document, { crop: "api_key" })).toThrow(
      "That column cannot be remapped.",
    );
    let refused = "";
    try {
      remapQuery(document, { crop: "secret-value" });
    } catch (error) {
      refused = error instanceof Error ? error.message : "";
    }
    expect(refused).toBe("That column cannot be remapped.");
    expect(refused).not.toContain("secret-value");
    expect(refused).not.toContain("crop");
    const mapped = remapQuery(document, { crop: "plant" });
    expect(document.steps[0]).toEqual({
      op: "filter",
      column: "crop",
      equals: "Tomato",
    });
    const ran = refreshQuery(mapped, drifted, previous, "2026-10-31T00:00:00.000Z");
    expect(ran).toEqual({
      ok: true,
      rows: [{ plant: "Tomato", bed: "North" }],
      refreshedAt: "2026-10-31T00:00:00.000Z",
      stale: false,
    });
    expect(drifted[1].plant).toBe("Bean");
  });

  it("cancels a refresh and keeps the last saved rows", () => {
    const document = queryDocument([
      { op: "filter", column: "crop", equals: "Tomato" },
    ]);
    const previous = {
      rows: [{ bed: "North", crop: "Tomato" }],
      refreshedAt: "2026-10-30T00:00:00.000Z",
    };
    let checks = 0;
    const stopped = refreshQuery(
      document,
      source,
      previous,
      "2026-10-31T00:00:00.000Z",
      () => {
        checks += 1;
        return checks > 1;
      },
    );
    expect(stopped).toEqual({
      ok: false,
      error: "The refresh was cancelled.",
      rows: previous.rows,
      refreshedAt: previous.refreshedAt,
      stale: true,
    });
    expect(source[1].crop).toBe("Bean");
  });

  it("does not refresh a protected source for a viewer", async () => {
    const document = queryDocument([{ op: "filter", column: "crop", equals: "Tomato" }]);
    const previous = { rows: [{ crop: "Tomato" }], refreshedAt: "2026-10-30T22:00:00.000Z" };
    let fetched = 0;
    const viewer = await refreshRemoteQuery({
      document,
      url: "https://tables.example/beds",
      allowed: true,
      protectedSource: true,
      sourceAccess: "viewer",
      fetchRows: async () => {
        fetched += 1;
        return { ok: true, rows: [{ crop: "secret-value" }] };
      },
      previous,
      refreshedAt: "2026-10-31T00:00:00.000Z",
    });
    expect(fetched).toBe(0);
    expect(viewer.ok).toBe(false);
    if (viewer.ok) return;
    expect(viewer.stale).toBe(true);
    expect(viewer.rows).toEqual(previous.rows);
    expect(viewer.error).toBe("You can view this source, but you cannot refresh it.");
    expect(viewer.error).not.toContain("secret-value");

    const editor = await refreshRemoteQuery({
      document,
      url: "https://tables.example/beds",
      allowed: true,
      protectedSource: true,
      sourceAccess: "editor",
      fetchRows: async () => ({ ok: true, rows: source }),
      previous,
      refreshedAt: "2026-10-31T00:00:00.000Z",
    });
    expect(editor.ok).toBe(true);
    if (!editor.ok) return;
    expect(editor.rows).toEqual([{ bed: "North", crop: "Tomato" }]);

    const stranger = await refreshDatabaseQuery({
      document,
      sql: "SELECT crop, bed FROM beds",
      allowed: true,
      protectedSource: true,
      sourceAccess: "none",
      query: async () => {
        throw new Error("password=secret-value");
      },
      previous,
      refreshedAt: "2026-10-31T00:00:00.000Z",
    });
    expect(stranger.ok).toBe(false);
    if (stranger.ok) return;
    expect(stranger.error).toBe("You do not have access to this source.");
    expect(stranger.error).not.toContain("secret-value");
    expect(stranger.rows).toEqual(previous.rows);
  });

  it("reopens a saved query and repeats the same filter", () => {
    const file = createFile("sheet", "Beds") as SheetFile;
    const document = queryDocument([{ op: "filter", column: "crop", equals: "Tomato" }]);
    file.content.queries = [{ id: "beds", document }];
    const reopened = parseFile(JSON.stringify(file));
    if (reopened.kind !== "sheet") throw new Error("expected a spreadsheet");
    const saved = reopened.content.queries?.[0]?.document;
    expect(saved?.steps).toEqual(document.steps);
    const run = refreshQuery(saved!, source, null, "2026-10-31T12:00:00.000Z");
    expect(run).toEqual({
      ok: true,
      rows: [{ bed: "North", crop: "Tomato" }],
      refreshedAt: "2026-10-31T12:00:00.000Z",
      stale: false,
    });
    expect(JSON.stringify(reopened)).not.toContain("secret-value");
    expect(source[1].crop).toBe("Bean");
  });

  it("refuses a credential field without repeating its name", () => {
    expect(() => queryDocument([], { "secret-value": "token" })).toThrow(
      "A query cannot store a credential.",
    );
    try {
      queryDocument([], { "secret-value": "token" });
    } catch (error) {
      expect(String(error)).not.toContain("secret-value");
      expect(String(error)).not.toContain("token");
    }
  });
});
