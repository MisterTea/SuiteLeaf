import { describe, expect, it } from "vitest";
import {
  capabilityCatalog,
  checkCatalog,
  checkParsedCatalog,
  coverageExcludesRequired,
  releaseReport,
  WORK_PACKAGE_IDS,
} from "../../packages/core/src/capabilities/catalog";
import type { CapabilityCatalog } from "../../packages/core/src/capabilities/schema";

function sample(): CapabilityCatalog {
  return structuredClone(capabilityCatalog);
}

describe("capability catalog", () => {
  it("accepts the shipped catalog and separates inconclusive evidence from passes", () => {
    expect(checkCatalog(capabilityCatalog)).toEqual([]);
    const report = releaseReport(capabilityCatalog);
    expect(report.pass).toBe(6);
    expect(report.fail).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report["unavailable-reference"]).toBe(0);
    expect(report.inconclusive).toBeGreaterThan(0);
    expect(report.total).toBe(report.inconclusive + report.pass);
    expect(WORK_PACKAGE_IDS).toHaveLength(38);
    expect(WORK_PACKAGE_IDS[0]).toBe("WP-001");
    expect(WORK_PACKAGE_IDS[37]).toBe("WP-038");
    const charts = capabilityCatalog.capabilities.find((item) => item.id === "cap-charts");
    expect(charts?.summary).toContain("combo");
    expect(charts?.summary).toContain("waterfall");
    expect(charts?.summary).toContain("histogram");
    expect(charts?.limits.join(" ")).toBe("Radar charts are absent.");
    expect(charts?.status).toBe("implemented");
    const offline = capabilityCatalog.workflows.find((item) => item.id === "flow-offline-trip");
    expect(offline?.evidence.result).toBe("inconclusive");
    expect(offline?.evidence.note).toContain("recovery draft");
    expect(offline?.evidence.note).toContain("not a pass");
    const departure = capabilityCatalog.workflows.find((item) => item.id === "flow-employee-departure");
    expect(departure?.evidence.result).toBe("inconclusive");
    expect(departure?.evidence.note).toContain("Removing the account can give their files");
    expect(departure?.evidence.note).toContain("This is not a pass");
    const disaster = capabilityCatalog.workflows.find((item) => item.id === "flow-disaster-recovery");
    expect(disaster?.evidence.result).toBe("inconclusive");
    expect(disaster?.evidence.note).not.toContain("absent");
    expect(disaster?.evidence.note).toContain("does not start a node");
    const backup = capabilityCatalog.capabilities.find((item) => item.id === "cap-independent-backup");
    expect(backup?.status).toBe("partial");
    expect(backup?.evidence.every((item) => item.result !== "pass" || backup.status !== "verified")).toBe(true);
  });

  it("rejects a catalog that fails the schema", () => {
    const issues = checkCatalog({ id: "other" });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.path).toBe("id");
    const root = checkCatalog(null);
    expect(root.some((item) => item.path === "catalog")).toBe(true);
  });

  it("rejects duplicate ids, advertised gaps, and absent features sold as present", () => {
    const catalog = sample();
    catalog.capabilities[1] = { ...catalog.capabilities[1]!, id: catalog.capabilities[0]!.id };
    catalog.advertisedIds.push("cap-missing");
    const absent = catalog.capabilities.find((item) => item.id === "cap-independent-backup")!;
    absent.status = "absent";
    catalog.advertisedIds.push(absent.id);
    const bare = catalog.capabilities.find((item) => item.id === "cap-managed-updates")!;
    bare.status = "implemented";
    bare.limits = [];
    const issues = checkParsedCatalog(catalog);
    expect(issues.map((item) => item.message)).toEqual(
      expect.arrayContaining([
        "duplicate capability id",
        "cap-missing is not in the catalog",
        "an advertised capability cannot be absent",
        "implemented claims need an explicit limit",
      ]),
    );
  });

  it("requires a recorded pass before a capability is verified", () => {
    const catalog = sample();
    const first = catalog.capabilities[0]!;
    first.status = "verified";
    expect(checkParsedCatalog(catalog).some((item) => item.message.includes("verified"))).toBe(true);
    first.evidence = [
      { kind: "unit", ref: "tests/capabilities/catalog.test.ts", result: "pass", note: "schema check passed" },
    ];
    expect(checkParsedCatalog(catalog).some((item) => item.path === first.id && item.message.includes("verified"))).toBe(
      false,
    );
  });

  it("rejects a passing result on an absent capability and an unknown package", () => {
    const catalog = sample();
    const backup = catalog.capabilities.find((item) => item.id === "cap-independent-backup")!;
    backup.status = "absent";
    backup.evidence = [{ kind: "rust", ref: "crates/suitedb", result: "pass", note: "not actually restored" }];
    backup.workPackages = ["WP-999"];
    const messages = checkParsedCatalog(catalog).map((item) => item.message);
    expect(messages).toContain("absent cannot record a passing result");
    expect(messages).toContain("WP-999 is not a portfolio package");
  });

  it("rejects a present capability with no evidence and a documentation-only workflow pass", () => {
    const catalog = sample();
    catalog.capabilities[0]!.evidence = [];
    catalog.capabilities[0]!.status = "partial";
    catalog.workflows[0]!.capabilityIds.push("cap-not-real");
    catalog.workflows[0]!.evidence = {
      kind: "documentation",
      ref: "README.md",
      result: "pass",
      note: "claimed from prose",
    };
    catalog.gates[0]!.workPackages.push("WP-099");
    catalog.gates.push({ ...catalog.gates[0]!, id: "gate-phase-1" });
    catalog.coverage.policy += " exclude packages/core/src/capabilities";
    const messages = checkParsedCatalog(catalog).map((item) => item.message);
    expect(messages).toContain("a present capability needs an evidence record");
    expect(messages).toContain("cap-not-real is not in the catalog");
    expect(messages).toContain("documentation alone cannot pass a workflow");
    expect(messages).toContain("WP-099 is not a portfolio package");
    expect(messages).toContain("duplicate phase gate");
    expect(messages).toContain("policy must not exclude packages/core/src/capabilities");
  });

  it("flags coverage excludes that drop the capability modules", () => {
    expect(coverageExcludesRequired(["packages/core/src/capabilities/**"], capabilityCatalog)).toEqual([
      "packages/core/src/capabilities",
    ]);
    expect(coverageExcludesRequired(["tests/**"], capabilityCatalog)).toEqual([]);
  });

  it("counts each result class, including a failure beside inconclusive rows", () => {
    const catalog = sample();
    catalog.baseline.push({
      name: "docs",
      command: "npm test -- tests/doc-proofing.test.ts",
      result: "fail",
      detail: "1 failed",
    });
    catalog.baseline.push({
      name: "sheets",
      command: "npm test -- tests/sheet-links.test.ts",
      result: "skipped",
      detail: "skipped",
    });
    const report = releaseReport(catalog);
    expect(report.fail).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.pass).toBe(6);
    expect(report.inconclusive).toBeGreaterThan(0);
    expect(report.total).toBe(
      report.inconclusive + report.pass + report.fail + report.skipped + report["unavailable-reference"],
    );
  });
});
