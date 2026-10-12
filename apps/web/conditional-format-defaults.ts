import type { Plugin } from "vite";

const target = /@univerjs[\\/]sheets-conditional-formatting-ui[\\/]lib[\\/]es[\\/]index\.js$/;
// Univer's rule style editor starts every rule with blue text on a lavender
// fill. Like Sheets, keep the cell's own text colour and start new rules
// with a light green fill; existing rules keep exactly the style they saved.
const replacements: [string, string][] = [
  ['const defaultV = "#2f56ef";', "const defaultV = void 0;"],
  [
    'const defaultV = "#e8ecfc";',
    'const defaultV = style ? void 0 : "#b7e1cd";',
  ],
];

function rewrite(code: string, id: string) {
  for (const [from, to] of replacements) {
    if (!code.includes(from))
      throw new Error(`${id} no longer contains ${from}; update ${import.meta.url}`);
    code = code.replace(from, to);
  }
  return code;
}

export function conditionalFormatDefaults(): Plugin {
  return {
    name: "suiteleaf-conditional-format-defaults",
    enforce: "pre",
    config: () => ({
      optimizeDeps: {
        esbuildOptions: {
          plugins: [
            {
              name: "suiteleaf-conditional-format-defaults",
              setup(build) {
                build.onLoad({ filter: target }, async ({ path }) => {
                  const { readFile } = await import("node:fs/promises");
                  return {
                    contents: rewrite(await readFile(path, "utf8"), path),
                    loader: "js",
                  };
                });
              },
            },
          ],
        },
      },
    }),
    transform(code, id) {
      if (target.test(id.split("?")[0])) return rewrite(code, id);
    },
  };
}
