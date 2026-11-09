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
  slidePngFolder,
  writeSlidePictures,
  writeSlidePngFolder,
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
const png = () =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

it("parses convert arguments", () => {
  expect(parseConvertArgs(["--help"])).toBe("help");
  expect(parseConvertArgs([source, "--to", "PDF", "--output", output])).toEqual(
    {
      source,
      output,
      to: "pdf",
    },
  );
  expect(parseConvertArgs([source, "--to", "png"])).toEqual({
    source,
    to: "png",
  });
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

it("writes a PNG folder named Slide1.png onward and numbers an existing folder", async () => {
  const bytes = await deck("Lecture", ["Alpha", "Beta"]);
  const pptx = join(source, "lecture.pptx");
  await writeFile(pptx, bytes);
  await mkdir(join(output, "lecture"), { recursive: true });
  await writeFile(join(output, "lecture", "Slide1.png"), png());
  const code = await runConvertCommand(
    [pptx, "--to", "png", "--output", output],
    {
      convertOffice: openOfficeFile,
      openRenderer: async () => async () => pdf(),
      openPngRenderer: async () => async () => [png(), png()],
      log: vi.fn(),
      error: vi.fn(),
    },
  );
  expect(code).toBe(0);
  expect(await readdir(join(output, "lecture"))).toEqual(["Slide1.png"]);
  expect(await readdir(join(output, "lecture (1)"))).toEqual([
    "Slide1.png",
    "Slide2.png",
  ]);
  expect(await readFile(pptx)).toEqual(Buffer.from(bytes));
  expect(slidePngFolder(join(output, "lecture.png"))).toBe(
    join(output, "lecture"),
  );
});

it("converts a directory beside each source, skips other files, and numbers existing PDFs", async () => {
  await mkdir(join(source, "nested"));
  await writeFile(
    join(source, "nested", "talk.pptx"),
    await deck("Talk", ["One"]),
  );
  await writeFile(join(source, "notes.docx"), "not a presentation");
  await writeFile(join(source, "nested", "talk.pdf"), "%PDF-old");
  await writeFile(join(source, "nested", "~$talk.pptx"), "owner lock");
  const imported: string[] = [];
  const log = vi.fn();
  const code = await runConvertCommand([source, "--to", "pdf"], {
    convertOffice: async (_bytes, _format, name) => {
      imported.push(name);
      return createFile("slide", "Talk");
    },
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
  expect(imported).toEqual(["talk.pptx"]);
  expect(
    (await readdir(join(source, "nested"))).filter((name) =>
      name.startsWith("~$"),
    ),
  ).toEqual(["~$talk.pptx"]);
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
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining("unreadable presentation"),
  );
  expect(await readFile(join(output, "good.pdf"))).toEqual(
    Buffer.from("%PDF-1.4\n"),
  );
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

it("round trips editable PPTX through the CLI without opening a renderer", async () => {
  const original = join(source, "roundtrip.pptx");
  await writeFile(original, await deck("Round trip", ["Alpha", "Beta"]));
  const openRenderer = vi.fn();
  const options = {
    convertOffice: openOfficeFile,
    openRenderer,
    log: vi.fn(),
    error: vi.fn(),
  };
  const target = join(output, "result.pptx");
  expect(
    await runConvertCommand(
      [original, "--to", "pptx", "--output", target],
      options,
    ),
  ).toBe(0);
  expect(
    await runConvertCommand(
      [original, "--to", "pptx", "--output", target],
      options,
    ),
  ).toBe(0);
  expect(openRenderer).not.toHaveBeenCalled();
  const imported = await openOfficeFile(
    await readFile(target),
    "pptx",
    "Result",
  );
  expect(imported.kind).toBe("slide");
  if (imported.kind !== "slide") throw new Error("not a slide");
  expect(imported.content.slideOrder).toHaveLength(2);
  expect(
    imported.content.slides[imported.content.slideOrder[1]].elements[0].content,
  ).toBe("Beta");
  expect(await readdir(output)).toEqual(["result (1).pptx", "result.pptx"]);
  expect(
    await runConvertCommand(
      [original, "--to", "pptx", "--output", original],
      options,
    ),
  ).toBe(1);
  expect(
    await runConvertCommand(
      [source, "--to", "pptx", "--output", target],
      options,
    ),
  ).toBe(2);
});

it("writes JSON, Markdown, and terminal compatibility reports for PPTX round trips", async () => {
  const original = join(source, "report.pptx");
  await writeFile(original, await deck("Report", ["Hello"]));
  const log = vi.fn();
  const options = {
    convertOffice: openOfficeFile,
    openRenderer: vi.fn(),
    log,
    error: vi.fn(),
  };
  for (const extension of ["json", "md"]) {
    const report = join(root, `compat.${extension}`);
    expect(
      await runConvertCommand(
        [original, "--to", "pptx", "--output", output, "--report", report],
        options,
      ),
    ).toBe(0);
    expect((await readFile(report, "utf8")).length).toBeGreaterThan(20);
  }
  expect(
    await runConvertCommand(
      [original, "--to", "pptx", "--output", output, "--report"],
      options,
    ),
  ).toBe(0);
  expect(log.mock.calls.length).toBeGreaterThan(6);
  expect(await runConvertCommand(["--help"], options)).toBe(0);
});

it("rejects invalid renderer output and imports that are not presentations", async () => {
  const original = join(source, "broken.pptx");
  await writeFile(original, "placeholder");
  const error = vi.fn();
  const options = {
    convertOffice: async () => createFile("slide"),
    openRenderer: async () => async () => new Uint8Array(),
    log: vi.fn(),
    error,
  };
  expect(await runConvertCommand([original, "--to", "pdf"], options)).toBe(1);
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining("did not produce a PDF"),
  );
  expect(await runConvertCommand([original, "--to", "png"], options)).toBe(1);
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining("PNG export is not available"),
  );
  expect(
    await runConvertCommand([original, "--to", "pptx"], {
      ...options,
      convertOffice: async () => createFile("doc"),
    }),
  ).toBe(1);
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining("did not import as a presentation"),
  );
});

it("writes chosen PNG picture folders and rejects empty or invalid slides", async () => {
  await writeSlidePictures(output, [png(), png()]);
  expect(await readdir(output)).toEqual(["Slide1.png", "Slide2.png"]);
  await expect(writeSlidePictures(output, [])).rejects.toThrow("no slides");
  await expect(writeSlidePictures(output, [new Uint8Array()])).rejects.toThrow(
    "did not produce a PNG",
  );
  expect(() => slidePngFolder("")).toThrow("Choose a folder");
});

it("rejects invalid PNG batches before allocating export folders", async () => {
  await expect(
    writeSlidePngFolder(output, "", [png()], undefined),
  ).rejects.toThrow("folder name");
  await expect(
    writeSlidePngFolder(output, "empty", [], undefined),
  ).rejects.toThrow("no slides");
  await expect(
    writeSlidePngFolder(output, "invalid", [new Uint8Array()], undefined),
  ).rejects.toThrow("PNG");
});
