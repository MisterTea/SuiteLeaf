import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { MigrationSourceType, SourceItem, SourcePermission } from "./types";

export interface SourceInventoryPage {
  items: SourceItem[];
  nextCursor?: string;
}

export interface MigrationSourceAdapter {
  readonly sourceType: MigrationSourceType;
  authenticate(): Promise<boolean>;
  listInventory(cursor?: string): Promise<SourceInventoryPage>;
  getItemContent(item: SourceItem): Promise<{ bytes: Uint8Array; mimeType: string }>;
  getPermissions(itemId: string): Promise<SourcePermission[]>;
}

export interface GoogleDriveAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  tokenExpiresAt?: number;
}

export interface SharePointAuthConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  driveId: string;
  accessToken?: string;
  tokenExpiresAt?: number;
}

/**
 * Exponential backoff helper with retry handling for 429 rate-limiting.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    initialDelayMs?: number;
    backoffFactor?: number;
  } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  let delay = options.initialDelayMs ?? 100;
  const factor = options.backoffFactor ?? 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err: unknown) {
      const isRateLimit =
        err instanceof Error &&
        (err.message.includes("429") ||
          err.message.includes("rateLimitExceeded") ||
          err.message.includes("throttled"));
      if (!isRateLimit || attempt === maxRetries) {
        throw err;
      }
      const jitter = Math.random() * 50;
      await new Promise((r) => setTimeout(r, delay + jitter));
      delay *= factor;
    }
  }
  throw new Error("Retry failed");
}

export class GoogleDriveAdapter implements MigrationSourceAdapter {
  readonly sourceType: MigrationSourceType = "google-drive";
  private authConfig: GoogleDriveAuthConfig;
  private mockStore: Map<string, { item: SourceItem; data: Uint8Array }> = new Map();
  private rateLimitNextCall = false;

  constructor(authConfig: GoogleDriveAuthConfig) {
    this.authConfig = { ...authConfig };
  }

  /** For testing rate limits and token refresh */
  setRateLimitTrigger(trigger: boolean) {
    this.rateLimitNextCall = trigger;
  }

  setMockFiles(items: Array<{ item: SourceItem; data: Uint8Array }>) {
    this.mockStore.clear();
    for (const entry of items) {
      this.mockStore.set(entry.item.id, entry);
    }
  }

  async authenticate(): Promise<boolean> {
    const now = Date.now();
    if (!this.authConfig.accessToken || (this.authConfig.tokenExpiresAt && this.authConfig.tokenExpiresAt <= now)) {
      // Simulate token refresh
      this.authConfig.accessToken = `ya29.refreshed_${Math.random().toString(36).slice(2)}`;
      this.authConfig.tokenExpiresAt = now + 3600 * 1000;
    }
    return Boolean(this.authConfig.accessToken);
  }

  async listInventory(cursor?: string): Promise<SourceInventoryPage> {
    await this.authenticate();
    if (this.rateLimitNextCall) {
      this.rateLimitNextCall = false;
      throw new Error("429: rateLimitExceeded. User Rate Limit Exceeded.");
    }
    const allItems = Array.from(this.mockStore.values()).map((v) => v.item);
    const pageSize = 50;
    const startIndex = cursor ? parseInt(cursor, 10) : 0;
    const pageItems = allItems.slice(startIndex, startIndex + pageSize);
    const nextIndex = startIndex + pageSize;
    return {
      items: pageItems,
      nextCursor: nextIndex < allItems.length ? String(nextIndex) : undefined,
    };
  }

  async getItemContent(item: SourceItem): Promise<{ bytes: Uint8Array; mimeType: string }> {
    return retryWithBackoff(async () => {
      await this.authenticate();
      if (this.rateLimitNextCall) {
        this.rateLimitNextCall = false;
        throw new Error("429: rateLimitExceeded. Please back off.");
      }
      const entry = this.mockStore.get(item.id);
      if (!entry) {
        throw new Error(`Google Drive item ${item.id} not found.`);
      }

      // Convert Google Docs / Sheets / Slides mime-types to Office formats
      let exportMime = item.mimeType;
      if (item.mimeType === "application/vnd.google-apps.document") {
        exportMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      } else if (item.mimeType === "application/vnd.google-apps.spreadsheet") {
        exportMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      } else if (item.mimeType === "application/vnd.google-apps.presentation") {
        exportMime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      }

      return {
        bytes: entry.data,
        mimeType: exportMime,
      };
    });
  }

  async getPermissions(itemId: string): Promise<SourcePermission[]> {
    const entry = this.mockStore.get(itemId);
    return entry?.item.permissions ?? [];
  }
}

export class SharePointAdapter implements MigrationSourceAdapter {
  readonly sourceType: MigrationSourceType = "sharepoint";
  private authConfig: SharePointAuthConfig;
  private mockStore: Map<string, { item: SourceItem; data: Uint8Array }> = new Map();
  private throttleNextCall = false;

  constructor(authConfig: SharePointAuthConfig) {
    this.authConfig = { ...authConfig };
  }

  setThrottleTrigger(trigger: boolean) {
    this.throttleNextCall = trigger;
  }

  setMockFiles(items: Array<{ item: SourceItem; data: Uint8Array }>) {
    this.mockStore.clear();
    for (const entry of items) {
      this.mockStore.set(entry.item.id, entry);
    }
  }

  async authenticate(): Promise<boolean> {
    const now = Date.now();
    if (!this.authConfig.accessToken || (this.authConfig.tokenExpiresAt && this.authConfig.tokenExpiresAt <= now)) {
      this.authConfig.accessToken = `ms_graph_${Math.random().toString(36).slice(2)}`;
      this.authConfig.tokenExpiresAt = now + 3600 * 1000;
    }
    return Boolean(this.authConfig.accessToken);
  }

  async listInventory(cursor?: string): Promise<SourceInventoryPage> {
    await this.authenticate();
    if (this.throttleNextCall) {
      this.throttleNextCall = false;
      throw new Error("429: throttled. Microsoft Graph rate limit reached.");
    }
    const allItems = Array.from(this.mockStore.values()).map((v) => v.item);
    const pageSize = 50;
    const startIndex = cursor ? parseInt(cursor, 10) : 0;
    const pageItems = allItems.slice(startIndex, startIndex + pageSize);
    const nextIndex = startIndex + pageSize;
    return {
      items: pageItems,
      nextCursor: nextIndex < allItems.length ? String(nextIndex) : undefined,
    };
  }

  async getItemContent(item: SourceItem): Promise<{ bytes: Uint8Array; mimeType: string }> {
    return retryWithBackoff(async () => {
      await this.authenticate();
      if (this.throttleNextCall) {
        this.throttleNextCall = false;
        throw new Error("429: throttled. Retry-After: 1");
      }
      const entry = this.mockStore.get(item.id);
      if (!entry) {
        throw new Error(`SharePoint item ${item.id} not found.`);
      }
      return {
        bytes: entry.data,
        mimeType: item.mimeType,
      };
    });
  }

  async getPermissions(itemId: string): Promise<SourcePermission[]> {
    const entry = this.mockStore.get(itemId);
    return entry?.item.permissions ?? [];
  }
}

export class LocalDirectoryAdapter implements MigrationSourceAdapter {
  readonly sourceType: MigrationSourceType = "local";
  private items: Map<string, { item: SourceItem; data: Uint8Array }> = new Map();

  constructor(files: Array<{ path: string; name: string; data: Uint8Array; mimeType: string }>) {
    for (const f of files) {
      const hash = bytesToHex(sha256(f.data));
      const id = "local_" + bytesToHex(sha256(new TextEncoder().encode(f.path))).slice(0, 16);
      const item: SourceItem = {
        id,
        name: f.name,
        path: f.path,
        type: "file",
        mimeType: f.mimeType,
        size: f.data.byteLength,
        contentHash: hash,
        modifiedTime: new Date().toISOString(),
        permissions: [
          {
            principal: { id: "local_user", email: "user@local", type: "user" },
            role: "owner",
            inherited: false,
          },
        ],
      };
      this.items.set(id, { item, data: f.data });
    }
  }

  async authenticate(): Promise<boolean> {
    return true;
  }

  async listInventory(): Promise<SourceInventoryPage> {
    return {
      items: Array.from(this.items.values()).map((v) => v.item),
    };
  }

  async getItemContent(item: SourceItem): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const entry = this.items.get(item.id);
    if (!entry) throw new Error(`Local item ${item.id} not found`);
    return { bytes: entry.data, mimeType: item.mimeType };
  }

  async getPermissions(itemId: string): Promise<SourcePermission[]> {
    return this.items.get(itemId)?.item.permissions ?? [];
  }
}
