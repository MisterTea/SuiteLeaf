import { writeFileSync } from "node:fs";
import { authOptions } from "../src/options";
import { AUTH_SCHEMA_VERSION, suitedbTables } from "../src/schema";

const options = authOptions(
  { baseURL: "http://localhost", secret: "x".repeat(32), trustedOrigins: [] },
  undefined,
);
const schema = { version: AUTH_SCHEMA_VERSION, tables: suitedbTables(options) };
writeFileSync(
  new URL("../schema.json", import.meta.url),
  `${JSON.stringify(schema, null, 2)}\n`,
);
console.log(
  `Wrote ${schema.tables.length} tables to services/auth/schema.json`,
);
