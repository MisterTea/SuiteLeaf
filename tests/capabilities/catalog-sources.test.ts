import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { capabilityCatalog } from "../../packages/core/src/capabilities/catalog";

/**
 * The catalog has to agree with what the README advertises, with the work
 * packages that have recorded progress, and with the coverage gate. These
 * checks read those files, so a README bullet or a started package that the
 * catalog does not know about fails here.
 */

const root = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

/** Each README "What works" bullet and the advertised capabilities that back it. */
const README_CLAIMS: Record<string, string[]> = {
  Files: ["cap-files-library"],
  "Office import": ["cap-office-import"],
  Docs: ["cap-docs-editing", "cap-docs-page-setup", "cap-docs-docx-export"],
  Sheets: ["cap-sheets-grid", "cap-sheets-xlsx-export"],
  Charts: ["cap-charts"],
  Pivots: ["cap-pivots"],
  Slides: ["cap-slides-authoring", "cap-slides-show"],
  "Accounts (cluster mode)": ["cap-accounts"],
  "SuiteDrive (cluster mode)": ["cap-suitedrive", "cap-sharing"],
  "PowerPoint import": ["cap-pptx-import"],
};

/** README sentences outside the bullets that make a capability claim. */
const README_SENTENCES: [string, string][] = [
  ["edited by several people at once", "cap-doc-collaboration"],
  ["Native SuiteLeaf files are JSON", "cap-native-files"],
  ["autosaves locally in the browser", "cap-local-autosave"],
  ["Electron starts new files as recovery drafts", "cap-desktop-recovery"],
  ["Settings → Document directory", "cap-directory-import"],
  ["Delimited imports preview", "cap-delimited"],
  ["File → Print / Save as PDF", "cap-print-pdf"],
];

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n## ${heading}\n`);
  if (start < 0) return "";
  const rest = markdown.slice(start + heading.length + 5);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
}

function readmeBullets(markdown: string): string[] {
  return [...section(markdown, "What works").matchAll(/^- \*\*([^*]+?):\*\*/gm)].map((m) => m[1]!);
}

function frontMatter(text: string, key: string): string | undefined {
  const head = text.split("\n---\n")[0] ?? "";
  return head.match(new RegExp(`^${key}: "?([^"\\n]*)"?$`, "m"))?.[1];
}

const byId = new Map(capabilityCatalog.capabilities.map((row) => [row.id, row]));
const advertised = new Set(capabilityCatalog.advertisedIds);

describe("catalog sources", () => {
  const readme = read("README.md");

  it("maps every README bullet to advertised capabilities that are present", () => {
    const bullets = readmeBullets(readme);
    expect(bullets.length).toBeGreaterThan(5);
    for (const bullet of bullets) {
      const ids = README_CLAIMS[bullet];
      expect(ids, `README bullet "${bullet}" has no catalog mapping`).toBeDefined();
      for (const id of ids!) {
        expect(advertised.has(id), `${id} is not advertised`).toBe(true);
        expect(byId.get(id)?.status, `${id} is absent`).not.toBe("absent");
      }
    }
    for (const label of Object.keys(README_CLAIMS)) expect(bullets).toContain(label);
  });

  it("maps README claim sentences to advertised capabilities", () => {
    for (const [sentence, id] of README_SENTENCES) {
      expect(readme, `README no longer says "${sentence}"`).toContain(sentence);
      expect(advertised.has(id), `${id} backs "${sentence}" and is not advertised`).toBe(true);
    }
  });

  it("finds README bullets only under What works", () => {
    expect(readmeBullets("## Other\n- **Files:** x\n")).toEqual([]);
    expect(readmeBullets("intro\n## What works\n\n- **Files:** a\n- **Docs:** b\n## Next\n- **Sheets:** c\n")).toEqual([
      "Files",
      "Docs",
    ]);
  });

  it("gives every work package that has started a capability row", () => {
    const dir = join(root, "project_management");
    const files = readdirSync(dir).filter((name) => /^WP-\d{3}-.*\.md$/.test(name));
    expect(files).toHaveLength(38);
    const inRows = new Set(capabilityCatalog.capabilities.flatMap((row) => row.workPackages));
    const missing = files.flatMap((name) => {
      const text = readFileSync(join(dir, name), "utf8");
      const id = frontMatter(text, "id")!;
      const status = frontMatter(text, "status");
      // `ready` and `blocked` packages have no work yet. A started package needs a row.
      const started = status === "in_progress" || status === "in_review" || status === "done";
      return started && !inRows.has(id) ? [`${id} (${status})`] : [];
    });
    expect(missing).toEqual([]);
  });

  it("keeps the whole-suite coverage gate at 90 percent without excluding source", () => {
    const config = read("vitest.config.ts");
    for (const metric of ["lines", "statements"]) {
      const value = Number(config.match(new RegExp(`${metric}:\\s*(\\d+)`))?.[1]);
      expect(value, `${metric} threshold`).toBeGreaterThanOrEqual(90);
    }
    const exclude = config.match(/exclude:\s*\[([^\]]*)\]/)?.[1] ?? "";
    expect(exclude.trim()).toBe('"**/*.d.ts"');
    for (const source of ["apps/web/src", "packages/core/src", "services/*/src"]) {
      expect(config).toContain(source);
    }
  });
});
