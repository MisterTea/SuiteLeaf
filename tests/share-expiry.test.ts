import { describe, expect, it } from "vitest";
import {
  endedPhrase,
  untilPhrase,
} from "../apps/web/src/drive/share-expiry";

describe("share expiry wording", () => {
  const monday = new Date(2026, 9, 12, 15, 0, 0);

  it("names the coming Saturday while access is still open", () => {
    const saturday = new Date(2026, 9, 17).toISOString();
    expect(untilPhrase(saturday, monday)).toBe("until Saturday");
  });

  it("names the Saturday that has already passed", () => {
    const saturday = new Date(2026, 9, 10).toISOString();
    expect(endedPhrase(saturday, monday)).toBe("Access ended Saturday");
  });
});
