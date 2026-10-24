import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, Packer, Paragraph } from "docx";
import {
  createFile,
  parseNamedFile,
  serializeFile,
} from "../packages/core/src";
import { documentText } from "../packages/core/src/word";
import { importDirectory } from "../apps/desktop/src/directory-import";
import {
  parseImportArgs,
  runImportCommand,
} from "../apps/desktop/src/import-cli";
import { FileStore } from "../apps/desktop/src/store";

let root: string, source: string, output: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suiteleaf-import-"));
  source = join(root, "source");
  output = join(root, "output");
  await mkdir(source);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("imports nested Office, native, HTML, text and delimited files that the registry can scan", async () => {
  await mkdir(join(source, "nested"));
  const native = createFile("doc", "Native");
  await writeFile(join(source, "native.sldoc"), serializeFile(native));
  await writeFile(join(source, "note.txt"), "First line\nSecond line");
  await writeFile(join(source, "page.html"), "<h1>Hello</h1><p>World</p>");
  await writeFile(join(source, "data.csv"), "Name,Amount\nTea,12\nCoffee,18");
  await writeFile(
    join(source, "nested", "word.docx"),
    await Packer.toBuffer(
      new Document({
        sections: [{ children: [new Paragraph("Office source")] }],
      }),
    ),
  );
  await writeFile(join(source, "unsupported.bin"), "unrelated");
  expect(await importDirectory(source, output)).toEqual({
    imported: 5,
    skipped: 1,
    failed: 0,
  });
  const text = parseNamedFile(
    "note.sldoc",
    await readFile(join(output, "note.sldoc"), "utf8"),
  );
  expect(text.kind === "doc" && documentText(text.content)).toBe(
    "First lineSecond line",
  );
  const sheet = parseNamedFile(
    "data.slsheet",
    await readFile(join(output, "data.slsheet"), "utf8"),
  );
  if (sheet.kind !== "sheet") throw new Error("Expected a spreadsheet");
  expect(
    sheet.content.workbook.sheets[sheet.content.workbook.sheetOrder[0]]
      .cellData?.[1]?.[1]?.v,
  ).toBe(12);
  const store = new FileStore(join(root, "registry"));
  await store.init();
  await store.syncFolder(output);
  expect(await store.list()).toHaveLength(5);
  expect(await readFile(join(source, "note.txt"), "utf8")).toBe(
    "First line\nSecond line",
  );
});

it("keeps existing files and handles output nested within the source without recursive imports", async () => {
  output = join(source, "converted");
  await mkdir(output);
  await writeFile(join(output, "same.sldoc"), "keep existing");
  await writeFile(join(source, "same.txt"), "new source");
  expect(await importDirectory(source, output)).toEqual({
    imported: 1,
    skipped: 0,
    failed: 0,
  });
  expect(await readFile(join(output, "same.sldoc"), "utf8")).toBe(
    "keep existing",
  );
  expect((await readdir(output)).sort()).toEqual([
    "same (1).sldoc",
    "same.sldoc",
  ]);
});

it("continues past corrupt files and returns a failing command exit code", async () => {
  await writeFile(join(source, "broken.sldoc"), "not JSON");
  await writeFile(join(source, "good.txt"), "Still imported");
  const log = vi.fn(),
    error = vi.fn();
  const code = await runImportCommand([source], {
    defaultDirectory: output,
    log,
    error,
  });
  expect(code).toBe(1);
  expect(log).toHaveBeenCalledWith("Imported 1; skipped 0; failed 1.");
  expect(error).toHaveBeenCalledWith(expect.stringContaining("broken.sldoc"));
  expect(await readFile(join(output, "good.sldoc"), "utf8")).toContain(
    "Still imported",
  );
});

it("does not follow source or destination symlinks outside the chosen folders", async () => {
  const outside = join(root, "outside");
  await mkdir(outside);
  await mkdir(output);
  await writeFile(join(outside, "private.txt"), "private");
  await symlink(outside, join(source, "linked"), "dir");
  await mkdir(join(source, "nested"));
  await writeFile(join(source, "nested", "note.txt"), "new");
  await symlink(outside, join(output, "nested"), "dir");
  expect(await importDirectory(source, output)).toEqual({
    imported: 0,
    skipped: 0,
    failed: 1,
  });
  expect(await readdir(outside)).toEqual(["private.txt"]);
});

it("validates CLI arguments and reports missing source directories", async () => {
  expect(parseImportArgs(["--help"])).toBe("help");
  expect(parseImportArgs([source, "--output", output])).toEqual({
    source,
    output,
  });
  expect(() => parseImportArgs([source, "--output"])).toThrow("--output");
  expect(() => parseImportArgs([source, "--unknown"])).toThrow("Unexpected");
  expect(() => parseImportArgs([])).toThrow("Provide a directory");
  expect(
    await runImportCommand([join(root, "missing")], {
      defaultDirectory: output,
      log: vi.fn(),
      error: vi.fn(),
    }),
  ).toBe(2);
});

it("embeds local Markdown pictures and safely imports into the source folder itself", async () => {
  await writeFile(join(source, "deck.md"), "# Deck\n\n![Logo](logo.png)");
  await writeFile(
    join(source, "logo.png"),
    Buffer.from("iVBORw0KGgo=", "base64"),
  );
  const original = createFile("doc", "Already native");
  await writeFile(join(source, "original.sldoc"), serializeFile(original));
  expect(await importDirectory(source, source)).toEqual({
    imported: 1,
    skipped: 2,
    failed: 0,
  });
  const file = parseNamedFile(
    "deck.slslides",
    await readFile(join(source, "deck.slslides"), "utf8"),
  );
  if (file.kind !== "slide") throw new Error("Expected a presentation");
  expect(file.content.marpAssets?.["logo.png"]).toMatch(
    /^data:image\/png;base64,/,
  );
  expect(await readFile(join(source, "original.sldoc"), "utf8")).toBe(
    serializeFile(original),
  );
});
