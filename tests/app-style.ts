import { readFileSync } from "node:fs";

/** apps/web/src/style.css with its `./styles/` partials inlined in import order. */
export function readAppStyle(): string {
  return readFileSync("apps/web/src/style.css", "utf8").replace(
    /^@import "\.\/(styles\/[\w-]+\.css)";\n/gm,
    (_, path: string) => readFileSync(`apps/web/src/${path}`, "utf8"),
  );
}
