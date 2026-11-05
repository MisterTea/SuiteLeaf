import { describe, expect, it } from "vitest";
import {
  createExecutiveBriefStarter,
  createFinancialForecastStarter,
  createPitchDeckStarter,
  DEFAULT_BRAND_BUNDLE,
  OrganizationTemplateManager,
  type UserContext,
} from "../packages/core/src/templates";

describe("WP-036: Shared Templates & Organization Branding", () => {
  const adminUser: UserContext = { userId: "u_admin", role: "admin", groups: ["executives"] };
  const memberUser: UserContext = { userId: "u_member", role: "member", groups: ["finance"] };
  const externalViewer: UserContext = { userId: "u_guest", role: "viewer", groups: [] };

  it("authorized users can discover and instantiate an approved template with all required assets", () => {
    const manager = new OrganizationTemplateManager();
    const execTpl = createExecutiveBriefStarter();
    const finTpl = createFinancialForecastStarter();
    const deckTpl = createPitchDeckStarter();

    manager.createTemplate(execTpl);
    manager.publishTemplate(execTpl.id);

    manager.createTemplate(finTpl);
    manager.publishTemplate(finTpl.id);

    manager.createTemplate(deckTpl);
    manager.publishTemplate(deckTpl.id);

    // Member discovers templates
    const memberTemplates = manager.discoverTemplates(memberUser);
    expect(memberTemplates).toHaveLength(3);

    // Guest viewer does not see Finance template (role restricted to admin & member)
    const guestTemplates = manager.discoverTemplates(externalViewer);
    expect(guestTemplates).toHaveLength(2);
    expect(guestTemplates.some((t) => t.category === "Finance")).toBe(false);

    // Instantiate Executive Brief
    const instance = manager.instantiateTemplate(
      execTpl.id,
      memberUser,
      "Q4 Strategy - Finance",
    );

    expect(instance.title).toBe("Q4 Strategy - Finance");
    expect(instance.id).not.toBe(execTpl.content.id); // Must be an independent file instance!
    expect(instance.provenance).toBeDefined();
    expect(instance.provenance.templateId).toBe(execTpl.id);
    expect(instance.provenance.templateVersion).toBe(1);
    expect(instance.provenance.brandBundleId).toBe(DEFAULT_BRAND_BUNDLE.id);

    // Assets & Dependencies are verified offline ready
    expect(execTpl.offlineReady).toBe(true);
    expect(execTpl.dependencies[0].name).toBe("SuiteLeaf Willow");
  });

  it("retiring a template prevents new use while existing instantiated documents remain intact", () => {
    const manager = new OrganizationTemplateManager();
    const tpl = createPitchDeckStarter();
    manager.createTemplate(tpl);
    manager.publishTemplate(tpl.id);

    // Instantiate before retirement
    const instance = manager.instantiateTemplate(tpl.id, memberUser, "Client Pitch");
    expect(instance.title).toBe("Client Pitch");

    // Admin retires template
    const retired = manager.retireTemplate(tpl.id);
    expect(retired.status).toBe("retired");
    expect(retired.retiredAt).toBeDefined();

    // Discovery excludes retired templates
    const available = manager.discoverTemplates(memberUser);
    expect(available.some((t) => t.id === tpl.id)).toBe(false);

    // New instantiation attempts fail
    expect(() => manager.instantiateTemplate(tpl.id, memberUser, "Another Pitch")).toThrow(
      "is retired and cannot be used",
    );

    // Existing instance remains completely valid and intact
    expect(instance.id).toBeDefined();
    expect(instance.provenance.templateId).toBe(tpl.id);
  });

  it("a template version update has explicit effects and does not replace user-authored content", () => {
    const manager = new OrganizationTemplateManager();
    const starter = createExecutiveBriefStarter();
    manager.createTemplate(starter);
    manager.publishTemplate(starter.id);

    // User instantiates document from version 1
    const userDoc = manager.instantiateTemplate(starter.id, memberUser, "FY27 Strategic Memo");

    // User authors local content in their document
    if (userDoc.kind === "doc") {
      userDoc.content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Confidential executive remarks and user-written notes." }],
          },
        ],
      };
    }

    // Organization updates template to Version 2 with new brand colors and typography
    manager.updateTemplateVersion(starter.id, {
      brandBundle: {
        ...DEFAULT_BRAND_BUNDLE,
        colors: {
          ...DEFAULT_BRAND_BUNDLE.colors,
          primary: "#0d47a1", // New brand navy blue
        },
        fonts: {
          ...DEFAULT_BRAND_BUNDLE.fonts,
          heading: "SuiteLeaf Modern Display",
        },
      },
    });

    const updatedTpl = manager.getTemplate(starter.id)!;
    expect(updatedTpl.version).toBe(2);

    // Inspect update plan
    const updatePlan = manager.compareDocumentWithTemplate(userDoc);
    expect(updatePlan.currentVersion).toBe(1);
    expect(updatePlan.targetVersion).toBe(2);
    expect(updatePlan.styleChanges).toHaveLength(2);
    expect(updatePlan.styleChanges[0].target).toBe("brand.colors.primary");
    expect(updatePlan.styleChanges[0].incomingValue).toBe("#0d47a1");
    expect(updatePlan.styleChanges[1].target).toBe("brand.fonts.heading");
    expect(updatePlan.styleChanges[1].incomingValue).toBe("SuiteLeaf Modern Display");

    // Absolute guarantee: user-authored content is preserved intact!
    expect(updatePlan.userContentPreserved).toBe(true);
    expect(JSON.stringify(userDoc.content)).toContain("Confidential executive remarks and user-written notes.");
  });

  it("templates survive organization export and work offline when declared ready", () => {
    const manager1 = new OrganizationTemplateManager();
    const starter1 = createExecutiveBriefStarter();
    const starter2 = createPitchDeckStarter();
    manager1.createTemplate(starter1);
    manager1.publishTemplate(starter1.id);
    manager1.createTemplate(starter2);
    manager1.publishTemplate(starter2.id);

    // Export organization templates
    const exportedJson = manager1.exportTemplates();
    expect(exportedJson).toContain(starter1.id);
    expect(exportedJson).toContain(starter2.id);

    // Import into fresh manager / clean cluster
    const manager2 = new OrganizationTemplateManager();
    const importedCount = manager2.importTemplates(exportedJson);
    expect(importedCount).toBe(2);

    const discovered = manager2.discoverTemplates(adminUser);
    expect(discovered).toHaveLength(2);
    expect(discovered[0].offlineReady).toBe(true);
    expect(discovered[0].brandBundle?.logoSvg).toContain("<svg");
  });
});
