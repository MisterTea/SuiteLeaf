import Dexie, { type Table } from "dexie";
import { parseFile, serializeFile, type SuiteFile } from "@suiteleaf/core";

export interface TemplateRow {
  id: string;
  name: string;
  kind: SuiteFile["kind"];
  updatedAt: string;
  native: string;
}

/** User templates live beside the file library, so removing one cannot delete a file. */
export class TemplateStore extends Dexie {
  templates!: Table<TemplateRow, string>;
  constructor(name = "SuiteLeafTemplates") {
    super(name);
    this.version(1).stores({ templates: "id, kind, updatedAt" });
  }
  async save(name: string, file: SuiteFile): Promise<TemplateRow> {
    const snapshot = parseFile(serializeFile(file));
    const title = name.trim().slice(0, 200);
    snapshot.title = title || snapshot.title;
    const row: TemplateRow = {
      id: crypto.randomUUID(),
      name: snapshot.title,
      kind: snapshot.kind,
      updatedAt: new Date().toISOString(),
      native: serializeFile(snapshot),
    };
    await this.templates.put(row);
    return row;
  }
  async rename(id: string, name: string): Promise<void> {
    const row = await this.templates.get(id);
    if (!row) return;
    const file = parseFile(row.native);
    file.title = name.trim().slice(0, 200) || file.title;
    await this.templates.put({
      ...row,
      name: file.title,
      updatedAt: new Date().toISOString(),
      native: serializeFile(file),
    });
  }
  async remove(id: string) {
    await this.templates.delete(id);
  }
  async list(): Promise<TemplateRow[]> {
    return this.templates.orderBy("updatedAt").reverse().toArray();
  }
}

export const templateStore = new TemplateStore();
