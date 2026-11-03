/**
 * A short list of package versions for a release notice.
 * This is not a signature, and it does not include model files.
 */

export type DependencyNotice = {
  name: string;
  version: string;
  dependencies: { name: string; version: string }[];
  omitted: number;
  note: string;
};

function publishedVersion(version: string | undefined): string | null {
  const match = version?.trim().match(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match?.[0] ?? null;
}

function listedPackage(name: string): boolean {
  const text = name.trim();
  if (!text || text.endsWith(".gguf")) return false;
  return true;
}

/** Package names and published versions. A version that is not a release number is counted and left out. */
export function dependencyNotice(pkg: {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): DependencyNotice {
  const versions = { ...pkg.dependencies, ...pkg.devDependencies };
  const dependencies: { name: string; version: string }[] = [];
  let omitted = 0;
  for (const [name, version] of Object.entries(versions)) {
    if (!listedPackage(name)) {
      omitted += 1;
      continue;
    }
    const published = publishedVersion(version);
    if (!published) {
      omitted += 1;
      continue;
    }
    dependencies.push({ name: name.trim(), version: published });
  }
  dependencies.sort((left, right) => left.name.localeCompare(right.name));
  return {
    name: pkg.name?.trim() || "SuiteLeaf",
    version: publishedVersion(pkg.version) || "0.0.0",
    dependencies,
    omitted,
    note: "This notice lists package versions. It is not a signature, and model files are not included.",
  };
}
