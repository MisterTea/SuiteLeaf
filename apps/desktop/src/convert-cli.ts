import {
  open,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { SuiteFile } from "@suiteleaf/core";
import { PPTX_INPUT_LIMIT } from "@suiteleaf/core/office";
import { isPowerPointExtension } from "@suiteleaf/core/open-office";
import type { OfficeConverter } from "./directory-import";

export const cliUsage = `Usage:
  SuiteLeaf import <directory> [--output <directory>]
  SuiteLeaf convert <file-or-directory> --to pdf|png [--output <path>]

import copies files into SuiteLeaf documents. convert turns PowerPoint
files into PDFs or PNG slide folders and does not add them to the document
library or SuiteDrive. Use <command> --help for details.
`;

export const convertUsage = `Usage: SuiteLeaf convert <file-or-directory> --to pdf|png [--output <path>]

Import each PowerPoint file and export a PDF or a folder of PNG slides.
The presentation is not saved to the document library or SuiteDrive. Sources
are left unchanged. An existing PDF or PNG folder keeps its name; the new
one gets a numbered name.

--to pdf writes one PDF. A file writes it beside the presentation, or at
--output (a .pdf path or a directory). --to png writes Slide1.png, Slide2.png,
and so on, in a folder named after the presentation. A file creates that
folder beside the presentation, or inside --output. Pass a .png path to
choose the folder name. A directory keeps its subfolders under --output, or
writes each result beside its source when --output is omitted.

Formats: pptx, ppt, ppsx, pptm, potx, ppsm. Other files in a directory are
skipped.

Exit codes: 0 success, 1 file failures, 2 invalid command or unreadable source.
`;

export type ConvertFormat = "pdf" | "png";

export type PdfRenderer = (file: SuiteFile) => Promise<Uint8Array>;

/** One PNG per slide, in deck order, including hidden slides. */
export type PngRenderer = (file: SuiteFile) => Promise<Uint8Array[]>;

/** The PDF page could not be started. Stop the batch instead of failing every file. */
export class ConvertStopped extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConvertStopped";
  }
}

export interface ConvertResult {
  converted: number;
  skipped: number;
  failed: number;
}

export interface ConvertEvent {
  source: string;
  status: "converted" | "skipped" | "failed";
  destination?: string;
  error?: string;
}

const inside = (path: string, root: string) =>
  path === root || path.startsWith(root + sep);

export function parseConvertArgs(
  args: string[],
): { source: string; output?: string; to: ConvertFormat } | "help" {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return "help";
  let source: string | undefined,
    output: string | undefined,
    to: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output") {
      if (output || !args[i + 1] || args[i + 1].startsWith("-"))
        throw new Error("--output requires one path.");
      output = resolve(args[++i]);
    } else if (args[i] === "--to") {
      if (to || !args[i + 1] || args[i + 1].startsWith("-"))
        throw new Error("--to pdf or --to png is required.");
      to = args[++i].toLowerCase();
    } else if (args[i].startsWith("-") || source)
      throw new Error(`Unexpected argument: ${args[i]}`);
    else source = resolve(args[i]);
  }
  if (!source) throw new Error("Provide a PowerPoint file or a directory.");
  if (to !== "pdf" && to !== "png")
    throw new Error("--to pdf or --to png is required.");
  return { source, output, to };
}

export function isPng(bytes: Uint8Array) {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

/** PowerPoint names each picture Slide1.png, Slide2.png, with no padding. */
export function slidePngName(index: number) {
  return `Slide${index + 1}.png`;
}

/** A save dialog path. A .png suffix is the folder name, not a picture file. */
export function slidePngFolder(savePath: string) {
  const folder =
    extname(savePath).toLowerCase() === ".png"
      ? savePath.slice(0, -4)
      : savePath;
  if (!folder || folder.endsWith(sep))
    throw new Error("Choose a folder name for the slide pictures.");
  return folder;
}

/** Write Slide1.png and the rest into a new folder. An existing folder keeps its name. */
export async function writeSlidePngFolder(
  parent: string,
  stem: string,
  slides: Uint8Array[],
  contain: string | undefined,
): Promise<string> {
  if (!stem) throw new Error("Choose a folder name.");
  if (!slides.length) throw new Error("This presentation has no slides.");
  if (slides.some((bytes) => !isPng(bytes)))
    throw new Error("Export did not produce a PNG.");
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  if (contain && !inside(realParent, contain))
    throw new Error("Destination folder points outside the output directory.");
  for (let suffix = 0; suffix <= 10000; suffix++) {
    const target = join(parent, `${stem}${suffix ? ` (${suffix})` : ""}`);
    try {
      await mkdir(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    try {
      const realTarget = await realpath(target);
      if (contain && !inside(realTarget, contain))
        throw new Error(
          "Destination folder points outside the output directory.",
        );
      await writeSlidePictures(target, slides);
      return target;
    } catch (error) {
      await rm(target, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }
  throw new Error(`Too many existing folders named ${stem}.`);
}

/** Replace picture files in a folder the person already chose. */
export async function writeSlidePictures(
  folder: string,
  slides: Uint8Array[],
) {
  if (!slides.length) throw new Error("This presentation has no slides.");
  await mkdir(folder, { recursive: true });
  for (let i = 0; i < slides.length; i++) {
    if (!isPng(slides[i])) throw new Error("Export did not produce a PNG.");
    await writeFile(join(folder, slidePngName(i)), slides[i]);
  }
}

async function writePdf(
  folder: string,
  stem: string,
  bytes: Uint8Array,
  contain: string | undefined,
): Promise<string> {
  await mkdir(folder, { recursive: true });
  const realFolder = await realpath(folder);
  if (contain && !inside(realFolder, contain))
    throw new Error("Destination folder points outside the output directory.");
  if (!stem) throw new Error("Choose a PDF file name.");
  for (let suffix = 0; suffix <= 10000; suffix++) {
    const target = join(folder, `${stem}${suffix ? ` (${suffix})` : ""}.pdf`);
    let handle;
    try {
      handle = await open(target, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(target).catch(() => {});
      throw error;
    }
    await handle.close();
    return target;
  }
  throw new Error(`Too many existing PDFs named ${stem}.pdf.`);
}

/** Import PowerPoint files and write PDFs or PNG folders. Nothing is added to a library. */
export async function convertPresentations(
  source: string,
  output: string | undefined,
  format: ConvertFormat,
  options: {
    convertOffice: OfficeConverter;
    openRenderer: () => Promise<PdfRenderer>;
    openPngRenderer?: () => Promise<PngRenderer>;
    onFile?: (event: ConvertEvent) => void;
  },
): Promise<ConvertResult> {
  const root = await realpath(resolve(source));
  const sourceStat = await stat(root);
  const sourceIsDirectory = sourceStat.isDirectory();
  if (
    sourceIsDirectory &&
    output &&
    [".pdf", ".png"].includes(extname(output).toLowerCase())
  )
    throw new Error(
      "--output must be a directory when converting a directory.",
    );
  const outputRoot =
    sourceIsDirectory && output
      ? await realpath(
          await mkdir(output, { recursive: true }).then(() => output),
        )
      : undefined;
  // An output folder placed inside the source must not be scanned.
  const nestedOutput =
    outputRoot && inside(outputRoot, root) && outputRoot !== root
      ? outputRoot
      : undefined;
  const result: ConvertResult = { converted: 0, skipped: 0, failed: 0 };
  let renderer: PdfRenderer | undefined;
  let pngRenderer: PngRenderer | undefined;
  const picture = format === "png" ? "PNG" : "PDF";
  const convertOne = async (path: string, allowSkip: boolean) => {
    const extension = extname(path).slice(1).toLowerCase();
    if (!isPowerPointExtension(extension)) {
      if (allowSkip) {
        result.skipped++;
        options.onFile?.({ source: path, status: "skipped" });
      } else {
        result.failed++;
        options.onFile?.({
          source: path,
          status: "failed",
          error: `Only PowerPoint files can be converted to ${picture}.`,
        });
      }
      return;
    }
    try {
      if ((await stat(path)).size > PPTX_INPUT_LIMIT)
        throw new Error("Office imports are limited to 512 MB.");
      const file = await options.convertOffice(
        await readFile(path),
        extension,
        basename(path),
      );
      if (file.kind !== "slide")
        throw new Error(
          "This PowerPoint file did not import as a presentation.",
        );
      const stem = basename(path, extname(path));
      const explicitFile =
        !sourceIsDirectory &&
        output &&
        extname(output).toLowerCase() === (format === "png" ? ".png" : ".pdf")
          ? output
          : undefined;
      const folder = explicitFile
        ? dirname(explicitFile)
        : sourceIsDirectory
          ? output
            ? join(output, relative(root, dirname(path)))
            : dirname(path)
          : (output ?? dirname(path));
      const name = explicitFile
        ? basename(explicitFile, extname(explicitFile))
        : stem;
      if (resolve(folder, `${name}.${format}`) === path)
        throw new Error(
          `Refusing to replace the PowerPoint file with a ${picture}.`,
        );
      let destination: string;
      if (format === "png") {
        if (!pngRenderer) {
          if (!options.openPngRenderer)
            throw new Error("PNG export is not available.");
          pngRenderer = await options.openPngRenderer();
        }
        destination = await writeSlidePngFolder(
          folder,
          name,
          await pngRenderer(file),
          outputRoot,
        );
      } else {
        renderer ??= await options.openRenderer();
        const bytes = await renderer(file);
        if (
          bytes.length < 5 ||
          new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-"
        )
          throw new Error("Export did not produce a PDF.");
        destination = await writePdf(folder, name, bytes, outputRoot);
      }
      result.converted++;
      options.onFile?.({ source: path, status: "converted", destination });
    } catch (error) {
      if (error instanceof ConvertStopped) throw error;
      result.failed++;
      options.onFile?.({
        source: path,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  if (!sourceIsDirectory) {
    await convertOne(root, false);
    return result;
  }
  const walk = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      // "~$" files are the owner locks Office writes beside an open document.
      if (entry.name.startsWith(".") || entry.name.startsWith("~$")) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (path === nestedOutput) continue;
        try {
          await walk(path);
        } catch (error) {
          if (error instanceof ConvertStopped) throw error;
          result.failed++;
          options.onFile?.({
            source: path,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
        continue;
      }
      if (entry.isFile()) await convertOne(path, true);
    }
  };
  await walk(root);
  return result;
}

export async function runConvertCommand(
  args: string[],
  options: {
    convertOffice: OfficeConverter;
    openRenderer: () => Promise<PdfRenderer>;
    openPngRenderer?: () => Promise<PngRenderer>;
    log: (message: string) => void;
    error: (message: string) => void;
  },
): Promise<number> {
  try {
    const parsed = parseConvertArgs(args);
    if (parsed === "help") {
      options.log(convertUsage);
      return 0;
    }
    try {
      await stat(parsed.source);
    } catch {
      throw new Error(`Cannot read ${parsed.source}.`);
    }
    const result = await convertPresentations(
      parsed.source,
      parsed.output,
      parsed.to,
      {
        convertOffice: options.convertOffice,
        openRenderer: options.openRenderer,
        openPngRenderer: options.openPngRenderer,
        onFile: (event) => {
          if (event.status === "failed")
            options.error(`Failed: ${event.source}: ${event.error}`);
          else if (event.status === "converted")
            options.log(`Converted: ${event.source} → ${event.destination}`);
        },
      },
    );
    options.log(
      `Converted ${result.converted}; skipped ${result.skipped}; failed ${result.failed}.`,
    );
    return result.failed ? 1 : 0;
  } catch (error) {
    options.error(error instanceof Error ? error.message : String(error));
    if (!(error instanceof ConvertStopped)) options.error(convertUsage);
    return 2;
  }
}
