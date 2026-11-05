import { createFile, serializeFile, type DocFile, type SheetFile } from "../native-file";
import type { AppCredential, AppScope } from "./types";

export interface AuditActionRecord {
  id: string;
  appId: string;
  scopeUsed: AppScope;
  resourceId: string;
  action: string;
  timestamp: string;
}

export class ScopedAutomationClient {
  private credential: AppCredential;
  private auditLog: AuditActionRecord[] = [];

  constructor(credential: AppCredential) {
    this.credential = credential;
  }

  getAuditLog(): AuditActionRecord[] {
    return [...this.auditLog];
  }

  /**
   * Verify scope and resource constraints before performing an action.
   */
  checkAccess(requiredScope: AppScope, resourceId?: string) {
    if (this.credential.status === "revoked") {
      throw new Error("Application credential has been revoked.");
    }

    if (!this.credential.scopes.includes(requiredScope) && !this.credential.scopes.includes("admin")) {
      throw new Error(`Credential lacks required scope '${requiredScope}'.`);
    }

    if (resourceId && this.credential.resourceConstraints?.allowedFileIds) {
      if (!this.credential.resourceConstraints.allowedFileIds.includes(resourceId)) {
        throw new Error(`Credential is not authorized to access resource '${resourceId}'.`);
      }
    }

    this.auditLog.push({
      id: `aud_${Math.random().toString(36).slice(2, 9)}`,
      appId: this.credential.id,
      scopeUsed: requiredScope,
      resourceId: resourceId ?? "global",
      action: `Executed action requiring ${requiredScope}`,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Reference Workflow: Form-to-Document Generation.
   */
  generateDocumentFromForm(
    formResponse: { applicant: string; department: string; comments: string; score: number },
    title = "Form Submission Summary",
  ): DocFile {
    this.checkAccess("files.write");

    const doc = createFile("doc", title) as DocFile;
    doc.content = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: title }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: `Applicant: ${formResponse.applicant} (${formResponse.department})` },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: `Score: ${formResponse.score}/100` }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: `Comments: ${formResponse.comments}` }],
        },
      ],
    };

    return doc;
  }

  /**
   * Reference Workflow: Spreadsheet Query Refresh with idempotency.
   */
  refreshSpreadsheetQuery(
    sheet: SheetFile,
    newData: Array<Array<string | number>>,
    queryId: string,
  ): SheetFile {
    this.checkAccess("files.write", sheet.id);

    const sheetId = sheet.content.workbook.sheetOrder[0];
    const targetWorksheet = sheet.content.workbook.sheets[sheetId];
    if (!targetWorksheet.cellData) {
      targetWorksheet.cellData = {};
    }

    // Populate refreshed query data
    for (let r = 0; r < newData.length; r++) {
      if (!targetWorksheet.cellData[r]) {
        targetWorksheet.cellData[r] = {};
      }
      for (let c = 0; c < newData[r].length; c++) {
        targetWorksheet.cellData[r][c] = { v: newData[r][c] };
      }
    }

    // Record last refreshed query metadata
    targetWorksheet.rowCount = Math.max(targetWorksheet.rowCount ?? 100, newData.length + 10);
    targetWorksheet.columnCount = Math.max(targetWorksheet.columnCount ?? 26, (newData[0]?.length ?? 1) + 2);

    return sheet;
  }
}
