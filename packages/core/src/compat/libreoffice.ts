/**
 * LibreOffice as a reference application. It reopens SuiteLeaf's export in a
 * throwaway profile that blocks macros and link updates and recalculates every
 * Excel formula on load, so values come from LibreOffice and not from the
 * cached results SuiteLeaf wrote.
 *
 * - DOCX: rendered to PDF for the page count, and to plain text.
 * - XLSX: every sheet written as CSV, giving values but not formula text.
 * - PPTX: rendered to PDF for the slide count. Text is not read.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CompatFormat, ReferenceResult, View } from "./types";

export type Exec = (file: string, args: string[], timeoutMs: number) => Promise<{ stdout: string }>;

export const defaultExec: Exec = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        // The tool's own message (osascript, soffice) is on stderr. Keep it ahead of the command line.
        const said = String(stderr ?? "").trim().split("\n")[0];
        if (said) error.message = `${said} (${error.message.split("\n")[0]})`;
        reject(error);
      } else resolve({ stdout: String(stdout) });
    });
  });

/** Profile settings: recalculate OOXML on load, never update links, and use the highest macro security. */
export const PROFILE_XCU = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
</oor:items>
`;

/** Numbered lines of LibreOffice text as `<number> <text>`: `    1. Water` becomes `1 Water`. */
export function numberedLines(text: string): string {
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^\s*([0-9]+|[a-zA-Z]{1,4})[.)]\s+(.*)$/.exec(line);
      return match ? [`${match[1]} ${match[2]!.trim()}`] : [];
    })
    .join("\n");
}

/** Pages in a PDF, counted from its page objects. */
export function pdfPages(pdf: string): number {
  return (pdf.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

/** One CSV line into cells. Quotes may wrap a cell, and two quotes are one quote. */
export function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Sheets written as `<base>-<sheet>.csv` become text and cell values. Formula text is not in a CSV. */
export function csvView(sheets: { name: string; csv: string }[]): View {
  const texts: string[] = [];
  const formulas: NonNullable<View["formulas"]> = {};
  for (const sheet of sheets) {
    sheet.csv.split(/\r?\n/).forEach((line, row) => {
      csvCells(line).forEach((value, col) => {
        if (value === "") return;
        const number = Number(value);
        if (Number.isFinite(number) && value.trim() !== "") {
          formulas[`${sheet.name}!${columnName(col)}${row + 1}`] = { value: number };
        } else texts.push(value);
      });
    });
  }
  return { text: texts.join("\n"), formulas };
}

export interface LibreOfficeOptions {
  binary?: string;
  exec?: Exec;
  timeoutMs?: number;
}

/** The installed version, or `null` when LibreOffice cannot be started. */
export async function libreOfficeVersion(options: LibreOfficeOptions = {}): Promise<string | null> {
  try {
    const { stdout } = await (options.exec ?? defaultExec)(options.binary ?? "soffice", ["--version"], 30_000);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/** Reopen an exported file in LibreOffice. Formula values in the view are LibreOffice's own. */
export async function libreOfficeReference(
  bytes: Uint8Array,
  format: CompatFormat,
  options: LibreOfficeOptions = {},
): Promise<ReferenceResult> {
  const binary = options.binary ?? "soffice";
  const exec = options.exec ?? defaultExec;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const application = await libreOfficeVersion(options);
  if (!application) return { status: "unavailable", detail: "LibreOffice could not be started." };
  const work = await mkdtemp(join(tmpdir(), "suiteleaf-compat-"));
  try {
    const profile = join(work, "profile");
    await mkdir(join(profile, "user"), { recursive: true });
    await writeFile(join(profile, "user", "registrymodifications.xcu"), PROFILE_XCU);
    const input = join(work, `input.${format}`);
    await writeFile(input, bytes);
    const out = join(work, "out");
    const convert = (target: string) =>
      exec(
        binary,
        [`-env:UserInstallation=${pathToFileURL(profile).href}`, "--headless", "--norestore", "--nologo", "--convert-to", target, "--outdir", out, input],
        timeoutMs,
      );
    const view: View = {};
    if (format === "xlsx") {
      await convert("csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1");
      const files = (await readdir(out)).filter((name) => name.endsWith(".csv"));
      const sheets = await Promise.all(
        files.map(async (name) => ({ name: name.replace(/^input-?/, "").replace(/\.csv$/, ""), csv: await readFile(join(out, name), "utf8") })),
      );
      Object.assign(view, csvView(sheets));
    } else {
      await convert("pdf");
      view.pages = pdfPages(await readFile(join(out, "input.pdf"), "latin1"));
      if (format === "docx") {
        await convert("txt:Text (encoded):UTF8");
        view.text = await readFile(join(out, "input.txt"), "utf8");
        view.numbered = numberedLines(view.text);
        view.cells = [view.text];
      }
    }
    return { status: "opened", application, view };
  } catch (error) {
    const killed = (error as { killed?: boolean; signal?: string }).killed || (error as { signal?: string }).signal === "SIGTERM";
    return {
      status: killed ? "timed-out" : "failed",
      application,
      detail: error instanceof Error ? error.message.split("\n")[0] : String(error),
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
