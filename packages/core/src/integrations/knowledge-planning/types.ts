export interface TableColumn {
  name: string;
  type: "string" | "number" | "boolean" | "date" | "ref";
  required?: boolean;
  refTableId?: string;
}

export interface TableSchema {
  id: string;
  name: string;
  columns: TableColumn[];
}

export interface StructuredRecordRelationship {
  targetTableId: string;
  targetRecordId: string;
  relationType: "one_to_one" | "one_to_many";
}

export interface StructuredRecord {
  id: string;
  tableId: string;
  fields: Record<string, unknown>;
  relationships: StructuredRecordRelationship[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";

export interface ProjectTask {
  id: string;
  title: string;
  status: TaskStatus;
  assigneeId?: string;
  dueDate?: string;
  linkedDocumentId?: string;
  linkedSnippet?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BacklinkReference {
  id: string;
  sourceDocumentId: string;
  sourceDocumentTitle: string;
  targetDocumentId: string;
  anchorText: string;
  snippet: string;
}

export interface PortalCategory {
  id: string;
  name: string;
  documentIds: string[];
}

export interface KnowledgePortal {
  id: string;
  title: string;
  description: string;
  categories: PortalCategory[];
  pinnedDocumentIds: string[];
}
