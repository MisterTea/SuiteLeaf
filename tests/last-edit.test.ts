import { describe, expect, test } from "vitest";
import {
  lastEditLine,
  lastEditOf,
  rowEditLabel,
} from "../apps/web/src/drive/last-edit";

const now = new Date(2026, 9, 12, 15, 0, 0);

describe("last editor label", () => {
  test("names the head author, not the owner, with version history's clock", () => {
    const edit = lastEditOf({
      kind: "file",
      lastAuthorName: "Sam Okafor",
      lastEditedAt: new Date(2026, 9, 12, 9, 14).toISOString(),
    });
    expect(edit?.name).toBe("Sam Okafor");
    expect(lastEditLine(edit!, now)).toBe(
      "Last edited by Sam Okafor · Today 09:14",
    );
    expect(rowEditLabel(edit!, now)).toBe("Sam Okafor · Today 09:14");
  });

  test("folders and files with no head version name nobody", () => {
    expect(
      lastEditOf({
        kind: "folder",
        lastAuthorName: "Rosa Diaz",
        lastEditedAt: now.toISOString(),
      }),
    ).toBeNull();
    expect(lastEditOf({ kind: "file", lastAuthorName: "  ", lastEditedAt: "" })).toBeNull();
    expect(lastEditOf({ kind: "file" })).toBeNull();
  });
});
