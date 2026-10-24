import { resolve } from "node:path";
import { importDirectory, type OfficeConverter } from "./directory-import";

export const importUsage = `Usage: SuiteLeaf import <directory> [--output <directory>]

Recursively import Office, OpenDocument, RTF, SuiteLeaf, Markdown, HTML,
text, CSV and TSV files. Defaults to the document directory in Settings.
Sources are unchanged; existing output files receive numbered names.
Exit codes: 0 success, 1 file failures, 2 invalid command or directory.
`;

export function parseImportArgs(
  args: string[],
): { source: string; output?: string } | "help" {
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return "help";
  let source: string | undefined, output: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output") {
      if (output || !args[i + 1] || args[i + 1].startsWith("-"))
        throw new Error("--output requires one directory.");
      output = resolve(args[++i]);
    } else if (args[i].startsWith("-") || source)
      throw new Error(`Unexpected argument: ${args[i]}`);
    else source = resolve(args[i]);
  }
  if (!source) throw new Error("Provide a directory to import.");
  return { source, output };
}

export async function runImportCommand(
  args: string[],
  options: {
    defaultDirectory: string;
    convertOffice?: OfficeConverter;
    log: (message: string) => void;
    error: (message: string) => void;
  },
): Promise<number> {
  try {
    const parsed = parseImportArgs(args);
    if (parsed === "help") {
      options.log(importUsage);
      return 0;
    }
    const result = await importDirectory(
      parsed.source,
      parsed.output ?? options.defaultDirectory,
      {
        convertOffice: options.convertOffice,
        onFile: (event) => {
          if (event.status === "failed")
            options.error(`Failed: ${event.source}: ${event.error}`);
          else if (event.status === "imported")
            options.log(`Imported: ${event.source} → ${event.destination}`);
        },
      },
    );
    options.log(
      `Imported ${result.imported}; skipped ${result.skipped}; failed ${result.failed}.`,
    );
    return result.failed ? 1 : 0;
  } catch (error) {
    options.error(error instanceof Error ? error.message : String(error));
    options.error(importUsage);
    return 2;
  }
}
