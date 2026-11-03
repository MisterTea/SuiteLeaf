import { describe, expect, it } from "vitest";
import {
  COST_CATEGORIES,
  applyExpansion,
  cancelHostedService,
  hostedHold,
  declineEffect,
  expansionWarning,
  storageBudgetNotice,
  featuresOn,
  localEditingRequiresBilling,
  SOFTWARE_EDITION,
  SUPPORTED_FEATURES,
} from "../packages/core/src/packaging";

describe("packaging", () => {
  it("lists every cost category and does not invent a price", () => {
    expect(COST_CATEGORIES.map((item) => item.id)).toEqual([
      "license",
      "hosting",
      "storage",
      "backups",
      "support",
      "ai",
    ]);
    expect(COST_CATEGORIES.find((item) => item.id === "license")?.charge).toBe(
      "none",
    );
    for (const item of COST_CATEGORIES) {
      if (item.id !== "license") expect(item.charge).toBe("not-published");
      expect(item.summary).not.toMatch(/[$€£]/);
      expect(item.summary).not.toMatch(/\d/);
    }
    expect(COST_CATEGORIES.find((item) => item.id === "ai")?.optional).toBe(
      true,
    );
  });

  it("keeps local editing free of a bill and explains a declined extra", () => {
    expect(localEditingRequiresBilling()).toBe(false);
    expect(declineEffect("ai")).toContain("still open and save");
    expect(declineEffect("hosted-storage")).toContain("stay readable");
  });

  it("keeps files on this computer after the hosted service is cancelled", () => {
    const files = [
      { id: "beds", title: "Beds", local: true },
      { id: "remote", title: "Remote", local: false },
    ];
    const cancelled = cancelHostedService(files);
    expect(cancelled.hosted).toBe(false);
    expect(cancelled.billingRequired).toBe(false);
    expect(cancelled.localFiles).toEqual([{ id: "beds", title: "Beds", local: true }]);
    expect(cancelled.removedHostedAccess).toEqual(["remote"]);
    expect(cancelled.notice).toContain("still open and save");
    expect(cancelled.notice).not.toMatch(/[$€£]|\d/);
    expect(files).toEqual([
      { id: "beds", title: "Beds", local: true },
      { id: "remote", title: "Remote", local: false },
    ]);
  });

  it("keeps a local export during a billing hold and publishes no grace length", () => {
    const files = [
      { id: "beds", title: "secret-value", local: true },
      { id: "remote", title: "Remote", local: false },
    ];
    const billing = hostedHold("billing", files);
    expect(billing.remoteAccess).toBe(false);
    expect(billing.localFilesReadable).toBe(true);
    expect(billing.localExport).toBe(true);
    expect(billing.localFiles).toEqual([{ id: "beds", title: "secret-value", local: true }]);
    expect(billing.notice).toContain("still open, save, and export");
    expect(billing.notice).toContain("does not publish a grace length");
    expect(billing.notice).not.toContain("secret-value");
    expect(billing.notice).not.toMatch(/[$€£]|\d/);
    const security = hostedHold("security", files);
    expect(security.remoteAccess).toBe(false);
    expect(security.localExport).toBe(true);
    expect(security.notice).toContain("security hold");
    expect(security.notice).toContain("does not publish a grace period");
    expect(security.notice).not.toContain("secret-value");
    expect(files[0].title).toBe("secret-value");
  });

  it("shows the decline effect before a storage expansion and adds no price", () => {
    const warning = expansionWarning("hosted-storage");
    expect(warning).toContain("If you decline");
    expect(warning).toContain("does not publish a storage price");
    expect(warning).not.toMatch(/[$€£]|\d/);
    const declined = applyExpansion({ choice: "hosted-storage", acknowledged: false });
    expect(declined.applied).toBe(false);
    expect(declined.notice).toBe(declineEffect("hosted-storage"));
    const accepted = applyExpansion({ choice: "hosted-storage", acknowledged: true });
    expect(accepted.applied).toBe(false);
    expect(accepted.notice).toContain("does not publish a storage price");
    expect(accepted.notice).not.toMatch(/[$€£]|\d/);
    const assistant = applyExpansion({ choice: "ai", acknowledged: true });
    expect(assistant.applied).toBe(true);
    expect(assistant.notice).toContain("No SuiteLeaf price");
  });

  it("warns when hosted storage reaches its budget and adds no price", () => {
    const reached = storageBudgetNotice(1000, 1000);
    expect(reached.reached).toBe(true);
    expect(reached.notice).toContain("reached its budget");
    expect(reached.notice).toContain("If you decline");
    expect(reached.notice).not.toMatch(/[$€£]|\d/);
    const near = storageBudgetNotice(900, 1000);
    expect(near.reached).toBe(false);
    expect(near.notice).toContain("near its budget");
    expect(near.notice).not.toMatch(/\d/);
    const within = storageBudgetNotice(100, 1000);
    expect(within.notice).toContain("within its budget");
    const bad = storageBudgetNotice(Number("secret-value"), 1000);
    expect(bad.notice).toBe("The storage count is not a whole number of bytes.");
    expect(bad.notice).not.toContain("secret-value");
  });

  it("lists one edition and does not hide an assistant requirement", () => {
    expect(SOFTWARE_EDITION.charge).toBe("none");
    expect(SOFTWARE_EDITION.note).toContain("one software edition");
    const editors = ["local-document", "local-spreadsheet", "local-slides", "slideshow"];
    for (const id of editors) {
      const feature = SUPPORTED_FEATURES.find((item) => item.id === id);
      expect(feature?.requiresAssistant).toBe(false);
      expect(feature?.requiresAccount).toBe(false);
      expect(feature?.platforms).toEqual(["web", "desktop"]);
    }
    expect(SUPPORTED_FEATURES.filter((item) => item.requiresAssistant).map((item) => item.id)).toEqual([
      "assistant",
    ]);
    expect(featuresOn("node").map((item) => item.id)).toEqual(["suite-drive"]);
    expect(featuresOn("desktop").some((item) => item.id === "local-document")).toBe(true);
    for (const feature of SUPPORTED_FEATURES) {
      expect(feature.name).not.toMatch(/[$€£]/);
    }
  });
});
