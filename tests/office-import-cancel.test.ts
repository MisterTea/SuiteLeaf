import { createFile } from "@suiteleaf/core";
import { expect, it } from "vitest";
import { importFile, opensImportedFile } from "../apps/web/src/imports";
import { settleOfficeImport } from "../apps/web/src/office-import";

it("opens a single import and stays put for a batch", () => {
  expect(opensImportedFile(1)).toBe(true);
  expect(opensImportedFile(2)).toBe(false);
});

it("keeps the saved spreadsheet when an import is cancelled", async () => {
  const saved = createFile("sheet", "Beds");
  const loaded = createFile("sheet", "secret-value");
  const kept = settleOfficeImport({
    saved,
    loaded,
    stopped: true,
    error: "secret-value",
  });
  expect(kept).toEqual({ file: saved });
  expect(JSON.stringify(kept)).not.toContain("secret-value");

  const refused = settleOfficeImport({
    saved: null,
    loaded,
    stopped: true,
    error: "secret-value",
  });
  expect(refused).toEqual({
    error: "Import cancelled. The original file is unchanged.",
  });
  expect(JSON.stringify(refused)).not.toContain("secret-value");

  const file = new File(["secret-value"], "secret-value.csv", { type: "text/csv" });
  const stopped = importFile(file, undefined, undefined, {
    shouldStop: () => true,
  });
  await expect(stopped).rejects.toThrow(
    "Import cancelled. The original file is unchanged.",
  );
  await expect(stopped).rejects.not.toThrow(/secret-value/);

  const held = await importFile(file, undefined, undefined, {
    saved,
    shouldStop: () => true,
  });
  expect(held).toBe(saved);
});
