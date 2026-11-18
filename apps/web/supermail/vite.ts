import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Alias, PluginOption } from "vite";

/**
 * Shared Vite wiring for the SuiteMail submodule (packages/supermail).
 *
 * When the submodule source and its own node_modules are present, the mail
 * route bundles the real SuiteMail app. Otherwise it falls back to a stub so
 * builds without the submodule still succeed.
 */
const root = resolve(import.meta.dirname, "../../..");
const pkg = resolve(root, "packages/supermail");
const src = resolve(pkg, "src");
const modules = resolve(pkg, "node_modules");
const here = import.meta.dirname;
const slash = (p: string) => p.replace(/\\/g, "/");

export const hasSupermail =
  existsSync(resolve(src, "App.tsx")) &&
  existsSync(resolve(modules, "@tanstack/react-router"));

if (process.env.VITE_SUITELEAF_SERVER === "1" && !hasSupermail) {
  throw new Error(
    "Server builds require packages/supermail source and dependencies.",
  );
}

const routerIndex = slash(resolve(src, "router/index.ts"));
const routerOverride = slash(resolve(here, "router.ts"));

export function supermailAliases(stub: string): Alias[] {
  if (!hasSupermail) return [{ find: "@supermail/App", replacement: stub }];
  return [
    // Embedded entry: provides SuiteMail's router context and styles.
    {
      find: /^@supermail\/App$/,
      replacement: resolve(here, "SuperMailEmbedded.tsx"),
    },
    { find: /^@supermail\//, replacement: `${slash(src)}/` },
    { find: /^@\//, replacement: `${slash(src)}/` },
    {
      find: /^@tanstack\/react-router$/,
      replacement: resolve(modules, "@tanstack/react-router"),
    },
    {
      find: "@automerge/automerge",
      replacement: resolve(
        modules,
        "@automerge/automerge/dist/mjs/entrypoints/fullfat_base64.js",
      ),
    },
    {
      find: /^lucide-react$/,
      replacement: resolve(
        modules,
        "lucide-react/dist/esm/lucide-react.js",
      ),
    },
  ];
}

/**
 * SuiteMail's router uses hash history, which would fight SuiteLeaf's own
 * hash router. Redirect every import of its router module to a memory-history
 * router so both apps keep their own location.
 */
function routerRedirect(): PluginOption {
  return {
    name: "suiteleaf-supermail-router",
    enforce: "pre",
    transform(code, id) {
      if (slash(id) !== slash(resolve(src, "styles/globals.css"))) return null;
      // Include both apps' source, without scanning generated bundles on rebuild.
      return code.replace(
        '@import "tailwindcss";',
        '@import "tailwindcss" source("../");\n@source "../../../../apps/web/src";',
      );
    },
    async resolveId(source, importer, options) {
      if (!importer || !slash(importer).startsWith(slash(src))) return null;
      if (!/router(\/index)?(\.ts)?$|^\.\/index$/.test(source)) return null;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      return resolved && slash(resolved.id) === routerIndex
        ? routerOverride
        : null;
    },
  };
}

export async function supermailPlugins(): Promise<PluginOption[]> {
  if (!hasSupermail) return [];
  const tailwindEntry = resolve(modules, "@tailwindcss/vite/dist/index.mjs");
  const plugins: PluginOption[] = [routerRedirect()];
  if (existsSync(tailwindEntry)) {
    const tailwind = (await import(pathToFileURL(tailwindEntry).href)).default;
    plugins.push(tailwind());
  }
  return plugins;
}
