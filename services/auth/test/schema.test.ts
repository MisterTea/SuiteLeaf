import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { authOptions } from "../src/options";
import { AUTH_SCHEMA_VERSION, suitedbTables } from "../src/schema";

it("schema.json matches the better-auth configuration", () => {
  const checkedIn = JSON.parse(
    readFileSync(new URL("../schema.json", import.meta.url), "utf8"),
  );
  const options = authOptions(
    { baseURL: "http://localhost", secret: "x".repeat(32), trustedOrigins: [] },
    undefined,
  );
  expect(
    checkedIn,
    "Run `npm run generate-schema -w @suiteleaf/auth` and bump AUTH_SCHEMA_VERSION if tables changed.",
  ).toEqual({ version: AUTH_SCHEMA_VERSION, tables: suitedbTables(options) });
});
