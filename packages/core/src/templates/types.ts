import type { Kind, SuiteFile } from "../file-schema";

export type TemplateStatus = "draft" | "published" | "retired";

export interface BrandBundle {
  id: string;
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    neutralLight: string;
    neutralDark: string;
  };
  fonts: {
    heading: string;
    body: string;
    code?: string;
  };
  logoSvg?: string;
  licenseNote: string;
}

export interface TemplateDependency {
  id: string;
  type: "font" | "image" | "style";
  name: string;
  dataUri?: string;
  licensedForOrg: boolean;
}

export interface TemplateProvenance {
  templateId: string;
  templateVersion: number;
  templateName: string;
  instantiatedAt: string;
  brandBundleId?: string;
}

export interface OrganizationTemplate {
  id: string;
  name: string;
  description: string;
  kind: Kind;
  category: string;
  version: number;
  status: TemplateStatus;
  ownerId: string;
  orgId: string;
  createdAt: string;
  updatedAt: string;
  retiredAt?: string;
  brandBundle?: BrandBundle;
  content: SuiteFile;
  offlineReady: boolean;
  dependencies: TemplateDependency[];
  permissions: {
    allowedRoles?: ("admin" | "member" | "viewer")[];
    allowedGroups?: string[];
  };
}

export interface TemplateStyleChange {
  target: string;
  attribute: string;
  currentValue: unknown;
  incomingValue: unknown;
  conflictWithUserOverride: boolean;
}

export interface TemplateUpdatePlan {
  documentId: string;
  templateId: string;
  currentVersion: number;
  targetVersion: number;
  styleChanges: TemplateStyleChange[];
  userContentPreserved: true;
}
