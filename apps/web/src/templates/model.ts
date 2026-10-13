import { duplicateFile, type SuiteFile } from "@suiteleaf/core";
import { builtins } from "./builtin";
import { templateStore, type TemplateRow } from "./store";

export type TemplateSource = "builtin" | "yours";

export interface TemplateInfo {
  id: string;
  name: string;
  kind: SuiteFile["kind"];
  source: TemplateSource;
  description: string;
}

export interface TemplateEntry {
  info: TemplateInfo;
  file: SuiteFile;
}

const MONTH =
  "January|February|March|April|May|June|July|August|September|October|November|December";

/** Drop a trailing month so "Invoice · Café Lune · October" suggests a reusable name. */
export function suggestTemplateName(title: string): string {
  const trimmed = title.trim().replace(new RegExp(`\\s+·\\s+(?:${MONTH})(?:\\s+\\d{4})?$`), "");
  return (trimmed || title).trim().slice(0, 200);
}

function fromBuiltin(template: (typeof builtins)[number]): TemplateEntry {
  return {
    info: {
      id: template.id,
      name: template.name,
      kind: template.kind,
      source: "builtin",
      description: template.description,
    },
    file: template.create(),
  };
}

function fromRow(row: TemplateRow): TemplateEntry {
  const file = JSON.parse(row.native) as SuiteFile;
  return {
    info: {
      id: row.id,
      name: row.name,
      kind: row.kind,
      source: "yours",
      description: "A template you saved on this computer.",
    },
    file,
  };
}

export async function loadTemplates(): Promise<TemplateEntry[]> {
  const yours = (await templateStore.list()).map(fromRow);
  return [...yours, ...builtins.map(fromBuiltin)];
}

export function instantiate(entry: TemplateEntry): SuiteFile {
  return duplicateFile(entry.file, entry.info.name);
}

export async function saveAsTemplate(name: string, file: SuiteFile): Promise<TemplateInfo> {
  const row = await templateStore.save(name, file);
  return fromRow(row).info;
}

export const kindLabel: Record<SuiteFile["kind"], string> = {
  doc: "Document",
  sheet: "Spreadsheet",
  slide: "Presentation",
};

export const groupLabel: Record<SuiteFile["kind"], string> = {
  doc: "Documents",
  sheet: "Spreadsheets",
  slide: "Presentations",
};
