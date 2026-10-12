import { getAuthTables } from "better-auth/db";
import type { BetterAuthOptions } from "better-auth";

/** Bump when the generated tables change; nodes hold back ops written with a
 * newer schema until they are upgraded. */
export const AUTH_SCHEMA_VERSION = 1;

interface ColumnDef {
  name: string;
  type: "text" | "integer" | "real";
}
export interface TableDef {
  name: string;
  pk: string;
  columns: ColumnDef[];
  unique: string[];
  indexes: string[];
}

const columnType = (type: unknown): ColumnDef["type"] =>
  type === "boolean" ? "integer" : type === "number" ? "real" : "text";

/** Translate better-auth's tables into SuiteDB table definitions. Dates,
 * JSON, and arrays are stored as text, matching the adapter's settings. */
export function suitedbTables(options: BetterAuthOptions): TableDef[] {
  const tables = getAuthTables(options);
  return Object.values(tables)
    .map((table) => {
      const columns: ColumnDef[] = [];
      const unique: string[] = [];
      const indexes: string[] = [];
      for (const [key, field] of Object.entries(table.fields)) {
        const name = field.fieldName ?? key;
        if (name === "id") continue;
        columns.push({ name, type: columnType(field.type) });
        if (field.unique) unique.push(name);
        else if (field.index || field.references) indexes.push(name);
      }
      return { name: table.modelName, pk: "id", columns, unique, indexes };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
