import type {
  BacklinkReference,
  KnowledgePortal,
  ProjectTask,
  StructuredRecord,
  TableSchema,
} from "./types";

export type PermissionChecker = (documentId: string, userId: string) => boolean;

export class KnowledgePlanningService {
  private tasks: Map<string, ProjectTask> = new Map();
  private backlinks: BacklinkReference[] = [];
  private portals: Map<string, KnowledgePortal> = new Map();
  private schemas: Map<string, TableSchema> = new Map();
  private records: Map<string, StructuredRecord> = new Map(); // recordId -> record
  private permissionChecker: PermissionChecker;

  constructor(options: { permissionChecker?: PermissionChecker } = {}) {
    this.permissionChecker = options.permissionChecker ?? (() => true);
  }

  setPermissionChecker(checker: PermissionChecker) {
    this.permissionChecker = checker;
  }

  // --- Task Workflow ---

  createTask(params: {
    title: string;
    assigneeId?: string;
    dueDate?: string;
    linkedDocumentId?: string;
    linkedSnippet?: string;
  }): ProjectTask {
    const id = `task_${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();
    const task: ProjectTask = {
      id,
      title: params.title,
      status: "todo",
      assigneeId: params.assigneeId,
      dueDate: params.dueDate,
      linkedDocumentId: params.linkedDocumentId,
      linkedSnippet: params.linkedSnippet,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    return task;
  }

  updateTaskStatus(taskId: string, status: ProjectTask["status"]): ProjectTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found.`);
    task.status = status;
    task.updatedAt = new Date().toISOString();
    return task;
  }

  getTaskPreviewForUser(taskId: string, userId: string): ProjectTask & { accessDenied: boolean } {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found.`);

    if (task.linkedDocumentId && !this.permissionChecker(task.linkedDocumentId, userId)) {
      // Redact confidential document snippet to prevent data leakage!
      return {
        ...task,
        linkedSnippet: "[Restricted document content]",
        accessDenied: true,
      };
    }

    return { ...task, accessDenied: false };
  }

  // --- Backlink / Notes Workflow ---

  addBacklink(ref: Omit<BacklinkReference, "id">): BacklinkReference {
    const id = `bkl_${Math.random().toString(36).slice(2, 9)}`;
    const full: BacklinkReference = { ...ref, id };
    this.backlinks.push(full);
    return full;
  }

  getBacklinksForDocument(
    targetDocumentId: string,
    userId: string,
  ): Array<BacklinkReference & { contentRedacted: boolean }> {
    return this.backlinks
      .filter((b) => b.targetDocumentId === targetDocumentId)
      .map((b) => {
        const canViewSource = this.permissionChecker(b.sourceDocumentId, userId);
        if (!canViewSource) {
          return {
            ...b,
            snippet: "[Restricted source snippet]",
            sourceDocumentTitle: "[Restricted document]",
            contentRedacted: true,
          };
        }
        return {
          ...b,
          contentRedacted: false,
        };
      });
  }

  // --- Knowledge Portal Workflow ---

  createPortal(portal: KnowledgePortal): KnowledgePortal {
    this.portals.set(portal.id, portal);
    return portal;
  }

  getPortalViewForUser(
    portalId: string,
    userId: string,
  ): {
    id: string;
    title: string;
    description: string;
    pinnedDocumentIds: string[];
    categories: Array<{ id: string; name: string; visibleDocumentIds: string[] }>;
  } {
    const portal = this.portals.get(portalId);
    if (!portal) throw new Error(`Portal ${portalId} not found.`);

    const visiblePinned = portal.pinnedDocumentIds.filter((docId) => this.permissionChecker(docId, userId));
    const visibleCategories = portal.categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      visibleDocumentIds: cat.documentIds.filter((docId) => this.permissionChecker(docId, userId)),
    }));

    return {
      id: portal.id,
      title: portal.title,
      description: portal.description,
      pinnedDocumentIds: visiblePinned,
      categories: visibleCategories,
    };
  }

  // --- Structured Records (Lightweight Database) ---

  registerTableSchema(schema: TableSchema): TableSchema {
    this.schemas.set(schema.id, schema);
    return schema;
  }

  insertRecord(tableId: string, fields: Record<string, unknown>, id?: string): StructuredRecord {
    const schema = this.schemas.get(tableId);
    if (!schema) throw new Error(`Table schema ${tableId} not found.`);

    // Validate fields against schema
    this.validateFields(schema, fields);

    const recordId = id ?? `rec_${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();
    const record: StructuredRecord = {
      id: recordId,
      tableId,
      fields,
      relationships: [],
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    this.records.set(recordId, record);
    return record;
  }

  linkRelationship(params: {
    sourceRecordId: string;
    targetTableId: string;
    targetRecordId: string;
    relationType: "one_to_one" | "one_to_many";
  }) {
    const record = this.records.get(params.sourceRecordId);
    if (!record) throw new Error(`Record ${params.sourceRecordId} not found.`);
    const target = this.records.get(params.targetRecordId);
    if (!target) throw new Error(`Target record ${params.targetRecordId} not found.`);

    record.relationships.push({
      targetTableId: params.targetTableId,
      targetRecordId: params.targetRecordId,
      relationType: params.relationType,
    });
    record.updatedAt = new Date().toISOString();
  }

  getRecord(id: string): StructuredRecord | undefined {
    return this.records.get(id);
  }

  exportTableRecords(tableId: string): string {
    const records = Array.from(this.records.values()).filter((r) => r.tableId === tableId);
    return JSON.stringify(records, null, 2);
  }

  importTableRecords(tableId: string, jsonText: string): number {
    const schema = this.schemas.get(tableId);
    if (!schema) throw new Error(`Table schema ${tableId} not found.`);

    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) throw new Error("Expected an array of records.");

    let count = 0;
    for (const item of parsed) {
      this.validateFields(schema, item.fields);
      this.records.set(item.id, {
        ...item,
        tableId,
        version: (item.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      });
      count++;
    }
    return count;
  }

  private validateFields(schema: TableSchema, fields: Record<string, unknown>) {
    for (const col of schema.columns) {
      const val = fields[col.name];
      if (col.required && (val === undefined || val === null || val === "")) {
        throw new Error(`Column '${col.name}' is required.`);
      }
      if (val !== undefined && val !== null) {
        if (col.type === "number" && typeof val !== "number") {
          throw new Error(`Column '${col.name}' must be a number.`);
        }
        if (col.type === "boolean" && typeof val !== "boolean") {
          throw new Error(`Column '${col.name}' must be a boolean.`);
        }
        if (col.type === "string" && typeof val !== "string") {
          throw new Error(`Column '${col.name}' must be a string.`);
        }
      }
    }
  }
}
