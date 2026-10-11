import { readFile, writeFile, mkdir } from "node:fs/promises";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const sections = [];
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (!path.includes("node_modules/") || pkg.dev || pkg.link) continue;
  const name = path.slice(path.lastIndexOf("node_modules/") + 13);
  let license = pkg.license ?? "See package source";
  if (name === "dompurify") license = "Apache-2.0 (selected from dual license)";
  const candidates = [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "license",
    "license.md",
    "LICENCE",
    "COPYING",
  ];
  let text = "";
  for (const file of candidates) {
    try {
      text = (await readFile(`${path}/${file}`, "utf8")).replace(/\r\n/g, "\n");
      break;
    } catch {}
  }
  sections.push(
    `## ${name} ${pkg.version}\n\nLicense: ${license}\n\n${text || "License text is available in the installed npm package."}`,
  );
}
const output = `# Third-party notices\n\nSuiteLeaf source is licensed under Apache-2.0. These notices cover production npm dependencies. Development and packaging tools retain their own licenses.\n\n${sections.sort().join("\n\n---\n\n")}\n`;
await writeFile("THIRD_PARTY_NOTICES.md", output);
await mkdir("apps/web/public", { recursive: true });
await writeFile("apps/web/public/THIRD_PARTY_NOTICES.txt", output);
await mkdir("apps/desktop/resources", { recursive: true });
await writeFile("apps/desktop/resources/THIRD_PARTY_NOTICES.txt", output);
console.log(
  `Generated notices for ${sections.length} production dependencies.`,
);
