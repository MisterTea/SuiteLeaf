/**
 * Microsoft Word, Excel, and PowerPoint as reference applications, driven
 * through AppleScript on macOS. Each export is opened read-only from a folder
 * the Office apps may read (they are sandboxed, so the folder needs a one-time
 * Grant Access), measured, and closed without saving.
 *
 * - Word: page count, and its plain-text export, which includes each page's
 *   header and footer, footnotes, and list numbers as Word shows them.
 * - Excel: every sheet's values after a full recalculation, so formula
 *   results are Excel's own, not the cached results SuiteLeaf wrote.
 * - PowerPoint: slide count, text in text boxes, speaker notes, and how many
 *   tables and pictures each slide has. PowerPoint's AppleScript cannot read
 *   table cells, so table text is not measured.
 */
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultExec, type Exec } from "./libreoffice";
import type { CompatFormat, ReferenceResult, View } from "./types";

export const OFFICE_APPS: Record<CompatFormat, string> = {
  docx: "Microsoft Word",
  xlsx: "Microsoft Excel",
  pptx: "Microsoft PowerPoint",
};

export interface MsOfficeOptions {
  /** A folder the Office apps have been granted access to. */
  dir: string;
  exec?: Exec;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
}

const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const posix = (path: string) => `(POSIX file ${quote(path)} as text)`;

/**
 * Word's view without writing any file: page count, body text, each section's
 * header and footer, footnotes, and each list paragraph's number as Word shows
 * it. Writing a file would need another sandbox grant.
 */
export function wordScript(input: string): string {
  return `set LF to (ASCII character 10)
set TB to (ASCII character 9)
tell application "Microsoft Word"
  open file name ${posix(input)} with read only
  repeat 100 times
    if (count of documents) > 0 then exit repeat
    delay 0.2
  end repeat
  set theDoc to active document
  try
    set acc to "### pages " & (compute statistics theDoc statistic statistic pages) & LF
    set acc to acc & "### body" & LF & (content of text object of theDoc) & LF
    repeat with i from 1 to (count of sections of theDoc)
      set sec to section i of theDoc
      set acc to acc & "### header " & (content of text object of (get header sec index header footer primary)) & LF
      set acc to acc & "### footer " & (content of text object of (get footer sec index header footer primary)) & LF
    end repeat
    repeat with i from 1 to (count of footnotes of theDoc)
      set acc to acc & "### footnote " & (content of text object of footnote i of theDoc) & LF
    end repeat
    set markNames to {}
    repeat with i from 1 to (count of bookmarks of theDoc)
      set end of markNames to (name of bookmark i of theDoc)
    end repeat
    repeat with i from 1 to (count of hyperlink objects of theDoc)
      set linkRef to hyperlink object i of theDoc
      set targetName to sub address of linkRef
      if targetName is not missing value and targetName is not "" then
        if markNames contains targetName then set acc to acc & "### link " & (text to display of linkRef) & LF
      end if
    end repeat
    repeat with i from 1 to (count of paragraphs of theDoc)
      set para to paragraph i of theDoc
      set label to list string of list format of text object of para
      if label is not missing value and label is not "" then set acc to acc & "### item " & label & TB & (content of text object of para) & LF
    end repeat
  on error errText
    close active document saving no
    error errText
  end try
  close active document saving no
  return acc
end tell`;
}

/** Word's output: `### pages`, `### body` then its text, and one line per header, footer, footnote, and list item. */
export function wordView(output: string): View {
  const clean = (value: string) => value.replace(/[\r\u0007]+/g, " ").trim();
  const headers: string[] = [];
  const footnotes: string[] = [];
  const numbered: string[] = [];
  const internalLinks: string[] = [];
  const body: string[] = [];
  let pages: number | undefined;
  let inBody = false;
  for (const line of output.split("\n")) {
    if (line.startsWith("### pages ")) pages = Number(line.slice(10)) || undefined;
    else if (line === "### body") inBody = true;
    else if (line.startsWith("### header ") || line.startsWith("### footer ")) {
      inBody = false;
      const text = clean(line.slice(11));
      if (text) headers.push(text);
    } else if (line.startsWith("### footnote ")) footnotes.push(clean(line.slice(13)));
    else if (line.startsWith("### link ")) internalLinks.push(clean(line.slice(9)));
    else if (line.startsWith("### item ")) {
      const [label, text] = line.slice(9).split("\t");
      numbered.push(`${clean(label ?? "").replace(/[.)]$/, "")} ${clean(text ?? "")}`);
    } else if (inBody) body.push(line);
  }
  const text = body.join("\n").replace(/\r/g, "\n");
  return { pages, text, headers, footnotes, internalLinks, cells: [text], numbered: numbered.join("\n") };
}

export function excelScript(input: string): string {
  return `set TB to (ASCII character 9)
set LF to (ASCII character 10)
tell application "Microsoft Excel"
  open workbook workbook file name ${posix(input)} read only true
  set wb to active workbook
  set acc to ""
  try
    calculate full
    repeat with i from 1 to (count of worksheets of wb)
      set ws to worksheet i of wb
      set used to used range of ws
      set acc to acc & "### " & (name of ws) & TB & (first row index of used) & TB & (first column index of used) & LF
      set vals to value of used
      if class of vals is not list then set vals to {{vals}}
      repeat with r in vals
        set line_ to ""
        repeat with c in r
          set line_ to line_ & (c as text) & TB
        end repeat
        set acc to acc & line_ & LF
      end repeat
    end repeat
  on error errText
    close wb saving no
    error errText
  end try
  close wb saving no
  return acc
end tell`;
}

export function powerPointScript(input: string): string {
  return `set LF to (ASCII character 10)
tell application "Microsoft PowerPoint"
  open (POSIX file ${quote(input)})
  set p to active presentation
  set acc to "### slides " & (count of slides of p) & LF
  try
    repeat with i from 1 to (count of slides of p)
      set s to slide i of p
      repeat with j from 1 to (count of shapes of s)
        set sh to shape j of s
        set acc to acc & "### shape " & (shape type of sh as text) & LF
        if has text frame of sh then set acc to acc & (content of text range of text frame of sh) & LF
      end repeat
      set np to notes page of s
      repeat with j from 1 to (count of shapes of np)
        set sh to shape j of np
        if has text frame of sh then set acc to acc & "### note " & (content of text range of text frame of sh) & LF
      end repeat
    end repeat
  on error errText
    close p saving no
    error errText
  end try
  close p saving no
  return acc
end tell`;
}

function columnName(index: number): string {
  let name = "";
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Excel's values: a `### sheet<TAB>row<TAB>column` line, then one tab-separated line per row. */
export function excelView(output: string): View {
  const texts: string[] = [];
  const formulas: NonNullable<View["formulas"]> = {};
  let sheet = "";
  let row = 1;
  let column = 1;
  for (const line of output.split(/\r?\n|\r/)) {
    const head = /^### (.*)\t(\d+)\t(\d+)$/.exec(line);
    if (head) {
      [sheet, row, column] = [head[1]!, Number(head[2]), Number(head[3])];
      continue;
    }
    if (!sheet || line === "") continue;
    line.replace(/\t$/, "").split("\t").forEach((value, offset) => {
      if (value === "") return;
      const number = Number(value);
      if (Number.isFinite(number)) formulas[`${sheet}!${columnName(column + offset)}${row}`] = { value: number };
      else texts.push(value);
    });
    row += 1;
  }
  return { text: texts.join("\n"), formulas };
}

/** PowerPoint's slides, text, notes, and shape types. */
export function powerPointView(output: string): View {
  const texts: string[] = [];
  const notes: string[] = [];
  let pages: number | undefined;
  let tables = 0;
  let pictures = 0;
  for (const line of output.split(/\r?\n|\r/)) {
    const slides = /^### slides (\d+)$/.exec(line);
    if (slides) pages = Number(slides[1]);
    else if (line.startsWith("### shape ")) {
      if (/table/i.test(line)) tables += 1;
      if (/picture/i.test(line)) pictures += 1;
    } else if (line.startsWith("### note ")) notes.push(line.slice(9));
    else if (line) texts.push(line);
  }
  void pictures;
  return { text: texts.join("\n"), notes: notes.join("\n"), tables, pages };
}

/** The installed app's version, or `null` when it cannot be reached. */
export async function msOfficeVersion(format: CompatFormat, options: Pick<MsOfficeOptions, "exec" | "platform"> = {}): Promise<string | null> {
  if ((options.platform ?? process.platform) !== "darwin") return null;
  try {
    const { stdout } = await (options.exec ?? defaultExec)("osascript", ["-e", `tell application "${OFFICE_APPS[format]}" to get version`], 60_000);
    const version = stdout.trim();
    return version ? `${OFFICE_APPS[format]} ${version}` : null;
  } catch {
    return null;
  }
}

/** Reopen an exported file in the matching Microsoft Office app. */
export async function msOfficeReference(bytes: Uint8Array, format: CompatFormat, options: MsOfficeOptions): Promise<ReferenceResult> {
  const exec = options.exec ?? defaultExec;
  const application = await msOfficeVersion(format, options);
  if (!application) return { status: "unavailable", detail: `${OFFICE_APPS[format]} could not be reached.` };
  // One fixed name per format, so the Office sandbox asks once for each file
  // (or never, once the folder itself is granted). Runs are one at a time.
  const input = join(options.dir, `reference.${format}`);
  const script = join(tmpdir(), `suiteleaf-office-${randomUUID()}.applescript`);
  try {
    await writeFile(input, bytes);
    await writeFile(script, format === "docx" ? wordScript(input) : format === "xlsx" ? excelScript(input) : powerPointScript(input));
    const { stdout } = await exec("osascript", [script], options.timeoutMs ?? 180_000);
    const view = format === "docx" ? wordView(stdout) : format === "xlsx" ? excelView(stdout) : powerPointView(stdout);
    return { status: "opened", application, view };
  } catch (error) {
    const killed = (error as { killed?: boolean }).killed || (error as { signal?: string }).signal === "SIGTERM";
    return {
      status: killed ? "timed-out" : "failed",
      application,
      detail: error instanceof Error ? error.message.split("\n")[0] : String(error),
    };
  } finally {
    await rm(script, { force: true });
  }
}
