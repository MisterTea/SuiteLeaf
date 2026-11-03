/**
 * What SuiteLeaf charges for, and what keeps working if you decline.
 * No price is invented here. A category is either no software charge, or
 * a cost this repository does not publish.
 */

export type CostCategoryId =
  "license" | "hosting" | "storage" | "backups" | "support" | "ai";

export type CostCategory = {
  id: CostCategoryId;
  /** `none` is a software charge of nothing. `not-published` is not a price. */
  charge: "none" | "not-published";
  optional: boolean;
  summary: string;
};

export const COST_CATEGORIES: readonly CostCategory[] = [
  {
    id: "license",
    charge: "none",
    optional: false,
    summary:
      "The editors use the Apache license. There is no fee for the software license.",
  },
  {
    id: "hosting",
    charge: "not-published",
    optional: true,
    summary:
      "A cluster is self-hosted. This repository does not publish a hosting price.",
  },
  {
    id: "storage",
    charge: "not-published",
    optional: true,
    summary:
      "Files on this computer are not metered. This repository does not publish a storage price.",
  },
  {
    id: "backups",
    charge: "not-published",
    optional: true,
    summary:
      "This repository does not publish a backup price. A local file is still yours.",
  },
  {
    id: "support",
    charge: "not-published",
    optional: true,
    summary:
      "This repository does not publish a support price or a response promise.",
  },
  {
    id: "ai",
    charge: "not-published",
    optional: true,
    summary:
      "The assistant is off until you turn it on. A remote model endpoint is your own choice and is not a SuiteLeaf price.",
  },
];

/** Local files open and save with no account and no hosted bill. */
export function localEditingRequiresBilling(): false {
  return false;
}

export type UsageChoice = "ai" | "hosted-storage";

export type SavedFile = { id: string; title: string; local: boolean };

export type Cancellation = {
  hosted: false;
  billingRequired: false;
  localFiles: SavedFile[];
  removedHostedAccess: string[];
  notice: string;
};

/**
 * Stop hosted access. Copies already on this computer stay. A file that
 * exists only on the host is not copied here, and no charge is added.
 * The input list is not changed.
 */
export function cancelHostedService(files: SavedFile[]): Cancellation {
  return {
    hosted: false,
    billingRequired: false,
    localFiles: files.filter((file) => file.local).map((file) => ({ ...file })),
    removedHostedAccess: files.filter((file) => !file.local).map((file) => file.id),
    notice:
      "The hosted service is cancelled. Files already on this computer still open and save. No charge was added.",
  };
}

export type AccountHold = "billing" | "security";

export type HoldResult = {
  remoteAccess: false;
  localFilesReadable: true;
  localExport: true;
  localFiles: SavedFile[];
  notice: string;
};

/**
 * A hold stops hosted access. Files already on this computer still open, save,
 * and export. A security hold does not add a grace period. A billing hold does
 * not lock those local copies. No grace length and no price are published.
 * File titles are not repeated in the notice. The input list is not changed.
 */
export function hostedHold(hold: AccountHold, files: SavedFile[]): HoldResult {
  const localFiles = files.filter((file) => file.local).map((file) => ({ ...file }));
  const notice =
    hold === "security"
      ? "Hosted access stopped for a security hold. Files already on this computer still open, save, and export. This does not publish a grace period."
      : "A billing hold does not lock files already on this computer. They still open, save, and export. Hosted access is stopped. This repository does not publish a grace length or a price.";
  return {
    remoteAccess: false,
    localFilesReadable: true,
    localExport: true,
    localFiles,
    notice,
  };
}

/**
 * The notice shown before an optional expansion. It names the effect of declining
 * and does not state a price.
 */
export function expansionWarning(choice: UsageChoice): string {
  if (choice === "ai") {
    return "The assistant is optional. Turning it on is not a SuiteLeaf price. If you decline, the assistant stays off and files on this computer still open and save.";
  }
  return "Extra hosted storage is optional. This repository does not publish a storage price. If you decline, no expansion is applied and files on this computer stay readable.";
}

/**
 * Apply an expansion only after the warning was acknowledged. Declining leaves
 * files on this computer usable. Acknowledging storage still adds no charge,
 * because no storage price is published.
 */
export function applyExpansion(input: {
  choice: UsageChoice;
  acknowledged: boolean;
}): { applied: boolean; notice: string } {
  if (!input.acknowledged) return { applied: false, notice: declineEffect(input.choice) };
  if (input.choice === "ai") {
    return { applied: true, notice: "The assistant can be turned on. No SuiteLeaf price was added." };
  }
  return {
    applied: false,
    notice: "No storage expansion was applied. This repository does not publish a storage price.",
  };
}

/**
 * A notice before hosted storage would need more room. It does not state a price
 * or repeat a count that is not a whole number of bytes.
 */
export function storageBudgetNotice(
  used: number,
  budget: number,
): { reached: boolean; notice: string } {
  if (!Number.isInteger(used) || used < 0 || !Number.isInteger(budget) || budget < 0) {
    return { reached: false, notice: "The storage count is not a whole number of bytes." };
  }
  if (budget === 0) {
    return { reached: false, notice: "No hosted storage budget is set. No expansion is applied." };
  }
  if (used >= budget) {
    return {
      reached: true,
      notice:
        "Hosted storage has reached its budget. Extra hosted storage is optional. This repository does not publish a storage price. If you decline, no expansion is applied and files on this computer stay readable.",
    };
  }
  if (used * 5 >= budget * 4) {
    return {
      reached: false,
      notice:
        "Hosted storage is near its budget. No expansion is applied unless you choose it later. This repository does not publish a storage price.",
    };
  }
  return { reached: false, notice: "Hosted storage is within its budget. No expansion is applied." };
}

/** One software edition. This repository does not publish a paid edition. */
export const SOFTWARE_EDITION = {
  id: "suiteleaf",
  name: "SuiteLeaf",
  charge: "none" as const,
  note: "There is one software edition. This repository does not publish a paid edition.",
};

export type FeaturePlatform = "web" | "desktop" | "node";

export type SupportedFeature = {
  id: string;
  name: string;
  platforms: readonly FeaturePlatform[];
  requiresAccount: boolean;
  requiresAssistant: boolean;
};

/**
 * What this repository supports, by platform. The desktop app loads the web
 * editors. The node does not paint those editors. The assistant is the only
 * row that requires the assistant.
 */
export const SUPPORTED_FEATURES: readonly SupportedFeature[] = [
  {
    id: "local-document",
    name: "Edit a document on this computer",
    platforms: ["web", "desktop"],
    requiresAccount: false,
    requiresAssistant: false,
  },
  {
    id: "local-spreadsheet",
    name: "Edit a spreadsheet on this computer",
    platforms: ["web", "desktop"],
    requiresAccount: false,
    requiresAssistant: false,
  },
  {
    id: "local-slides",
    name: "Edit a presentation on this computer",
    platforms: ["web", "desktop"],
    requiresAccount: false,
    requiresAssistant: false,
  },
  {
    id: "slideshow",
    name: "Present a slideshow on this computer",
    platforms: ["web", "desktop"],
    requiresAccount: false,
    requiresAssistant: false,
  },
  {
    id: "suite-drive",
    name: "Share a file through SuiteDrive",
    platforms: ["web", "desktop", "node"],
    requiresAccount: true,
    requiresAssistant: false,
  },
  {
    id: "assistant",
    name: "Assistant",
    platforms: ["web", "desktop"],
    requiresAccount: false,
    requiresAssistant: true,
  },
];

/** Features for one platform. The assistant is included only where it can run. */
export function featuresOn(platform: FeaturePlatform): SupportedFeature[] {
  return SUPPORTED_FEATURES.filter((feature) => feature.platforms.includes(platform));
}

/** What happens if the person says no. Declining does not lock files already on this computer. */
export function declineEffect(choice: UsageChoice): string {
  if (choice === "ai") {
    return "The assistant stays off. Documents, spreadsheets, and slides on this computer still open and save.";
  }
  return "No paid storage expansion is applied. Files already on this computer stay readable.";
}
