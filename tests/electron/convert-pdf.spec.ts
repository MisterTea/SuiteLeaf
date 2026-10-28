import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createFile, type SlideFile } from "../../packages/core/src";
import { exportPptx } from "../../packages/core/src/pptx-export";

test("convert writes a PDF and does not add the presentation to the library", async () => {
  test.setTimeout(180_000);
  const dir = await mkdtemp(join(tmpdir(), "suiteleaf-convert-pdf-"));
  const library = join(dir, "library");
  const source = join(dir, "decks");
  const output = join(dir, "pdfs");
  const file = createFile("slide", "Printed") as SlideFile;
  const first = file.content.slideOrder[0];
  const template = file.content.slides[first];
  const second = crypto.randomUUID();
  file.content.slides[first].elements[0].content = "AlphaSlide";
  file.content.slides[second] = {
    ...template,
    id: second,
    elements: [
      {
        ...template.elements[0],
        id: crypto.randomUUID(),
        content: "BetaSlide",
      },
    ],
  };
  file.content.slideOrder = [first, second];
  const pptx = join(source, "nested", "talk.pptx");
  let child: ChildProcess | undefined;
  try {
    await mkdir(join(source, "nested"), { recursive: true });
    await writeFile(pptx, await exportPptx(file));
    await writeFile(join(source, "notes.txt"), "leave me");
    const packaged = process.env.SUITELEAF_PACKAGED_EXECUTABLE;
    const electron =
      packaged ?? (createRequire(import.meta.url)("electron") as string);
    const args = packaged
      ? ["convert", source, "--to", "pdf", "--output", output]
      : [
          resolve("apps/desktop/out/main/index.js"),
          "convert",
          source,
          "--to",
          "pdf",
          "--output",
          output,
        ];
    const env = { ...process.env, SUITELEAF_TEST_DATA: library };
    delete env.ELECTRON_RUN_AS_NODE;
    let stdout = "",
      stderr = "";
    const code = await new Promise<number | null>((done, reject) => {
      child = spawn(electron, args, { env, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", done);
    });
    expect(`${stdout}\n${stderr}`, "convert command output").toContain(
      "Converted 1; skipped 1; failed 0.",
    );
    expect(code).toBe(0);
    const pdf = await readFile(join(output, "nested", "talk.pdf"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(
      (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length,
    ).toBe(2);
    expect(await readFile(join(source, "notes.txt"), "utf8")).toBe("leave me");
    expect(await readdir(source)).toEqual(["nested", "notes.txt"]);
    await expect(stat(join(library, "library.sqlite"))).rejects.toThrow();
  } finally {
    child?.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
