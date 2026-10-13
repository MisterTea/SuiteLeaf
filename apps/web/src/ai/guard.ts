// Guardrails around what the assistant does: it asks before destructive
// actions the request didn't ask for, it can only undo its own changes, and
// every request leaves a list of changed files that one click puts back.
import type { FileRecord } from "@suiteleaf/core";
import { storage } from "../storage";

/** The request the assistant is working on now. */
let request = { id: 0, text: "" };
export const currentRequest = () => request;
export function startRequest(text: string) {
  request = { id: request.id + 1, text };
}

/** True when the request's own words ask for this kind of action (`intent`). */
export const requested = (intent: RegExp) => intent.test(request.text);

// ---- Approvals --------------------------------------------------------------

export interface Approval {
  id: number;
  question: string;
  resolve: (ok: boolean) => void;
}

let pending: Approval | null = null;
let nextApproval = 1;
const approvalListeners = new Set<() => void>();
const approvalsChanged = () => approvalListeners.forEach((l) => l());

export const approvalStore = {
  get: () => pending,
  subscribe(listener: () => void) {
    approvalListeners.add(listener);
    return () => void approvalListeners.delete(listener);
  },
};

/** Ask the user in the AI panel. Resolves false if they decline, stop the assistant, or time runs out. */
export function requestApproval(question: string, timeoutMs = 300_000): Promise<boolean> {
  pending?.resolve(false);
  return new Promise((done) => {
    const timer = setTimeout(() => finish(false), timeoutMs);
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      if (pending?.id === approval.id) {
        pending = null;
        approvalsChanged();
      }
      done(ok);
    };
    const approval: Approval = { id: nextApproval++, question, resolve: finish };
    pending = approval;
    approvalsChanged();
  });
}

export const cancelApproval = () => pending?.resolve(false);

// ---- Undo baselines ---------------------------------------------------------

const baselines = new WeakMap<object, { request: number; depth: number; snapshot?: unknown }>();

/**
 * Remember an editor's undo depth, and optionally its content, before the
 * request's first change. Hosts call it before every tool runs; only the
 * first call in a request counts.
 */
export function markBaseline(editor: object, depth: number, snapshot?: () => unknown) {
  if (baselines.get(editor)?.request !== request.id) baselines.set(editor, { request: request.id, depth, snapshot: snapshot?.() });
}

/** Undo steps that are the assistant's own in this request (0 when none are). */
export function ownUndoSteps(editor: object, depth: number) {
  const base = baselines.get(editor);
  return base?.request === request.id ? Math.max(0, depth - base.depth) : 0;
}

/** The editor's content when this request first touched it, or undefined if it hasn't. */
export function baselineSnapshot<T>(editor: object): T | undefined {
  const base = baselines.get(editor);
  return base?.request === request.id ? (base.snapshot as T) : undefined;
}

// ---- Checkpoints ------------------------------------------------------------

export interface FileChange {
  kind: "created" | "changed" | "removed";
  title: string;
  /** SuiteDrive files are not put back by undo. */
  drive: boolean;
}

export interface Checkpoint {
  /** Files that differ from the start of the request. */
  changes(): Promise<FileChange[]>;
  /** Put the library back as it was at the start of the request. */
  restore(): Promise<string>;
}

const stamp = (r: FileRecord) => `${r.file.updatedAt}|${r.file.title}`;

/** Snapshot the local library so the request's file changes can be listed and undone. */
export async function takeCheckpoint(): Promise<Checkpoint> {
  const before = new Map((await storage.list()).map((r) => [r.file.id, structuredClone(r)]));
  let after: Map<string, FileRecord> | undefined;
  const changes = async () => {
    after = new Map((await storage.list()).map((r) => [r.file.id, r]));
    const list: FileChange[] = [];
    for (const [id, r] of after) {
      const old = before.get(id);
      if (!old) list.push({ kind: "created", title: r.file.title, drive: !!r.drive });
      else if (stamp(old) !== stamp(r)) list.push({ kind: "changed", title: r.file.title, drive: !!r.drive });
    }
    for (const [id, r] of before) if (!after.has(id)) list.push({ kind: "removed", title: r.file.title, drive: !!r.drive });
    return list;
  };
  return {
    changes,
    async restore() {
      // Leave the editor first, so its autosave can't write over the restored file.
      if (location.hash !== "#/") {
        location.hash = "#/";
        await new Promise((r) => setTimeout(r, 1200));
      }
      const now = new Map((await storage.list()).map((r) => [r.file.id, r]));
      const skipped: string[] = [];
      let restored = 0;
      for (const [id, r] of now) {
        const old = before.get(id);
        if (old && stamp(old) === stamp(r)) continue;
        if (r.drive || old?.drive) {
          skipped.push(r.file.title);
          continue;
        }
        if (old) await storage.save(old);
        else await storage.remove(id);
        restored++;
      }
      for (const [id, old] of before)
        if (!now.has(id)) {
          if (old.drive) skipped.push(old.file.title);
          else {
            await storage.save(old);
            restored++;
          }
        }
      window.dispatchEvent(new Event("suiteleaf:library-changed"));
      return `Put back ${restored} file(s) as they were before.${skipped.length ? ` SuiteDrive files are not undone here: ${skipped.join(", ")}.` : ""}`;
    },
  };
}
