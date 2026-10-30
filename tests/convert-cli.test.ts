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
import { createFile, type SlideFile } from "../packages/core/src";
import { OFFICE_CONVERTER_HEAP_MB } from "../apps/desktop/src/office-converter";
import { exportPptx } from "../packages/core/src/pptx-export";
import { openOfficeFile } from "../packages/core/src/open-office";
import {
  ConvertStopped,
  convertUsage,
  parseConvertArgs,
  runConvertCommand,
} from "../apps/desktop/src/convert-cli";

let root: string, source: string, output: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suiteleaf-convert-"));
  source = join(root, "source");
  output = join(root, "pdfs");
  await mkdir(source);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function deck(name: string, slides: string[]) {
  const file = createFile("slide", name) as SlideFile;
  const first = file.content.slideOrder[0];
  const template = file.content.slides[first];
  file.content.slideOrder = [];
  file.content.slides = {};
  for (const title of slides) {
    const id = crypto.randomUUID();
    file.content.slideOrder.push(id);
    file.content.slides[id] = {
      ...template,
      id,
      elements: [
        {
          ...template.elements[0],
          id: crypto.randomUUID(),
          content: title,
        },
      ],
    };
  }
  return exportPptx(file);
}

const pdf = () => new Uint8Array(Buffer.from("%PDF-1.4\n"));

it("parses convert arguments", () => {
  expect(parseConvertArgs(["--help"])).toBe("help");
  expect(parseConvertArgs([source, "--to", "PDF", "--output", output])).toEqual(
    {
      source,
      output,
    },
  );
  expect(() => parseConvertArgs([source])).toThrow("--to pdf");
  expect(() => parseConvertArgs([source, "--to", "html"])).toThrow("--to pdf");
  expect(() => parseConvertArgs([source, "--to", "pdf", "--output"])).toThrow(
    "--output",
  );
  expect(() => parseConvertArgs([])).toThrow("Provide a PowerPoint");
});

it("writes a PDF for an imported presentation and does not save a SuiteLeaf file", async () => {
  const bytes = await deck("Quarterly", ["Alpha", "Beta"]);
  const pptx = join(source, "quarterly.pptx");
  await writeFile(pptx, bytes);
  const seen: string[] = [];
  const log = vi.fn();
  const code = await runConvertCommand(
    [pptx, "--to", "pdf", "--output", output],
    {
      convertOffice: openOfficeFile,
      openRenderer: async () => async (file) => {
        if (file.kind !== "slide") throw new Error("expected a presentation");
        seen.push(
          ...file.content.slideOrder.map(
            (id) => file.content.slides[id].elements[0].content ?? "",
          ),
        );
        return pdf();
      },
      log,
      error: vi.fn(),
    },
  );
  expect(code).toBe(0);
  expect(seen).toEqual(["Alpha", "Beta"]);
  expect(await readFile(join(output, "quarterly.pdf"))).toEqual(
    Buffer.from("%PDF-1.4\n"),
  );
  expect(await readFile(pptx)).toEqual(Buffer.from(bytes));
  expect(await readdir(output)).toEqual(["quarterly.pdf"]);
  expect(
    (await readdir(source)).some((name) => name.endsWith(".slslides")),
  ).toBe(false);
  expect(log).toHaveBeenCalledWith("Converted 1; skipped 0; failed 0.");
});

it("converts a directory beside each source, skips other files, and numbers existing PDFs", async () => {
  await mkdir(join(source, "nested"));
  await writeFile(
    join(source, "nested", "talk.pptx"),
    await deck("Talk", ["One"]),
  );
  await writeFile(join(source, "notes.docx"), "not a presentation");
  await writeFile(join(source, "nested", "talk.pdf"), "%PDF-old");
  const log = vi.fn();
  const code = await runConvertCommand([source, "--to", "pdf"], {
    convertOffice: async () => createFile("slide", "Talk"),
    openRenderer: async () => async () => pdf(),
    log,
    error: vi.fn(),
  });
  expect(code).toBe(0);
  expect(await readFile(join(source, "nested", "talk.pdf"), "utf8")).toBe(
    "%PDF-old",
  );
  expect(await readFile(join(source, "nested", "talk (1).pdf"))).toEqual(
    Buffer.from("%PDF-1.4\n"),
  );
  expect(await readdir(source)).toEqual(["nested", "notes.docx"]);
  expect(log).toHaveBeenCalledWith("Converted 1; skipped 2; failed 0.");
});

it("keeps going after a bad file and stops when the PDF page cannot start", async () => {
  await writeFile(join(source, "bad.pptx"), "not a powerpoint");
  await writeFile(join(source, "good.pptx"), "ok");
  await writeFile(join(source, "notes.txt"), "skip");
  const error = vi.fn();
  const log = vi.fn();
  expect(
    await runConvertCommand([source, "--to", "pdf", "--output", output], {
      convertOffice: async (_bytes, _format, name) => {
        if (name === "bad.pptx") throw new Error("unreadable presentation");
        return createFile("slide");
      },
      openRenderer: async () => async () => pdf(),
      log,
      error,
    }),
  ).toBe(1);
  expect(error).toHaveBeenCalledWith(expect.stringContaining("unreadable presentation"));
  expect(await readFile(join(output, "good.pdf"))).toEqual(Buffer.from("%PDF-1.4\n"));
  expect(log).toHaveBeenCalledWith("Converted 1; skipped 1; failed 1.");

  await writeFile(join(source, "ok.pptx"), await deck("Ok", ["Slide"]));
  const stopped = vi.fn();
  expect(
    await runConvertCommand([join(source, "ok.pptx"), "--to", "pdf"], {
      convertOffice: async () => createFile("slide"),
      openRenderer: async () => {
        throw new ConvertStopped("PDF export page did not load.");
      },
      log: vi.fn(),
      error: stopped,
    }),
  ).toBe(2);
  expect(stopped).toHaveBeenCalledWith("PDF export page did not load.");
  expect(stopped).not.toHaveBeenCalledWith(convertUsage);
});

it("does not follow a destination symlink out of the output directory", async () => {
  const outside = join(root, "outside");
  await mkdir(outside);
  await mkdir(output);
  await mkdir(join(source, "nested"));
  await writeFile(
    join(source, "nested", "deck.pptx"),
    await deck("Deck", ["Slide"]),
  );
  await symlink(outside, join(output, "nested"), "dir");
  const error = vi.fn();
  expect(
    await runConvertCommand([source, "--to", "pdf", "--output", output], {
      convertOffice: async () => createFile("slide"),
      openRenderer: async () => async () => pdf(),
      log: vi.fn(),
      error,
    }),
  ).toBe(1);
  expect(await readdir(outside)).toEqual([]);
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining("outside the output directory"),
  );
});

it("rejects a missing source without opening the PDF page", async () => {
  const openRenderer = vi.fn();
  const error = vi.fn();
  expect(
    await runConvertCommand([join(root, "missing.pptx"), "--to", "pdf"], {
      convertOffice: async () => createFile("slide"),
      openRenderer,
      log: vi.fn(),
      error,
    }),
  ).toBe(2);
  expect(openRenderer).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(expect.stringContaining("Cannot read"));
  await writeFile(join(source, "report.docx"), "word");
  expect(
    await runConvertCommand([join(source, "report.docx"), "--to", "pdf"], {
      convertOffice: async () => createFile("doc"),
      openRenderer,
      log: vi.fn(),
      error,
    }),
  ).toBe(1);
  expect(openRenderer).not.toHaveBeenCalled();
});

it("gives the office converter enough heap for a photo-heavy deck", () => {
  expect(OFFICE_CONVERTER_HEAP_MB).toBeGreaterThanOrEqual(4096);
});
