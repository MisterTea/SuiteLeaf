import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function resolved(from: string, id: string) {
  return createRequire(resolve(root, from)).resolve(id);
}

it("shares one React 19 between the app and its dependencies", () => {
  const appReact = resolved("apps/web/package.json", "react/package.json");
  const hoistedReact = resolved("package.json", "react/package.json");
  const appDom = resolved("apps/web/package.json", "react-dom/package.json");
  const hoistedDom = resolved("package.json", "react-dom/package.json");
  expect(appReact).toBe(hoistedReact);
  expect(appDom).toBe(hoistedDom);
  expect(JSON.parse(readFileSync(appReact, "utf8")).version).toMatch(/^19\./);
  expect(JSON.parse(readFileSync(appDom, "utf8")).version).toMatch(/^19\./);
});
