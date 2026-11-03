/**
 * Three-way merge of a document's top-level blocks.
 * Both inputs are copied into the result before any combined document is
 * offered, so a resolution cannot drop a source version.
 */

import type { JsonNode } from "./index";

export type KeptVersions<T> = {
  local: T;
  remote: T;
};

export type BlockMerge = {
  kept: KeptVersions<JsonNode>;
  merged?: JsonNode;
  reason?: string;
};

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Combine `local` and `remote` when each changed block differs from `base` on only one side.
 * `stack` keeps both copies of a block that both sides changed, local then remote.
 */
export function mergeDocumentBlocks(
  base: JsonNode,
  local: JsonNode,
  remote: JsonNode,
  disputed: "separate" | "stack" = "separate",
): BlockMerge {
  const kept = {
    local: structuredClone(local),
    remote: structuredClone(remote),
  };
  if (base.type !== "doc" || local.type !== "doc" || remote.type !== "doc") {
    return { kept, reason: "Selective merge applies to a document." };
  }
  const baseBlocks = base.content ?? [];
  const localBlocks = local.content ?? [];
  const remoteBlocks = remote.content ?? [];
  const count = Math.max(baseBlocks.length, localBlocks.length, remoteBlocks.length);
  const merged: JsonNode[] = [];
  for (let index = 0; index < count; index++) {
    const baseBlock = baseBlocks[index];
    const localBlock = localBlocks[index];
    const remoteBlock = remoteBlocks[index];
    const localSame = same(localBlock, baseBlock);
    const remoteSame = same(remoteBlock, baseBlock);
    if (localSame && remoteSame) {
      if (baseBlock) merged.push(structuredClone(baseBlock));
      continue;
    }
    if (remoteSame) {
      if (localBlock) merged.push(structuredClone(localBlock));
      continue;
    }
    if (localSame) {
      if (remoteBlock) merged.push(structuredClone(remoteBlock));
      continue;
    }
    if (same(localBlock, remoteBlock) && localBlock) {
      merged.push(structuredClone(localBlock));
      continue;
    }
    if (disputed === "stack") {
      if (localBlock) merged.push(structuredClone(localBlock));
      if (remoteBlock) merged.push(structuredClone(remoteBlock));
      continue;
    }
    return {
      kept,
      reason: `Block ${index + 1} changed in both copies, so they stay separate.`,
    };
  }
  const settings = mergedSettings(base, local, remote, merged);
  if ("reason" in settings) return { kept, reason: settings.reason };
  return { kept, merged: settings.doc };
}

function restAttrs(attrs: JsonNode["attrs"]): Record<string, unknown> | undefined {
  if (!attrs) return undefined;
  const copy = { ...attrs };
  delete copy.commentThreads;
  return Object.keys(copy).length ? copy : undefined;
}

function threadList(attrs: JsonNode["attrs"]): unknown[] {
  const raw = attrs?.commentThreads;
  return Array.isArray(raw) ? raw : [];
}

function threadId(item: unknown): string | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = (item as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id : null;
}

function threadMap(list: unknown[]): Map<string, unknown> | null {
  const map = new Map<string, unknown>();
  for (const item of list) {
    const id = threadId(item);
    if (!id || map.has(id)) return null;
    map.set(id, item);
  }
  return map;
}

/** Comments with their own ids combine. A thread both copies rewrote stays separate. */
function mergeThreads(base: unknown[], local: unknown[], remote: unknown[]): unknown[] | null {
  const baseMap = threadMap(base);
  const localMap = threadMap(local);
  const remoteMap = threadMap(remote);
  if (!baseMap || !localMap || !remoteMap) return null;
  const order = [...baseMap.keys()];
  for (const id of localMap.keys()) if (!order.includes(id)) order.push(id);
  for (const id of remoteMap.keys()) if (!order.includes(id)) order.push(id);
  const merged: unknown[] = [];
  for (const id of order) {
    const baseItem = baseMap.get(id);
    const localItem = localMap.get(id);
    const remoteItem = remoteMap.get(id);
    const localSame = same(localItem, baseItem);
    const remoteSame = same(remoteItem, baseItem);
    if (localSame && remoteSame) {
      if (baseItem !== undefined) merged.push(baseItem);
    } else if (remoteSame) {
      if (localItem !== undefined) merged.push(localItem);
    } else if (localSame) {
      if (remoteItem !== undefined) merged.push(remoteItem);
    } else if (same(localItem, remoteItem) && localItem !== undefined) merged.push(localItem);
    else return null;
  }
  return merged;
}

function chosen<T>(base: T, local: T, remote: T): T | "conflict" {
  const localSame = same(local, base);
  const remoteSame = same(remote, base);
  if (localSame && remoteSame) return base;
  if (remoteSame) return local;
  if (localSame) return remote;
  if (same(local, remote)) return local;
  return "conflict";
}

/** Keep document settings from the side that changed them. Comments with different ids combine. */
function mergedSettings(
  base: JsonNode,
  local: JsonNode,
  remote: JsonNode,
  content: JsonNode[],
): { doc: JsonNode } | { reason: string } {
  const rest = chosen(restAttrs(base.attrs), restAttrs(local.attrs), restAttrs(remote.attrs));
  if (rest === "conflict") {
    return { reason: "Document settings changed in both copies, so they stay separate." };
  }
  const baseThreads = threadList(base.attrs);
  const localThreads = threadList(local.attrs);
  const remoteThreads = threadList(remote.attrs);
  const picked = chosen(baseThreads, localThreads, remoteThreads);
  const threads = picked === "conflict" ? mergeThreads(baseThreads, localThreads, remoteThreads) : picked;
  if (!threads) return { reason: "Document settings changed in both copies, so they stay separate." };
  const attrs: Record<string, unknown> = { ...(rest ?? {}) };
  const hadThreads = [base, local, remote].some((doc) => Array.isArray(doc.attrs?.commentThreads));
  if (threads.length || hadThreads) attrs.commentThreads = structuredClone(threads);
  const doc: JsonNode = { type: "doc", content };
  if (Object.keys(attrs).length) doc.attrs = attrs;
  return { doc };
}
