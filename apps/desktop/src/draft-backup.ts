import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  isNativeName,
  nativeFilename,
  parseNamedFile,
  serializeFile,
  type FileRecord,
} from "@suiteleaf/core";

function draftName(record: FileRecord, used: Set<string>): string {
  const raw = nativeFilename(record.file);
  const safe = raw.includes("..") ? "draft.sldoc" : raw;
  let name = safe;
  let n = 2;
  const dot = safe.lastIndexOf(".");
  while (used.has(name)) {
    name = `${safe.slice(0, dot)} (${n})${safe.slice(dot)}`;
    n += 1;
  }
  used.add(name);
  return name;
}

/** Write recovery drafts only. A saved file and a SuiteDrive link stay out. */
export async function writeDraftBackup(records: readonly FileRecord[], folder: string, load: (record: FileRecord) => FileRecord = (record) => record): Promise<number> {
  const drafts = records.filter((record) => record.recovery);
  await mkdir(folder, { recursive: true });
  const used = new Set<string>();
  for (const record of drafts) {
    const name = draftName(record, used);
    await writeFile(join(folder, name), serializeFile(load(record).file), "utf8");
  }
  return drafts.length;
}

/** Read those drafts back as recovery copies, with no disk path and no SuiteDrive link. */
export async function readDraftBackup(folder: string): Promise<FileRecord[]> {
  const names = (await readdir(folder)).filter((name) => isNativeName(name));
  const records: FileRecord[] = [];
  for (const name of names) {
    const text = await readFile(join(folder, name), "utf8");
    let file;
    try {
      file = parseNamedFile(name, text);
    } catch {
      throw new Error("That draft backup cannot be read.");
    }
    records.push({ file, recovery: true });
  }
  return records;
}
