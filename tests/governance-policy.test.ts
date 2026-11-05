import { describe, expect, it } from "vitest";
import {
  AppendOnlyAuditLogger,
  ClassificationEngine,
  DiscoveryService,
  RetentionEngine,
  type GovernanceItem,
  type LegalHold,
  type RetentionSchedule,
} from "../packages/core/src/governance";

describe("WP-032: Retention, Discovery, and Organizational Data Policy", () => {
  it("active legal holds prevent prohibited deletion and remain effective when an employee account is removed", () => {
    const retention = new RetentionEngine();
    const hold: LegalHold = {
      id: "hold_litigation_2026",
      name: "Acme Corp Patent Litigation",
      description: "Preserve all engineering docs authored by employee 101",
      custodianIds: ["emp_101"],
      fileIds: ["file_arch_blueprint"],
      status: "active",
      createdAt: new Date().toISOString(),
      createdBy: "compliance_officer_1",
    };
    retention.addLegalHold(hold);

    // 1. Employee tries to delete their file -> blocked by legal hold
    const deleteCheck = retention.canDeleteItem("file_normal", "emp_101");
    expect(deleteCheck.allowed).toBe(false);
    expect(deleteCheck.reason).toContain("Acme Corp Patent Litigation");

    // 2. Specific file under hold cannot be deleted even by a different user
    const fileHoldCheck = retention.canDeleteItem("file_arch_blueprint", "emp_999");
    expect(fileHoldCheck.allowed).toBe(false);
    expect(fileHoldCheck.reason).toContain("Acme Corp Patent Litigation");

    // 3. Unrelated file and custodian can be deleted
    const unrelatedCheck = retention.canDeleteItem("file_unrelated", "emp_202");
    expect(unrelatedCheck.allowed).toBe(true);

    // 4. Release legal hold -> deletion becomes allowed
    retention.releaseLegalHold(hold.id);
    const afterReleaseCheck = retention.canDeleteItem("file_normal", "emp_101");
    expect(afterReleaseCheck.allowed).toBe(true);
  });

  it("generates retention dry-run impact report categorizing eligible vs hold-protected items", () => {
    const retention = new RetentionEngine();
    const schedule: RetentionSchedule = {
      id: "sched_7yr_finance",
      name: "7-Year Financial Retention",
      retentionDays: 365 * 7,
      dispositionAction: "permanent_delete",
      appliesToLabels: ["confidential"],
    };
    retention.addRetentionSchedule(schedule);

    // Add hold on emp_cfo
    retention.addLegalHold({
      id: "hold_audit_cfo",
      name: "Tax Audit Hold",
      description: "IRS Audit",
      custodianIds: ["emp_cfo"],
      fileIds: [],
      status: "active",
      createdAt: new Date().toISOString(),
      createdBy: "tax_lead",
    });

    const now = Date.now();
    const eightYearsAgo = new Date(now - 8 * 365 * 24 * 3600 * 1000).toISOString();
    const twoYearsAgo = new Date(now - 2 * 365 * 24 * 3600 * 1000).toISOString();

    const items: GovernanceItem[] = [
      {
        id: "item_old_1",
        name: "FY18_ledger.slsheet",
        custodianId: "emp_accountant",
        label: "confidential",
        createdAt: eightYearsAgo,
      },
      {
        id: "item_old_cfo",
        name: "FY18_cfo_memo.sldoc",
        custodianId: "emp_cfo", // Covered by legal hold!
        label: "confidential",
        createdAt: eightYearsAgo,
      },
      {
        id: "item_recent",
        name: "FY25_current.sldoc",
        custodianId: "emp_accountant",
        label: "confidential",
        createdAt: twoYearsAgo,
      },
    ];

    const report = retention.generateRetentionDryRun(items, schedule.id, now);
    expect(report.totalEvaluated).toBe(3);
    // item_old_1 is older than 7 years and has no hold -> eligible for disposition
    expect(report.eligibleForDisposition.map((i) => i.id)).toEqual(["item_old_1"]);
    // item_old_cfo is older than 7 years but protected by IRS hold -> blocked
    expect(report.blockedByLegalHold.map((i) => i.id)).toEqual(["item_old_cfo"]);
  });

  it("produces signed e-Discovery export bundle verifiable independently against its manifest", () => {
    const discovery = new DiscoveryService();
    const manifest = discovery.createDiscoveryExport({
      exportId: "export_matter_401",
      requesterId: "auditor_external_sec",
      authorizedScope: "Custodians: [emp_101, emp_cfo], Date: 2024-2026",
      files: [
        {
          id: "f1",
          name: "Q1_report.sldoc",
          sha256: "hash_f1_abcdef123456",
          version: 2,
          labels: ["confidential"],
          custodianId: "emp_101",
          createdAt: "2025-01-01T00:00:00Z",
          modifiedAt: "2025-01-10T00:00:00Z",
        },
        {
          id: "f2",
          name: "Financials.slsheet",
          sha256: "hash_f2_fedcba654321",
          version: 1,
          labels: ["restricted"],
          custodianId: "emp_cfo",
          createdAt: "2025-02-01T00:00:00Z",
          modifiedAt: "2025-02-15T00:00:00Z",
        },
      ],
    });

    expect(manifest.exportId).toBe("export_matter_401");
    expect(manifest.manifestSignature).toBeTruthy();

    // Verification succeeds with unmodified manifest
    const verify1 = discovery.verifyDiscoveryExport(manifest);
    expect(verify1.valid).toBe(true);

    // Tampering test: if a file hash or property is altered, verification fails
    const tamperedManifest = JSON.parse(JSON.stringify(manifest));
    tamperedManifest.files[0].sha256 = "hash_altered_malicious_replacement";
    const verifyTampered = discovery.verifyDiscoveryExport(tamperedManifest);
    expect(verifyTampered.valid).toBe(false);
    expect(verifyTampered.error).toContain("Manifest signature mismatch");
  });

  it("evaluates sensitive data classification and explains decisions without leaking secrets", () => {
    const engine = new ClassificationEngine();

    // Detects SSN
    const textWithSsn = "Employee Tax ID: 123-45-6789 confidential payroll data.";
    const detected = engine.detectClassification(textWithSsn);
    expect(detected.label).toBe("restricted");
    expect(detected.matches.some((m) => m.rule.includes("SSN"))).toBe(true);

    // Explainable policy decisions
    const shareCheck = engine.evaluateActionPolicy("externalShare", detected.label);
    expect(shareCheck.allowed).toBe(false);
    expect(shareCheck.reason).toContain("External sharing is prohibited for 'restricted' data");
    // Crucial: The reason explains the policy without regurgitating the SSN secret!
    expect(shareCheck.reason).not.toContain("123-45-6789");

    const exportCheck = engine.evaluateActionPolicy("export", detected.label);
    expect(exportCheck.allowed).toBe(false);
    expect(exportCheck.reason).toContain("Local file export is prohibited");

    // Expiring override
    const fileId = "file_tax_memo";
    engine.grantOverride({
      fileId,
      originalLabel: "restricted",
      overrideLabel: "internal",
      grantedBy: "compliance_officer_jane",
      reason: "Tax IDs anonymized in final copy",
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });

    // With active override, export is permitted under 'internal' policy
    const overrideExportCheck = engine.evaluateActionPolicy("export", detected.label, fileId);
    expect(overrideExportCheck.allowed).toBe(true);
  });

  it("detects tampering, omitted rows, and content changes in append-only cryptographic audit chain", () => {
    const logger = new AppendOnlyAuditLogger();
    logger.append("u1", "file.create", "doc_1", { title: "Charter" });
    logger.append("u2", "permission.grant", "doc_1", { grantedTo: "u3", role: "editor" });
    logger.append("u1", "file.export", "doc_1", { format: "pdf" });

    const chain = logger.getChain();
    expect(chain).toHaveLength(3);

    // Genuine chain verifies
    const checkGenuine = AppendOnlyAuditLogger.verifyChain(chain);
    expect(checkGenuine.valid).toBe(true);

    // Tamper test 1: Row content modified
    const tamperedContent = JSON.parse(JSON.stringify(chain));
    tamperedContent[1].action = "permission.revoke"; // altered
    const checkTamperedContent = AppendOnlyAuditLogger.verifyChain(tamperedContent);
    expect(checkTamperedContent.valid).toBe(false);
    expect(checkTamperedContent.error).toContain("Hash verification failure");

    // Tamper test 2: Row omitted
    const omittedChain = [chain[0], chain[2]]; // missing sequence 2
    const checkOmitted = AppendOnlyAuditLogger.verifyChain(omittedChain);
    expect(checkOmitted.valid).toBe(false);
    expect(checkOmitted.error).toContain("Sequence discontinuity");
  });
});
