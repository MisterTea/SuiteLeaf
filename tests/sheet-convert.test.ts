import { describe, expect, it } from "vitest";
import { queryDocument, refreshQuery } from "../packages/core/src/sheet-query";

describe("query type conversion", () => {
  it("converts a number and rejects a value that is not that type", () => {
    const source = [
      { amount: "010", planted: "2026-10-31" },
      { amount: "3", planted: "2026-02-28" },
    ];
    const numbers = refreshQuery(
      queryDocument([{ op: "convert", column: "amount", to: "number" }]),
      source,
      null,
      "2026-10-31T20:00:00.000Z",
    );
    expect(numbers.ok && numbers.rows).toEqual([
      { amount: "10", planted: "2026-10-31" },
      { amount: "3", planted: "2026-02-28" },
    ]);
    expect(source[0].amount).toBe("010");

    const dates = refreshQuery(
      queryDocument([{ op: "convert", column: "planted", to: "date" }]),
      source,
      null,
      "2026-10-31T20:00:00.000Z",
    );
    expect(dates.ok && dates.rows[0].planted).toBe("2026-10-31");

    const stale = refreshQuery(
      queryDocument([{ op: "convert", column: "amount", to: "number" }]),
      [{ amount: "secret-value", planted: "2026-10-31" }],
      { rows: [{ amount: "10", planted: "2026-10-31" }], refreshedAt: "2026-10-31T19:00:00.000Z" },
      "2026-10-31T21:00:00.000Z",
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error).toBe("Column amount is not a number.");
      expect(stale.error).not.toContain("secret-value");
      expect(stale.rows).toEqual([{ amount: "10", planted: "2026-10-31" }]);
      expect(stale.stale).toBe(true);
    }

    const badDay = refreshQuery(
      queryDocument([{ op: "convert", column: "planted", to: "date" }]),
      [{ planted: "2026-02-31" }],
      null,
      "2026-10-31T20:00:00.000Z",
    );
    expect(badDay.ok).toBe(false);
    if (!badDay.ok) expect(badDay.error).toBe("Column planted is not an ISO date.");
  });

  it("keeps the calendar day from a timestamp", () => {
    const source = [
      { planted: "2026-10-31T15:00:00Z" },
      { planted: " 2026-01-15T23:00:00-05:00 " },
    ];
    const dates = refreshQuery(
      queryDocument([{ op: "convert", column: "planted", to: "date" }]),
      source,
      null,
      "2026-10-31T20:00:00.000Z",
    );
    expect(dates.ok && dates.rows.map((row) => row.planted)).toEqual(["2026-10-31", "2026-01-15"]);
    expect(source[0].planted).toBe("2026-10-31T15:00:00Z");

    const impossible = refreshQuery(
      queryDocument([{ op: "convert", column: "planted", to: "date" }]),
      [{ planted: "2026-02-31T00:00:00Z" }],
      { rows: [{ planted: "2026-10-31" }], refreshedAt: "2026-10-31T19:00:00.000Z" },
      "2026-10-31T21:00:00.000Z",
    );
    expect(impossible.ok).toBe(false);
    if (!impossible.ok) {
      expect(impossible.error).toBe("Column planted is not an ISO date.");
      expect(impossible.rows).toEqual([{ planted: "2026-10-31" }]);
      expect(impossible.stale).toBe(true);
    }

    const hidden = refreshQuery(
      queryDocument([{ op: "convert", column: "planted", to: "date" }]),
      [{ planted: "secret-value" }],
      null,
      "2026-10-31T20:00:00.000Z",
    );
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) expect(hidden.error).not.toContain("secret-value");
  });

  it("does not repeat a credential column that cannot be converted", () => {
    const source = [{ "secret-value": "North" }];
    const number = refreshQuery(
      queryDocument([{ op: "convert", column: "secret-value", to: "number" }]),
      source,
      { rows: [{ "secret-value": "10" }], refreshedAt: "2026-10-31T19:00:00.000Z" },
      "2026-10-31T21:00:00.000Z",
    );
    expect(number.ok).toBe(false);
    if (!number.ok) {
      expect(number.error).toBe("That column is not a number.");
      expect(number.error).not.toContain("secret-value");
    }
    const date = refreshQuery(
      queryDocument([{ op: "convert", column: "secret-value", to: "date" }]),
      source,
      { rows: [{ "secret-value": "2026-10-31" }], refreshedAt: "2026-10-31T19:00:00.000Z" },
      "2026-10-31T21:00:00.000Z",
    );
    expect(date.ok).toBe(false);
    if (!date.ok) {
      expect(date.error).toBe("That column is not an ISO date.");
      expect(date.error).not.toContain("secret-value");
    }
    expect(source[0]["secret-value"]).toBe("North");
  });
});