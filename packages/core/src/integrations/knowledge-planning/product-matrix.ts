export interface WorkflowProductEntry {
  area: "tasks" | "notebooks" | "portal" | "database_records";
  capability: string;
  deliveredWorkflow: string;
  deferredStandaloneProduct: string;
  status: "delivered_integration" | "deferred_standalone";
  decisionRationale: string;
}

export const KNOWLEDGE_PLANNING_PRODUCT_MATRIX: WorkflowProductEntry[] = [
  {
    area: "tasks",
    capability: "Project task management & assignments",
    deliveredWorkflow: "Permission-aware task lists with document links, due dates, and assignee notifications",
    deferredStandaloneProduct: "Full Jira / Asana standalone issue tracker clone with sprint boards and custom workflows",
    status: "delivered_integration",
    decisionRationale: "Reuse SuiteLeaf document primitives and webhook integrations rather than operating a dedicated issue tracker.",
  },
  {
    area: "notebooks",
    capability: "Meeting notes, collections & bidirectional linking",
    deliveredWorkflow: "Document tab hierarchies, cross-document backlinks, and meeting template collections",
    deferredStandaloneProduct: "Standalone OneNote / Notion proprietary notebook file format and separate sync protocol",
    status: "delivered_integration",
    decisionRationale: "Extend native document tabs and hyperlinking; avoid bifurcating document storage into a separate notebook store.",
  },
  {
    area: "portal",
    capability: "Team knowledge & document discovery portal",
    deliveredWorkflow: "Permission-filtered knowledge portal views with categories, pinned docs, and deep search",
    deferredStandaloneProduct: "Complex SharePoint intranet portal CMS with web parts and custom page-authoring widgets",
    status: "delivered_integration",
    decisionRationale: "Deliver curated document and search discovery views directly in SuiteDrive without maintaining a separate CMS.",
  },
  {
    area: "database_records",
    capability: "Structured records, form collections & relationships",
    deliveredWorkflow: "Schema-validated structured records with foreign keys, stable IDs, and form-to-sheet sync",
    deferredStandaloneProduct: "Full relational database application builder (Microsoft Access / Google AppSheet / Airtable clone)",
    status: "delivered_integration",
    decisionRationale: "Support lightweight structured records and relational references on top of spreadsheets and forms.",
  },
];
