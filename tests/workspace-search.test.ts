import { describe, expect, it } from "vitest";
import {
  createFile,
  type DocFile,
  type SheetFile,
  type SlideFile,
  WorkspaceSearchIndex,
  type PermissionChecker,
} from "../packages/core/src";

describe("WP-026 Permission-aware workspace search and discovery", () => {
  it("indexes authorized content and returns deep links to exact document locations", async () => {
    const index = new WorkspaceSearchIndex();

    // 1. Doc with extra tab
    const doc = createFile("doc", "Engineering Quarterly") as DocFile;
    doc.tabTitle = "Overview";
    doc.content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Mission statement and roadmap." }] }],
    } as any;
    doc.tabs = [
      {
        id: "tab-infrastructure",
        title: "Infrastructure",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Kubernetes cluster migration details." }] }],
        } as any,
      },
    ];

    // 2. Spreadsheet with specific cell
    const sheet = createFile("sheet", "Fiscal Forecast") as SheetFile;
    const wsId = sheet.content.workbook.sheetOrder[0];
    sheet.content.workbook.sheets[wsId].name = "Budget2026";
    sheet.content.workbook.sheets[wsId].cellData = {
      "2": { "1": { v: "TargetRevenue: 50M" } }, // B3
    };

    // 3. Slide deck with slide number
    const slides = createFile("slide", "Product Launch Deck") as SlideFile;
    const sId = slides.content.slideOrder[0];
    slides.content.slides[sId].elements = [
      {
        id: "intro-text",
        type: "text",
        x: 10,
        y: 10,
        width: 400,
        height: 50,
        content: "Announcing Autonomous Workflows",
      },
    ];

    index.indexDocument(doc, {
      fileId: doc.id,
      title: doc.title,
      kind: "doc",
      ownerId: "alice",
      updatedAt: "2026-11-04T10:00:00.000Z",
    });

    index.indexDocument(sheet, {
      fileId: sheet.id,
      title: sheet.title,
      kind: "sheet",
      ownerId: "bob",
      updatedAt: "2026-11-04T11:00:00.000Z",
    });

    index.indexDocument(slides, {
      fileId: slides.id,
      title: slides.title,
      kind: "slide",
      ownerId: "carol",
      updatedAt: "2026-11-04T12:00:00.000Z",
    });

    const allowAll: PermissionChecker = {
      canRead: () => true,
    };

    // Query 1: doc tab target
    const docHits = await index.search("Kubernetes", "user-dave", allowAll);
    expect(docHits).toHaveLength(1);
    expect(docHits[0].fileId).toBe(doc.id);
    expect(docHits[0].snippet).toContain("Kubernetes cluster migration");
    expect(docHits[0].target).toEqual({
      kind: "doc",
      tabId: "tab-infrastructure",
      tabTitle: "Infrastructure",
    });

    // Query 2: sheet cell target
    const sheetHits = await index.search("TargetRevenue", "user-dave", allowAll);
    expect(sheetHits).toHaveLength(1);
    expect(sheetHits[0].fileId).toBe(sheet.id);
    expect(sheetHits[0].target).toEqual({
      kind: "sheet",
      sheetId: wsId,
      sheetName: "Budget2026",
      cell: "B3",
    });

    // Query 3: slide index target
    const slideHits = await index.search("Autonomous", "user-dave", allowAll);
    expect(slideHits).toHaveLength(1);
    expect(slideHits[0].fileId).toBe(slides.id);
    expect(slideHits[0].target).toEqual({
      kind: "slide",
      slideId: sId,
      slideIndex: 1,
    });
  });

  it("enforces permission checks and immediately revokes discoverability without leaking match counts", async () => {
    const index = new WorkspaceSearchIndex();

    const confidentialDoc = createFile("doc", "Executive Compensation") as DocFile;
    confidentialDoc.content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Restricted salary benchmarks for 2027." }] }],
    } as any;

    const publicDoc = createFile("doc", "Company Handbook") as DocFile;
    publicDoc.content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Standard salary payment schedule." }] }],
    } as any;

    index.indexDocument(confidentialDoc, {
      fileId: confidentialDoc.id,
      title: confidentialDoc.title,
      kind: "doc",
      ownerId: "exec-board",
      updatedAt: "2026-11-04T08:00:00.000Z",
    });

    index.indexDocument(publicDoc, {
      fileId: publicDoc.id,
      title: publicDoc.title,
      kind: "doc",
      ownerId: "hr-dept",
      updatedAt: "2026-11-04T09:00:00.000Z",
    });

    // Permission state where employee only has access to publicDoc
    const employeePermissions: PermissionChecker = {
      canRead: (_userId, fileId) => fileId === publicDoc.id,
    };

    // Query for "salary" matches BOTH documents internally, but MUST ONLY return publicDoc!
    const employeeHits = await index.search("salary", "employee-eva", employeePermissions);
    expect(employeeHits).toHaveLength(1);
    expect(employeeHits[0].fileId).toBe(publicDoc.id);
    expect(employeeHits[0].snippet).toContain("Standard salary payment schedule");

    // Board member with access to both sees both
    const boardPermissions: PermissionChecker = {
      canRead: () => true,
    };
    const boardHits = await index.search("salary", "board-member", boardPermissions);
    expect(boardHits).toHaveLength(2);

    // Permission revocation: revoke employee access to publicDoc
    const revokedPermissions: PermissionChecker = {
      canRead: () => false,
    };
    const revokedHits = await index.search("salary", "employee-eva", revokedPermissions);
    // Immediately empty! No hits, no leak of confidential or public info.
    expect(revokedHits).toEqual([]);
  });

  it("reconciles deleted files, moved/renamed files, and index rebuilds without mutating document content", async () => {
    const index = new WorkspaceSearchIndex();
    const doc = createFile("doc", "Original Draft") as DocFile;
    doc.content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Unchanged original document text." }] }],
    } as any;

    index.indexDocument(doc, {
      fileId: doc.id,
      title: "Original Draft",
      kind: "doc",
      ownerId: "author-1",
      folderId: "folder-drafts",
      folderName: "Drafts",
      updatedAt: "2026-11-01T00:00:00.000Z",
    });

    const allowAll: PermissionChecker = { canRead: () => true };

    // Move & Rename document
    doc.title = "Final Published Architecture";
    index.indexDocument(doc, {
      fileId: doc.id,
      title: "Final Published Architecture",
      kind: "doc",
      ownerId: "author-1",
      folderId: "folder-published",
      folderName: "Published",
      updatedAt: "2026-11-04T12:00:00.000Z",
    });

    const hitsAfterRename = await index.search("Published Architecture", "user", allowAll);
    expect(hitsAfterRename).toHaveLength(1);
    expect(hitsAfterRename[0].folderName).toBe("Published");

    // Old name no longer matches title
    const oldHits = await index.search("Original Draft", "user", allowAll);
    expect(oldHits).toEqual([]);

    // Delete file
    expect(index.removeDocument(doc.id)).toBe(true);
    const hitsAfterDelete = await index.search("Unchanged original", "user", allowAll);
    expect(hitsAfterDelete).toEqual([]);

    // Rebuild index test: original document object must not be mutated
    const beforeContent = JSON.stringify(doc.content);
    index.rebuildIndex([
      {
        file: doc,
        meta: {
          fileId: doc.id,
          title: doc.title,
          kind: "doc",
          ownerId: "author-1",
          updatedAt: "2026-11-04T15:00:00.000Z",
        },
      },
    ]);
    expect(JSON.stringify(doc.content)).toBe(beforeContent);

    const hitsAfterRebuild = await index.search("Unchanged original", "user", allowAll);
    expect(hitsAfterRebuild).toHaveLength(1);
    expect(hitsAfterRebuild[0].fileId).toBe(doc.id);

    // Saved searches
    const saved = index.saveSearch("user-1", "Architecture Query", "Unchanged original", { kinds: ["doc"] });
    expect(saved.name).toBe("Architecture Query");
    expect(index.getSavedSearches("user-1")).toHaveLength(1);
  });
});
