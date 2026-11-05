export type AppScope =
  | "files.read"
  | "files.write"
  | "files.share"
  | "files.export"
  | "forms.read"
  | "forms.submit"
  | "jobs.manage"
  | "admin";

export interface AppCredential {
  id: string;
  name: string;
  clientId: string;
  hashedSecret: string;
  scopes: AppScope[];
  resourceConstraints?: {
    allowedFileIds?: string[];
    allowedFolderIds?: string[];
  };
  status: "active" | "revoked";
  createdAt: string;
  revokedAt?: string;
}

export type WebhookEvent =
  | "file.created"
  | "file.updated"
  | "file.deleted"
  | "form.submitted"
  | "job.completed";

export interface WebhookSubscription {
  id: string;
  url: string;
  events: WebhookEvent[];
  signingSecret: string;
  previousSecret?: string;
  active: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
  signature: string;
  timestamp: number;
  attempts: number;
  status: "pending" | "delivered" | "failed" | "dead_letter";
  lastError?: string;
}

export interface AutomationJob {
  id: string;
  name: string;
  trigger: "scheduled" | "event" | "manual";
  idempotencyKey?: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  dryRun: boolean;
  attempts: number;
  maxAttempts: number;
  params: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  minSuiteLeafVersion: string;
  permissions: AppScope[];
  sandboxed: boolean;
  entryPoint: string;
}
