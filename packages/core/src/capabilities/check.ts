import { catalogSchema, type CapabilityCatalog, type EvidenceResult } from "./schema";

export const WORK_PACKAGE_IDS = Array.from({ length: 38 }, (_, index) => {
  return `WP-${String(index + 1).padStart(3, "0")}`;
});

export type CatalogIssue = { path: string; message: string };

export type ReleaseReport = Record<EvidenceResult, number> & {
  total: number;
};

const KNOWN_PACKAGES = new Set(WORK_PACKAGE_IDS);

function issue(path: string, message: string): CatalogIssue {
  return { path, message };
}

/** Structural and honesty checks. A verified row needs a recorded pass. */
export function checkCatalog(input: unknown): CatalogIssue[] {
  const parsed = catalogSchema.safeParse(input);
  if (!parsed.success) {
    return parsed.error.issues.map((item) =>
      issue(item.path.join(".") || "catalog", item.message),
    );
  }
  return checkParsedCatalog(parsed.data);
}

export function checkParsedCatalog(catalog: CapabilityCatalog): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const ids = new Set<string>();
  for (const capability of catalog.capabilities) {
    if (ids.has(capability.id)) {
      issues.push(issue(capability.id, "duplicate capability id"));
    }
    ids.add(capability.id);
    issues.push(...checkCapability(capability));
  }
  for (const advertised of catalog.advertisedIds) {
    if (!ids.has(advertised)) {
      issues.push(issue("advertisedIds", `${advertised} is not in the catalog`));
    }
  }
  const advertised = new Set(catalog.advertisedIds);
  for (const capability of catalog.capabilities) {
    if (advertised.has(capability.id) && capability.status === "absent") {
      issues.push(issue(capability.id, "an advertised capability cannot be absent"));
    }
  }
  for (const workflow of catalog.workflows) {
    for (const capabilityId of workflow.capabilityIds) {
      if (!ids.has(capabilityId)) {
        issues.push(issue(workflow.id, `${capabilityId} is not in the catalog`));
      }
    }
    if (workflow.evidence.result === "pass" && workflow.evidence.kind === "documentation") {
      issues.push(issue(workflow.id, "documentation alone cannot pass a workflow"));
    }
  }
  const gatePhases = new Set<number>();
  for (const gate of catalog.gates) {
    if (gatePhases.has(gate.phase)) issues.push(issue(gate.id, "duplicate phase gate"));
    gatePhases.add(gate.phase);
    for (const workPackage of gate.workPackages) {
      if (!KNOWN_PACKAGES.has(workPackage)) {
        issues.push(issue(gate.id, `${workPackage} is not a portfolio package`));
      }
    }
  }
  for (const pattern of catalog.coverage.mustNotExclude) {
    if (catalog.coverage.policy.includes(`exclude ${pattern}`)) {
      issues.push(issue("coverage.policy", `policy must not exclude ${pattern}`));
    }
  }
  return issues;
}

function checkCapability(capability: CapabilityCatalog["capabilities"][number]): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  for (const workPackage of capability.workPackages) {
    if (!KNOWN_PACKAGES.has(workPackage)) {
      issues.push(issue(capability.id, `${workPackage} is not a portfolio package`));
    }
  }
  const passes = capability.evidence.filter((item) => item.result === "pass");
  if (capability.status === "verified" && passes.length === 0) {
    issues.push(issue(capability.id, "verified requires evidence with result pass"));
  }
  if (capability.status === "absent" && passes.length > 0) {
    issues.push(issue(capability.id, "absent cannot record a passing result"));
  }
  if (capability.status !== "absent" && capability.evidence.length === 0) {
    issues.push(issue(capability.id, "a present capability needs an evidence record"));
  }
  if (
    (capability.status === "implemented" || capability.status === "verified") &&
    capability.limits.length === 0
  ) {
    issues.push(issue(capability.id, "implemented claims need an explicit limit"));
  }
  return issues;
}

/** Counts evidence and baseline rows by result class, including zeroes. */
export function releaseReport(catalog: CapabilityCatalog): ReleaseReport {
  const report: ReleaseReport = {
    pass: 0,
    fail: 0,
    skipped: 0,
    "unavailable-reference": 0,
    inconclusive: 0,
    total: 0,
  };
  const rows = [
    ...catalog.capabilities.flatMap((item) => item.evidence),
    ...catalog.workflows.map((item) => item.evidence),
    ...catalog.baseline,
  ];
  for (const row of rows) {
    report[row.result] += 1;
    report.total += 1;
  }
  return report;
}

/** True when a coverage exclude list drops a path this catalog must measure. */
export function coverageExcludesRequired(exclude: string[], catalog: CapabilityCatalog): string[] {
  return catalog.coverage.mustNotExclude.filter((required) =>
    exclude.some((pattern) => pattern.includes(required) || required.includes(pattern)),
  );
}
