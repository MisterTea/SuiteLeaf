import { describe, expect, it } from "vitest";
import { unattendedInstallPlan, unattendedUninstallPlan } from "../apps/desktop/src/unattended";

const hash = "ab".repeat(32);

describe("unattended install", () => {
  it("refuses an unsigned build and a document, and does not remove documents", () => {
    const unsigned = unattendedInstallPlan({
      identity: null,
      installerName: "SuiteLeaf.dmg",
      sha256: hash,
      expectedSha256: hash,
    });
    expect(unsigned).toEqual({
      action: "refuse",
      reason: "This build is not signed. It is not an unattended install.",
    });
    expect(JSON.stringify(unsigned)).not.toContain("secret-value");

    const document = unattendedInstallPlan({
      identity: "Developer ID",
      installerName: "secret-value.sldoc",
      sha256: hash,
      expectedSha256: hash,
    });
    expect(document.action).toBe("refuse");
    expect(document.reason).toBe("An unattended install does not replace a document.");
    expect(JSON.stringify(document)).not.toContain("secret-value");

    const ready = unattendedInstallPlan({
      identity: "Developer ID",
      installerName: "SuiteLeaf.dmg",
      sha256: hash,
      expectedSha256: hash,
    });
    expect(ready.action).toBe("ready");
    expect(ready.reason).toContain("not replaced");

    const removed = unattendedUninstallPlan({
      appPath: "/Applications/SuiteLeaf.app",
      keep: ["/Users/ada/Documents/Beds.sldoc"],
    });
    expect(removed).toEqual({
      action: "ready",
      reason: "The app can be removed. Documents stay.",
      remove: "/Applications/SuiteLeaf.app",
    });
    expect(JSON.stringify(removed)).not.toContain("Beds.sldoc");

    const kept = unattendedUninstallPlan({
      appPath: "/Users/ada/Documents/secret-value.sldoc",
      keep: ["/Users/ada/Documents"],
    });
    expect(kept.action).toBe("refuse");
    expect(kept.reason).toBe("An unattended uninstall does not remove a document.");
    expect(JSON.stringify(kept)).not.toContain("secret-value");

    const climbed = unattendedInstallPlan({
      identity: "Developer ID",
      installerName: "../secret-value.dmg",
      sha256: hash,
      expectedSha256: hash,
    });
    expect(climbed).toEqual({
      action: "refuse",
      reason: "The installer name is not a SuiteLeaf installer.",
    });
    expect(JSON.stringify(climbed)).not.toContain("secret-value");
    const outside = unattendedUninstallPlan({
      appPath: "../secret-value/SuiteLeaf.app",
      keep: [],
    });
    expect(outside).toEqual({
      action: "refuse",
      reason: "The app path is not a SuiteLeaf app path.",
    });
    expect(JSON.stringify(outside)).not.toContain("secret-value");
    expect(outside).not.toHaveProperty("remove");
  });
});
