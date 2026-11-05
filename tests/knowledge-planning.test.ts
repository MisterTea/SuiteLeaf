import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_PLANNING_PRODUCT_MATRIX,
  KnowledgePlanningService,
  type TableSchema,
} from "../packages/core/src/integrations/knowledge-planning";

describe("WP-038: Knowledge, Portals, and Structured-Work Integrations", () => {
  it("task previews do not leak restricted document content to unauthorized users", () => {
    // Permission map: user_alice has access to doc_secret, user_bob does NOT
    const userPermissions: Record<string, string[]> = {
      user_alice: ["doc_secret", "doc_public"],
      user_bob: ["doc_public"],
    };
    const service = new KnowledgePlanningService({
      permissionChecker: (docId, userId) => userPermissions[userId]?.includes(docId) ?? false,
    });

    const task = service.createTask({
      title: "Audit Executive Compensation Plan",
      assigneeId: "user_alice",
      dueDate: "2026-12-01",
      linkedDocumentId: "doc_secret",
      linkedSnippet: "Executive bonuses are set at 150% target for 2026.",
    });

    // Alice views task preview -> has permission, sees real snippet
    const alicePreview = service.getTaskPreviewForUser(task.id, "user_alice");
    expect(alicePreview.accessDenied).toBe(false);
    expect(alicePreview.linkedSnippet).toBe("Executive bonuses are set at 150% target for 2026.");

    // Update task status
    service.updateTaskStatus(task.id, "in_progress");
    expect(service.getTaskPreviewForUser(task.id, "user_alice").status).toBe("in_progress");

    // Bob views task preview -> lacks permission, snippet is REDACTED
    const bobPreview = service.getTaskPreviewForUser(task.id, "user_bob");
    expect(bobPreview.accessDenied).toBe(true);
    expect(bobPreview.linkedSnippet).toBe("[Restricted document content]");
    expect(bobPreview.linkedSnippet).not.toContain("Executive bonuses");
  });

  it("backlinks and knowledge portal views respect document permissions without content leakage", () => {
    const service = new KnowledgePlanningService({
      permissionChecker: (docId, userId) => {
        if (docId === "doc_private_memo") return userId === "alice";
        return true;
      },
    });

    // 1. Backlink check
    service.addBacklink({
      sourceDocumentId: "doc_private_memo",
      sourceDocumentTitle: "Private Strategy Memo",
      targetDocumentId: "doc_shared_roadmap",
      anchorText: "Q1 Launch Date",
      snippet: "Targeting confidential launch on March 15th.",
    });

    // Alice sees genuine backlink
    const aliceLinks = service.getBacklinksForDocument("doc_shared_roadmap", "alice");
    expect(aliceLinks[0].contentRedacted).toBe(false);
    expect(aliceLinks[0].sourceDocumentTitle).toBe("Private Strategy Memo");
    expect(aliceLinks[0].snippet).toContain("confidential launch");

    // Bob sees backlink entry with redacted title and snippet
    const bobLinks = service.getBacklinksForDocument("doc_shared_roadmap", "bob");
    expect(bobLinks[0].contentRedacted).toBe(true);
    expect(bobLinks[0].sourceDocumentTitle).toBe("[Restricted document]");
    expect(bobLinks[0].snippet).toBe("[Restricted source snippet]");

    // 2. Knowledge Portal permission filtering
    service.createPortal({
      id: "portal_engineering",
      title: "Engineering Knowledge Hub",
      description: "Architecture, roadmaps, and guides",
      pinnedDocumentIds: ["doc_shared_roadmap", "doc_private_memo"],
      categories: [
        {
          id: "cat_guides",
          name: "Guides",
          documentIds: ["doc_shared_roadmap"],
        },
        {
          id: "cat_confidential",
          name: "Confidential",
          documentIds: ["doc_private_memo"],
        },
      ],
    });

    const bobPortal = service.getPortalViewForUser("portal_engineering", "bob");
    // Pinned docs for Bob excludes doc_private_memo
    expect(bobPortal.pinnedDocumentIds).toEqual(["doc_shared_roadmap"]);
    // Confidential category for Bob has 0 visible documents
    expect(bobPortal.categories.find((c) => c.name === "Confidential")?.visibleDocumentIds).toEqual([]);
  });

  it("structured records round-trip with stable identities and validate column types and relationships", () => {
    const service = new KnowledgePlanningService();

    const customerSchema: TableSchema = {
      id: "table_customers",
      name: "Customers",
      columns: [
        { name: "company", type: "string", required: true },
        { name: "tier", type: "string", required: true },
        { name: "seats", type: "number", required: true },
        { name: "active", type: "boolean" },
      ],
    };
    service.registerTableSchema(customerSchema);

    // Validation check: missing required field fails
    expect(() =>
      service.insertRecord("table_customers", {
        company: "Acme Corp",
        tier: "Enterprise",
        // missing required seats!
      }),
    ).toThrow("Column 'seats' is required.");

    // Validation check: invalid data type fails
    expect(() =>
      service.insertRecord("table_customers", {
        company: "Acme Corp",
        tier: "Enterprise",
        seats: "fifty", // wrong type!
      }),
    ).toThrow("Column 'seats' must be a number.");

    // Successful insert with stable ID
    const record = service.insertRecord(
      "table_customers",
      { company: "Acme Corp", tier: "Enterprise", seats: 150, active: true },
      "rec_acme_001",
    );
    expect(record.id).toBe("rec_acme_001");
    expect(record.fields.company).toBe("Acme Corp");

    // Add order table and relationship
    const orderSchema: TableSchema = {
      id: "table_orders",
      name: "Orders",
      columns: [
        { name: "orderNumber", type: "string", required: true },
        { name: "amount", type: "number", required: true },
      ],
    };
    service.registerTableSchema(orderSchema);
    const orderRecord = service.insertRecord(
      "table_orders",
      { orderNumber: "ORD-991", amount: 25000 },
      "rec_order_991",
    );

    // Link one-to-many relationship
    service.linkRelationship({
      sourceRecordId: record.id,
      targetTableId: "table_orders",
      targetRecordId: orderRecord.id,
      relationType: "one_to_many",
    });

    const updatedCustomer = service.getRecord(record.id)!;
    expect(updatedCustomer.relationships).toHaveLength(1);
    expect(updatedCustomer.relationships[0].targetRecordId).toBe("rec_order_991");

    // Export and Import round-trip preserves stable IDs and data
    const exportedJson = service.exportTableRecords("table_customers");
    expect(exportedJson).toContain("rec_acme_001");

    const importedCount = service.importTableRecords("table_customers", exportedJson);
    expect(importedCount).toBe(1);
    expect(service.getRecord("rec_acme_001")?.fields.seats).toBe(150);
  });

  it("product matrix distinguishes delivered integration workflows from deferred standalone products", () => {
    expect(KNOWLEDGE_PLANNING_PRODUCT_MATRIX).toHaveLength(4);

    const delivered = KNOWLEDGE_PLANNING_PRODUCT_MATRIX.filter(
      (p) => p.status === "delivered_integration",
    );
    expect(delivered).toHaveLength(4);

    for (const item of KNOWLEDGE_PLANNING_PRODUCT_MATRIX) {
      expect(item.deliveredWorkflow).toBeTruthy();
      expect(item.deferredStandaloneProduct).toBeTruthy();
      expect(item.decisionRationale).toBeTruthy();
    }
  });
});
