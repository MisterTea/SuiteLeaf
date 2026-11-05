import { createFile } from "../native-file";
import type { BrandBundle, OrganizationTemplate } from "./types";

export const DEFAULT_BRAND_BUNDLE: BrandBundle = {
  id: "brand_suiteleaf_standard",
  name: "SuiteLeaf Modern Corporate",
  colors: {
    primary: "#1a73e8",
    secondary: "#188038",
    accent: "#f2994a",
    neutralLight: "#f8f9fa",
    neutralDark: "#202124",
  },
  fonts: {
    heading: "SuiteLeaf Willow",
    body: "SuiteLeaf Willow",
    code: "monospace",
  },
  logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><text x="10" y="26" font-family="sans-serif" font-weight="bold" fill="#1a73e8">ORGANIZATION</text></svg>`,
  licenseNote: "Open organization brand license, unrestricted internal use.",
};

export function createExecutiveBriefStarter(orgId = "default_org", ownerId = "admin"): OrganizationTemplate {
  const doc = createFile("doc", "Executive Strategy Brief");
  if (doc.kind === "doc") {
    doc.content = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Executive Strategy Brief" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Summary of strategic priorities, key performance indicators, and cross-functional deliverables.",
            },
          ],
        },
      ],
    };
  }

  return {
    id: "tpl_starter_exec_brief",
    name: "Executive Strategy Brief",
    description: "Standard executive memo template with approved corporate header, typography, and section anchors.",
    kind: "doc",
    category: "Executive",
    version: 1,
    status: "published",
    ownerId,
    orgId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    brandBundle: DEFAULT_BRAND_BUNDLE,
    content: doc,
    offlineReady: true,
    dependencies: [
      {
        id: "dep_font_willow",
        type: "font",
        name: "SuiteLeaf Willow",
        licensedForOrg: true,
      },
    ],
    permissions: {
      allowedRoles: ["admin", "member", "viewer"],
    },
  };
}

export function createFinancialForecastStarter(orgId = "default_org", ownerId = "admin"): OrganizationTemplate {
  const sheet = createFile("sheet", "Quarterly Financial Model");

  return {
    id: "tpl_starter_fin_model",
    name: "Quarterly Financial Model",
    description: "Standard organization financial forecast workbook with revenue, COGS, and margin schedules.",
    kind: "sheet",
    category: "Finance",
    version: 1,
    status: "published",
    ownerId,
    orgId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    brandBundle: DEFAULT_BRAND_BUNDLE,
    content: sheet,
    offlineReady: true,
    dependencies: [],
    permissions: {
      allowedRoles: ["admin", "member"],
    },
  };
}

export function createPitchDeckStarter(orgId = "default_org", ownerId = "admin"): OrganizationTemplate {
  const slide = createFile("slide", "Company Pitch Deck");

  return {
    id: "tpl_starter_pitch_deck",
    name: "Company Pitch Deck",
    description: "High-impact presentation deck with approved layouts, palette, and slide masters.",
    kind: "slide",
    category: "Marketing",
    version: 1,
    status: "published",
    ownerId,
    orgId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    brandBundle: DEFAULT_BRAND_BUNDLE,
    content: slide,
    offlineReady: true,
    dependencies: [],
    permissions: {
      allowedRoles: ["admin", "member", "viewer"],
    },
  };
}
