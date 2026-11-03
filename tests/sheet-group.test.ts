import { describe, expect, it } from "vitest";
import { queryDocument, refreshQuery } from "../packages/core/src/sheet-query";

describe("query group", () => {
  it("sums each group in first-seen order and leaves the source unchanged", () => {
    const source = [
      { bed: "North", amount: "10" },
      { bed: "North", amount: "5" },
      { bed: "North", amount: "secret-value" },
      { bed: "South", amount: "3" },
    ];
    const run = refreshQuery(
      queryDocument([{ op: "group", by: "bed", value: "amount", aggregate: "sum" }]),
      source,
      null,
      "2026-10-31T20:00:00.000Z",
    );
    expect(run).toEqual({
      ok: true,
      rows: [
        { bed: "North", amount: "15" },
        { bed: "South", amount: "3" },
      ],
      refreshedAt: "2026-10-31T20:00:00.000Z",
      stale: false,
    });
    expect(JSON.stringify(run)).not.toContain("secret-value");
    expect(source[2].amount).toBe("secret-value");

    const counted = refreshQuery(
      queryDocument([{ op: "group", by: "bed", value: "amount", aggregate: "count" }]),
      source,
      null,
      "2026-10-31T20:00:00.000Z",
    );
    expect(counted.ok && counted.rows).toEqual([
      { bed: "North", amount: "3" },
      { bed: "South", amount: "1" },
    ]);

    const averaged = refreshQuery(
      queryDocument([{ op: "group", by: "bed", value: "amount", aggregate: "average" }]),
      source,
      null,
      "2026-10-31T20:00:00.000Z",
    );
    expect(averaged.ok && averaged.rows).toEqual([
      { bed: "North", amount: "7.5" },
      { bed: "South", amount: "3" },
    ]);
    expect(JSON.stringify(averaged)).not.toContain("secret-value");

    const blank = refreshQuery(
      queryDocument([{ op: "group", by: "bed", value: "amount", aggregate: "average" }]),
      [{ bed: "East", amount: "secret-value" }],
      null,
      "2026-10-31T20:00:00.000Z",
    );
    expect(blank.ok && blank.rows).toEqual([{ bed: "East", amount: "" }]);
    expect(JSON.stringify(blank)).not.toContain("secret-value");

    const stale = refreshQuery(
      queryDocument([{ op: "group", by: "plot", value: "amount", aggregate: "sum" }]),
      source,
      { rows: [{ bed: "North", amount: "15" }], refreshedAt: "2026-10-31T19:00:00.000Z" },
      "2026-10-31T21:00:00.000Z",
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error).toContain("plot");
      expect(stale.error).not.toContain("secret-value");
      expect(stale.rows).toEqual([{ bed: "North", amount: "15" }]);
      expect(stale.stale).toBe(true);
    }
  });

  it("keeps the smallest and largest number in each group", () => {
    const source = [
      { bed: "North", amount: "10" },
      { bed: "North", amount: "5" },
      { bed: "North", amount: "secret-value" },
      { bed: "South", amount: "3" },
    ];
    const smallest = refreshQuery(
      queryDocument([{ op: "group", by: "bed", value: "amount", aggregate: "min" }]),
      source,
      null,
      "2026-11-01T00:00:00.000Z",
    );
    expect(smallest.ok && smallest.rows).toEqual([
      { bed: "North", amount: "5" },
      { bed: "South", amount: "3" },
    ]);
    const largest = refreshQuery(
      queryDocument([{ op: "group", by: "bed", value: "amount", aggregate: "max" }]),
      source,
      null,
      "2026-11-01T00:00:00.000Z",
    );
    expect(largest.ok && largest.rows).toEqual([
      { bed: "North", amount: "10" },
      { bed: "South", amount: "3" },
    ]);
    const blank = refreshQuery(
      queryDocument([{ op: "group", by: "bed", value: "amount", aggregate: "min" }]),
      [{ bed: "East", amount: "secret-value" }],
      null,
      "2026-11-01T00:00:00.000Z",
    );
    expect(blank.ok && blank.rows).toEqual([{ bed: "East", amount: "" }]);
    expect(JSON.stringify(smallest)).not.toContain("secret-value");
    const plots = refreshQuery(
      queryDocument([{ op: "group", by: "plot", value: "amount", aggregate: "sum" }]),
      [
        { plot: "10", amount: "4" },
        { plot: "10.0", amount: "6" },
        { plot: "north", amount: "1" },
      ],
      null,
      "2026-11-01T00:00:00.000Z",
    );
    expect(plots.ok && plots.rows).toEqual([
      { plot: "10", amount: "10" },
      { plot: "north", amount: "1" },
    ]);
    expect(JSON.stringify(largest)).not.toContain("secret-value");
    expect(JSON.stringify(blank)).not.toContain("secret-value");
    expect(source[2].amount).toBe("secret-value");
  });
});