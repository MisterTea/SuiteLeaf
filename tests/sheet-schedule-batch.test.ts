import { describe, expect, it, vi } from "vitest";
import { queryDocument, runScheduledBatch } from "../packages/core/src/sheet-query";

describe("scheduled refresh batch", () => {
  it("retries one source, keeps the next waiting, and cancels the rest", async () => {
    const document = queryDocument([{ op: "select", columns: ["crop"] }]);
    const previous = { rows: [{ crop: "Tomato" }], refreshedAt: "2026-10-30T22:00:00.000Z" };
    const schedule = {
      url: "https://secret-value.example/beds",
      everyMs: 60_000,
      lastRunAt: null,
    };
    let beds = 0;
    let active = 0;
    let peak = 0;
    let stop = false;
    const batch = await runScheduledBatch({
      jobs: [
        { id: "Beds", document, schedule, previous },
        { id: "Paths", document, schedule: { ...schedule, url: "https://tables.example/paths" }, previous },
        { id: "North", document, schedule, previous },
      ],
      now: "2026-10-31T01:00:00.000Z",
      allowed: true,
      limit: 1,
      retries: 1,
      shouldStop: () => stop,
      fetchRows: async (url) => {
        active += 1;
        peak = Math.max(peak, active);
        try {
          if (url.includes("beds")) {
            beds += 1;
            if (beds === 1) return { ok: false, status: 500 };
            stop = true;
            return { ok: true, status: 200, rows: [{ crop: "Tomato" }] };
          }
          return { ok: true, status: 200, rows: [{ crop: "Bean" }] };
        } finally {
          active -= 1;
        }
      },
    });
    expect(peak).toBe(1);
    expect(batch.results[0].attempts).toBe(2);
    expect(batch.results[0].run && batch.results[0].run.ok).toBe(true);
    expect(batch.results[1].fetched).toBe(false);
    expect(batch.results[1].schedule.lastRunAt).toBeNull();
    expect(batch.results[2].fetched).toBe(false);
    expect(batch.notices).toContain("Beds was refreshed.");
    expect(batch.notices).toContain("Paths was cancelled.");
    expect(batch.notices).toContain("North was cancelled.");
    expect(JSON.stringify(batch.notices)).not.toContain("secret-value");
    expect(JSON.stringify(document)).not.toContain("secret-value");
  });

  it("stops a slow source and does not repeat the address", async () => {
    vi.useFakeTimers();
    const document = queryDocument([{ op: "select", columns: ["crop"] }]);
    const previous = { rows: [{ crop: "Tomato" }], refreshedAt: "2026-10-30T22:00:00.000Z" };
    const pending = runScheduledBatch({
      jobs: [
        {
          id: "Beds",
          document,
          schedule: { url: "https://secret-value.example/beds", everyMs: 60_000, lastRunAt: null },
          previous,
        },
      ],
      now: "2026-10-31T01:00:00.000Z",
      allowed: true,
      limit: 1,
      retries: 0,
      timeoutMs: 1000,
      fetchRows: () => new Promise(() => {}),
    });
    await vi.advanceTimersByTimeAsync(1000);
    const batch = await pending;
    expect(batch.results[0].run?.ok).toBe(false);
    if (batch.results[0].run?.ok === false) {
      expect(batch.results[0].run.error).toBe("The source took too long.");
      expect(batch.results[0].run.error).not.toContain("secret-value");
      expect(batch.results[0].run.rows).toEqual(previous.rows);
    }
    expect(JSON.stringify(batch.notices)).not.toContain("secret-value");
    vi.useRealTimers();
  });

  it("refuses a limit that is not a time", async () => {
    const document = queryDocument([{ op: "select", columns: ["crop"] }]);
    const batch = await runScheduledBatch({
      jobs: [
        {
          id: "Beds",
          document,
          schedule: { url: "https://secret-value.example/beds", everyMs: 60_000, lastRunAt: null },
          previous: null,
        },
      ],
      now: "2026-10-31T01:00:00.000Z",
      allowed: true,
      limit: 1,
      retries: 1,
      timeoutMs: Number.NaN,
      fetchRows: async () => {
        throw new Error("https://secret-value.example/beds");
      },
    });
    expect(batch.results[0].attempts).toBe(1);
    expect(batch.results[0].run?.ok).toBe(false);
    if (batch.results[0].run?.ok === false) {
      expect(batch.results[0].run.error).toBe("The refresh limit is not a time.");
      expect(batch.results[0].run.error).not.toContain("secret-value");
    }
  });
});