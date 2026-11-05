import type { Kind, SuiteFile, DocFile, SheetFile, SlideFile } from "../file-schema";

export type SearchTarget =
  | { kind: "doc"; tabId?: string; tabTitle?: string; snippet?: string }
  | { kind: "sheet"; sheetId: string; sheetName: string; cell?: string }
  | { kind: "slide"; slideId: string; slideIndex: number }
  | { kind: "form"; questionId?: string }
  | { kind: "drawing" };

export interface FileMetadata {
  fileId: string;
  title: string;
  kind: Kind;
  ownerId: string;
  folderId?: string;
  folderName?: string;
  updatedAt: string;
  sharedWithUserIds?: string[];
  isTrashed?: boolean;
}

export interface WorkspaceSearchHit {
  fileId: string;
  title: string;
  kind: Kind;
  ownerId: string;
  folderId?: string;
  folderName?: string;
  updatedAt: string;
  snippet: string;
  target?: SearchTarget;
}

export interface SearchFilter {
  kinds?: Kind[];
  ownerId?: string;
  folderId?: string;
  updatedAfter?: string;
  sharedOnly?: boolean;
}

export interface SavedSearch {
  id: string;
  userId: string;
  name: string;
  query: string;
  filter?: SearchFilter;
  createdAt: string;
}

export interface PermissionChecker {
  canRead(userId: string, fileId: string): boolean | Promise<boolean>;
}

export interface IndexedDocumentEntry {
  meta: FileMetadata;
  extractedText: string;
  targets: { text: string; target: SearchTarget }[];
}

/**
 * Extract plain text and deep-linkable targets from a SuiteFile.
 */
export function extractFileSearchIndex(file: SuiteFile): {
  fullText: string;
  targets: { text: string; target: SearchTarget }[];
} {
  const targets: { text: string; target: SearchTarget }[] = [];
  const parts: string[] = [file.title];

  if (file.kind === "doc") {
    const doc = file as DocFile;
    const walk = (node: any): string[] => {
      const texts: string[] = [];
      if (node?.text) texts.push(node.text);
      if (Array.isArray(node?.content)) {
        for (const child of node.content) texts.push(...walk(child));
      }
      return texts;
    };

    const mainText = walk((doc.content as any) ?? {}).join(" ");
    parts.push(mainText);
    targets.push({
      text: mainText,
      target: { kind: "doc", tabTitle: doc.tabTitle ?? "Document" },
    });

    for (const tab of doc.tabs ?? []) {
      const tabText = walk(tab.content ?? {}).join(" ");
      parts.push(tabText);
      targets.push({
        text: tabText,
        target: { kind: "doc", tabId: tab.id, tabTitle: tab.title },
      });
    }
  } else if (file.kind === "sheet") {
    const sheet = file as SheetFile;
    const wb = sheet.content?.workbook;
    if (wb) {
      for (const sheetId of wb.sheetOrder ?? []) {
        const ws = wb.sheets[sheetId];
        if (!ws) continue;
        parts.push(ws.name);

        for (const [rKey, row] of Object.entries(ws.cellData ?? {})) {
          for (const [cKey, cell] of Object.entries(row ?? {})) {
            const v = (cell as any)?.v;
            if (v !== undefined && v !== null && v !== "") {
              const valStr = String(v);
              parts.push(valStr);
              const colLetter = String.fromCharCode(65 + Number(cKey));
              const cellCoord = `${colLetter}${Number(rKey) + 1}`;
              targets.push({
                text: valStr,
                target: { kind: "sheet", sheetId, sheetName: ws.name, cell: cellCoord },
              });
            }
          }
        }
      }
    }
  } else if (file.kind === "slide") {
    const slideFile = file as SlideFile;
    const deck = slideFile.content;
    (deck?.slideOrder ?? []).forEach((id, idx) => {
      const s = deck?.slides[id];
      if (!s) return;
      const slideParts: string[] = [];
      if (s.title) slideParts.push(s.title);
      for (const el of s.elements ?? []) {
        if (el.content) slideParts.push(el.content);
        if (el.rows) {
          for (const row of el.rows) slideParts.push(row.join(" "));
        }
      }
      if (s.notes) slideParts.push(s.notes);
      const slideText = slideParts.join(" ");
      parts.push(slideText);
      targets.push({
        text: slideText,
        target: { kind: "slide", slideId: id, slideIndex: idx + 1 },
      });
    });
  }

  const fullText = parts.join(" ").replace(/\s+/g, " ").trim();
  return { fullText, targets };
}

function createSnippet(text: string, query: string, matchIndex: number): string {
  const start = Math.max(0, text.lastIndexOf(" ", Math.max(0, matchIndex - 30)) + 1);
  const end = Math.min(text.length, matchIndex + query.length + 50);
  const lead = start > 0 ? "…" : "";
  const trail = end < text.length ? "…" : "";
  return `${lead}${text.slice(start, end).trim()}${trail}`;
}

export class WorkspaceSearchIndex {
  private index = new Map<string, IndexedDocumentEntry>();
  private savedSearches = new Map<string, SavedSearch[]>(); // userId -> SavedSearch[]
  private lastIndexedAt: string = new Date().toISOString();

  /**
   * Index or update a document in the search index.
   */
  indexDocument(file: SuiteFile, meta: FileMetadata): void {
    const { fullText, targets } = extractFileSearchIndex(file);
    this.index.set(meta.fileId, {
      meta: { ...meta },
      extractedText: fullText,
      targets,
    });
    this.lastIndexedAt = new Date().toISOString();
  }

  /**
   * Remove a document from the search index (e.g. on deletion).
   */
  removeDocument(fileId: string): boolean {
    const removed = this.index.delete(fileId);
    if (removed) {
      this.lastIndexedAt = new Date().toISOString();
    }
    return removed;
  }

  /**
   * Execute permission-aware workspace search.
   * Checks authorization for every candidate. Restricted files are never returned
   * and never leak their counts into results.
   */
  async search(
    query: string,
    userId: string,
    permissions: PermissionChecker,
    filter?: SearchFilter,
  ): Promise<WorkspaceSearchHit[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const hits: WorkspaceSearchHit[] = [];

    for (const [fileId, entry] of this.index.entries()) {
      const meta = entry.meta;

      // Skip trashed files
      if (meta.isTrashed) continue;

      // Apply metadata filters
      if (filter?.kinds && !filter.kinds.includes(meta.kind)) continue;
      if (filter?.ownerId && meta.ownerId !== filter.ownerId) continue;
      if (filter?.folderId && meta.folderId !== filter.folderId) continue;
      if (filter?.updatedAfter && meta.updatedAt < filter.updatedAfter) continue;
      if (filter?.sharedOnly && (!meta.sharedWithUserIds || meta.sharedWithUserIds.length === 0)) {
        continue;
      }

      // Check text or title match
      const titleMatch = meta.title.toLowerCase().indexOf(q);
      const textMatch = entry.extractedText.toLowerCase().indexOf(q);

      if (titleMatch === -1 && textMatch === -1) continue;

      // Permission check: MUST be authorized before inclusion!
      const canRead = await permissions.canRead(userId, fileId);
      if (!canRead) {
        // Forbidden: omit completely. No match, no count leak.
        continue;
      }

      let snippet = "";
      let target: SearchTarget | undefined;

      if (textMatch !== -1) {
        snippet = createSnippet(entry.extractedText, q, textMatch);
        // Find best matching specific target
        const matchingTarget = entry.targets.find((t) => t.text.toLowerCase().includes(q));
        if (matchingTarget) {
          target = matchingTarget.target;
        }
      } else {
        snippet = meta.title;
      }

      hits.push({
        fileId: meta.fileId,
        title: meta.title,
        kind: meta.kind,
        ownerId: meta.ownerId,
        folderId: meta.folderId,
        folderName: meta.folderName,
        updatedAt: meta.updatedAt,
        snippet,
        target,
      });
    }

    // Sort by most recently updated
    return hits.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Rebuild the entire index from document instances without mutating them.
   */
  rebuildIndex(records: { file: SuiteFile; meta: FileMetadata }[]): void {
    this.index.clear();
    for (const record of records) {
      this.indexDocument(record.file, record.meta);
    }
  }

  /**
   * Save a user search for quick re-use.
   */
  saveSearch(userId: string, name: string, query: string, filter?: SearchFilter): SavedSearch {
    const saved: SavedSearch = {
      id: `saved-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId,
      name,
      query,
      filter,
      createdAt: new Date().toISOString(),
    };

    const list = this.savedSearches.get(userId) ?? [];
    list.push(saved);
    this.savedSearches.set(userId, list);
    return saved;
  }

  getSavedSearches(userId: string): SavedSearch[] {
    return this.savedSearches.get(userId) ?? [];
  }

  getFreshness(): { lastIndexedAt: string; documentCount: number } {
    return {
      lastIndexedAt: this.lastIndexedAt,
      documentCount: this.index.size,
    };
  }
}
