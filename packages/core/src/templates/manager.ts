import { duplicateFile, type SuiteFile } from "../native-file";
import type {
  BrandBundle,
  OrganizationTemplate,
  TemplateProvenance,
  TemplateStyleChange,
  TemplateUpdatePlan,
} from "./types";

export interface UserContext {
  userId: string;
  role: "admin" | "member" | "viewer";
  groups: string[];
}

export class OrganizationTemplateManager {
  private templates: Map<string, OrganizationTemplate> = new Map();
  private versionHistory: Map<string, OrganizationTemplate[]> = new Map();

  constructor(initialTemplates: OrganizationTemplate[] = []) {
    for (const t of initialTemplates) {
      this.templates.set(t.id, t);
      this.versionHistory.set(t.id, [{ ...t }]);
    }
  }

  createTemplate(params: {
    id?: string;
    name: string;
    description: string;
    kind: OrganizationTemplate["kind"];
    category: string;
    ownerId: string;
    orgId: string;
    content: SuiteFile;
    brandBundle?: BrandBundle;
    dependencies?: OrganizationTemplate["dependencies"];
    permissions?: OrganizationTemplate["permissions"];
    offlineReady?: boolean;
  }): OrganizationTemplate {
    const id = params.id ?? `tpl_${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    const template: OrganizationTemplate = {
      id,
      name: params.name,
      description: params.description,
      kind: params.kind,
      category: params.category,
      version: 1,
      status: "draft",
      ownerId: params.ownerId,
      orgId: params.orgId,
      createdAt: now,
      updatedAt: now,
      brandBundle: params.brandBundle,
      content: duplicateFile(params.content, params.name),
      offlineReady: params.offlineReady ?? true,
      dependencies: params.dependencies ?? [],
      permissions: params.permissions ?? { allowedRoles: ["admin", "member", "viewer"] },
    };

    this.templates.set(id, template);
    this.versionHistory.set(id, [{ ...template }]);
    return template;
  }

  getTemplate(id: string): OrganizationTemplate | undefined {
    return this.templates.get(id);
  }

  publishTemplate(id: string): OrganizationTemplate {
    const template = this.templates.get(id);
    if (!template) throw new Error(`Template ${id} not found.`);
    template.status = "published";
    template.updatedAt = new Date().toISOString();
    this.recordVersionSnapshot(template);
    return template;
  }

  retireTemplate(id: string): OrganizationTemplate {
    const template = this.templates.get(id);
    if (!template) throw new Error(`Template ${id} not found.`);
    template.status = "retired";
    template.retiredAt = new Date().toISOString();
    template.updatedAt = new Date().toISOString();
    return template;
  }

  updateTemplateVersion(
    id: string,
    updates: {
      content?: SuiteFile;
      brandBundle?: BrandBundle;
      dependencies?: OrganizationTemplate["dependencies"];
      name?: string;
      description?: string;
    },
  ): OrganizationTemplate {
    const template = this.templates.get(id);
    if (!template) throw new Error(`Template ${id} not found.`);
    if (template.status === "retired") {
      throw new Error(`Cannot update retired template ${id}.`);
    }

    template.version += 1;
    template.updatedAt = new Date().toISOString();
    if (updates.name) template.name = updates.name;
    if (updates.description) template.description = updates.description;
    if (updates.content) template.content = duplicateFile(updates.content, template.name);
    if (updates.brandBundle) template.brandBundle = updates.brandBundle;
    if (updates.dependencies) template.dependencies = updates.dependencies;

    this.recordVersionSnapshot(template);
    return template;
  }

  discoverTemplates(
    user: UserContext,
    options: { category?: string; kind?: OrganizationTemplate["kind"] } = {},
  ): OrganizationTemplate[] {
    const results: OrganizationTemplate[] = [];

    for (const template of this.templates.values()) {
      // Exclude retired templates from discovery
      if (template.status !== "published") continue;

      if (options.category && template.category !== options.category) continue;
      if (options.kind && template.kind !== options.kind) continue;

      // Role and group check
      const allowedRoles = template.permissions.allowedRoles ?? ["admin", "member", "viewer"];
      if (!allowedRoles.includes(user.role)) continue;

      if (template.permissions.allowedGroups && template.permissions.allowedGroups.length > 0) {
        const hasGroup = template.permissions.allowedGroups.some((g) => user.groups.includes(g));
        if (!hasGroup && user.role !== "admin") continue;
      }

      results.push(template);
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  instantiateTemplate(
    templateId: string,
    user: UserContext,
    title?: string,
  ): SuiteFile & { provenance: TemplateProvenance } {
    const template = this.templates.get(templateId);
    if (!template) throw new Error(`Template ${templateId} not found.`);
    if (template.status === "retired") {
      throw new Error(`Template '${template.name}' is retired and cannot be used for new documents.`);
    }
    if (template.status !== "published") {
      throw new Error(`Template '${template.name}' is not published.`);
    }

    // Role check
    const allowedRoles = template.permissions.allowedRoles ?? ["admin", "member", "viewer"];
    if (!allowedRoles.includes(user.role)) {
      throw new Error(`You do not have permission to instantiate this template.`);
    }

    const documentTitle = title ?? template.name;
    const instance = duplicateFile(template.content, documentTitle);

    const provenance: TemplateProvenance = {
      templateId: template.id,
      templateVersion: template.version,
      templateName: template.name,
      instantiatedAt: new Date().toISOString(),
      brandBundleId: template.brandBundle?.id,
    };

    return Object.assign(instance, { provenance });
  }

  compareDocumentWithTemplate(
    document: SuiteFile & { provenance?: TemplateProvenance },
    templateId?: string,
  ): TemplateUpdatePlan {
    const tplId = document.provenance?.templateId ?? templateId;
    if (!tplId) throw new Error("Document has no template provenance.");

    const currentTemplate = this.templates.get(tplId);
    if (!currentTemplate) throw new Error(`Template ${tplId} not found.`);

    const currentVersion = document.provenance?.templateVersion ?? 1;
    const targetVersion = currentTemplate.version;
    const styleChanges: TemplateStyleChange[] = [];

    // Compare Brand Bundle differences
    const historicalVersions = this.versionHistory.get(tplId) ?? [];
    const sourceVersionSnapshot =
      historicalVersions.find((v) => v.version === currentVersion) ?? currentTemplate;

    if (sourceVersionSnapshot.brandBundle && currentTemplate.brandBundle) {
      const oldColors = sourceVersionSnapshot.brandBundle.colors;
      const newColors = currentTemplate.brandBundle.colors;
      if (oldColors.primary !== newColors.primary) {
        styleChanges.push({
          target: "brand.colors.primary",
          attribute: "color",
          currentValue: oldColors.primary,
          incomingValue: newColors.primary,
          conflictWithUserOverride: false,
        });
      }

      const oldFonts = sourceVersionSnapshot.brandBundle.fonts;
      const newFonts = currentTemplate.brandBundle.fonts;
      if (oldFonts.heading !== newFonts.heading) {
        styleChanges.push({
          target: "brand.fonts.heading",
          attribute: "fontFamily",
          currentValue: oldFonts.heading,
          incomingValue: newFonts.heading,
          conflictWithUserOverride: false,
        });
      }
    }

    return {
      documentId: document.id,
      templateId: currentTemplate.id,
      currentVersion,
      targetVersion,
      styleChanges,
      userContentPreserved: true, // Guarantees user body/text is untouched
    };
  }

  exportTemplates(): string {
    const data = {
      templates: Array.from(this.templates.values()),
      history: Array.from(this.versionHistory.entries()),
    };
    return JSON.stringify(data, null, 2);
  }

  importTemplates(jsonText: string): number {
    const parsed = JSON.parse(jsonText);
    let count = 0;
    if (Array.isArray(parsed.templates)) {
      for (const t of parsed.templates) {
        this.templates.set(t.id, t);
        count++;
      }
    }
    if (Array.isArray(parsed.history)) {
      for (const [id, versions] of parsed.history) {
        this.versionHistory.set(id, versions);
      }
    }
    return count;
  }

  private recordVersionSnapshot(template: OrganizationTemplate) {
    const history = this.versionHistory.get(template.id) ?? [];
    history.push({ ...template });
    this.versionHistory.set(template.id, history);
  }
}
