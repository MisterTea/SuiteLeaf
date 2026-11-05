import type {
  ClassificationOverride,
  ClassificationPolicy,
  DataClassificationLabel,
  SensitivePattern,
} from "./types";

export const DEFAULT_CLASSIFICATION_POLICIES: Record<DataClassificationLabel, ClassificationPolicy> = {
  public: {
    label: "public",
    allowExternalSharing: true,
    allowExport: true,
    allowOffline: true,
    allowAiProcessing: true,
  },
  internal: {
    label: "internal",
    allowExternalSharing: false,
    allowExport: true,
    allowOffline: true,
    allowAiProcessing: true,
  },
  confidential: {
    label: "confidential",
    allowExternalSharing: false,
    allowExport: true,
    allowOffline: false,
    allowAiProcessing: true,
  },
  restricted: {
    label: "restricted",
    allowExternalSharing: false,
    allowExport: false,
    allowOffline: false,
    allowAiProcessing: false,
  },
};

export const BUILTIN_SENSITIVE_PATTERNS: SensitivePattern[] = [
  {
    name: "Social Security Number (SSN)",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/,
    recommendedLabel: "restricted",
    description: "United States Social Security Number pattern detected.",
  },
  {
    name: "Credit Card Number",
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/,
    recommendedLabel: "restricted",
    description: "Payment card industry primary account number detected.",
  },
  {
    name: "Private Cryptographic Key",
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
    recommendedLabel: "restricted",
    description: "PEM private key block detected.",
  },
  {
    name: "Confidentiality Marker",
    pattern: /\b(?:STRICTLY\s+CONFIDENTIAL|COMPANY\s+PROPRIETARY|ATTORNEY-CLIENT\s+PRIVILEGE)\b/i,
    recommendedLabel: "confidential",
    description: "Document header or watermark contains explicit confidentiality marker.",
  },
];

export class ClassificationEngine {
  private overrides: Map<string, ClassificationOverride> = new Map();
  private policies: Record<DataClassificationLabel, ClassificationPolicy>;

  constructor(customPolicies?: Partial<Record<DataClassificationLabel, ClassificationPolicy>>) {
    this.policies = { ...DEFAULT_CLASSIFICATION_POLICIES, ...customPolicies };
  }

  detectClassification(text: string): {
    label: DataClassificationLabel;
    matches: Array<{ rule: string; description: string }>;
  } {
    const matches: Array<{ rule: string; description: string }> = [];
    let highestRank = 0;
    const rankMap: Record<DataClassificationLabel, number> = {
      public: 0,
      internal: 1,
      confidential: 2,
      restricted: 3,
    };

    for (const rule of BUILTIN_SENSITIVE_PATTERNS) {
      if (rule.pattern.test(text)) {
        matches.push({ rule: rule.name, description: rule.description });
        const rank = rankMap[rule.recommendedLabel];
        if (rank > highestRank) {
          highestRank = rank;
        }
      }
    }

    const labels: DataClassificationLabel[] = ["public", "internal", "confidential", "restricted"];
    const label = highestRank > 0 ? labels[highestRank] : "internal";

    return { label, matches };
  }

  grantOverride(override: Omit<ClassificationOverride, "id">): ClassificationOverride {
    const id = `ovr_${Math.random().toString(36).slice(2, 9)}`;
    const full: ClassificationOverride = { ...override, id };
    this.overrides.set(override.fileId, full);
    return full;
  }

  getEffectiveLabel(fileId: string, detectedLabel: DataClassificationLabel): DataClassificationLabel {
    const override = this.overrides.get(fileId);
    if (override) {
      if (new Date(override.expiresAt).getTime() > Date.now()) {
        return override.overrideLabel;
      }
    }
    return detectedLabel;
  }

  evaluateActionPolicy(
    action: "externalShare" | "export" | "offline" | "aiProcessing",
    label: DataClassificationLabel,
    fileId?: string,
  ): { allowed: boolean; reason?: string } {
    const effectiveLabel = fileId ? this.getEffectiveLabel(fileId, label) : label;
    const policy = this.policies[effectiveLabel];

    if (action === "externalShare" && !policy.allowExternalSharing) {
      return {
        allowed: false,
        reason: `External sharing is prohibited for '${effectiveLabel}' data. Sensitive information detected.`,
      };
    }

    if (action === "export" && !policy.allowExport) {
      return {
        allowed: false,
        reason: `Local file export is prohibited for '${effectiveLabel}' data under organization data protection policy.`,
      };
    }

    if (action === "offline" && !policy.allowOffline) {
      return {
        allowed: false,
        reason: `Offline caching is restricted for '${effectiveLabel}' data.`,
      };
    }

    if (action === "aiProcessing" && !policy.allowAiProcessing) {
      return {
        allowed: false,
        reason: `External AI inference is disabled for '${effectiveLabel}' data.`,
      };
    }

    return { allowed: true };
  }
}
