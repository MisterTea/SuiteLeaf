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
// The node binary ships in desktop packages and container images, so its
// crates (excluding dev-only dependencies) are listed too.
const crates = [];
try {
  const { execFileSync } = await import("node:child_process");
  const { dirname } = await import("node:path");
  const meta = JSON.parse(
    execFileSync("cargo", ["metadata", "--format-version", "1", "--locked"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    }),
  );
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const root = meta.packages.find((p) => p.name === "suiteleaf-node").id;
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const dep of nodes.get(id).deps)
      if (dep.dep_kinds.some((k) => k.kind !== "dev")) visit(dep.pkg);
  };
  visit(root);
  for (const id of seen) {
    const pkg = byId.get(id);
    if (meta.workspace_members.includes(id)) continue;
    let text = "";
    for (const file of ["LICENSE", "LICENSE-MIT", "LICENSE-APACHE", "LICENSE.md", "LICENSE.txt", "COPYING"]) {
      try {
        text = await readFile(`${dirname(pkg.manifest_path)}/${file}`, "utf8");
        break;
      } catch {}
    }
    crates.push(
      `## ${pkg.name} ${pkg.version} (Rust crate)\n\nLicense: ${pkg.license ?? "See crate source"}\n\n${text || "License text is available in the crate source."}`,
    );
  }
} catch (error) {
  console.warn(`Skipping Rust crate notices: ${error.message}`);
}
const output = `# Third-party notices\n\nSuiteLeaf source is licensed under Apache-2.0. These notices cover production npm dependencies and the Rust crates compiled into suiteleaf-node. Development and packaging tools retain their own licenses.\n\n${[...sections.sort(), ...crates.sort()].join("\n\n---\n\n")}\n`;
await writeFile("THIRD_PARTY_NOTICES.md", output);
await mkdir("apps/web/public", { recursive: true });
await writeFile("apps/web/public/THIRD_PARTY_NOTICES.txt", output);
await mkdir("apps/desktop/resources", { recursive: true });
await writeFile("apps/desktop/resources/THIRD_PARTY_NOTICES.txt", output);
console.log(
  `Generated notices for ${sections.length} npm packages and ${crates.length} Rust crates.`,
);
