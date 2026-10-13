import { useEffect, useRef } from "react";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "@earendil-works/pi-ai";
import { moveCursor, type Target } from "./cursor";

/** What a SuiteLeaf tool returns to the model. */
export type ToolOutput = string | { text: string; details?: unknown };

/** A tool the agent can call, with the place on screen it acts on. */
export interface SuiteTool<P extends TSchema = TSchema> {
  name: string;
  label: string;
  description: string;
  parameters: P;
  /** Where the agent's pointer goes before the tool runs. */
  target?: (args: Static<P>) => Target | Promise<Target>;
  execute: (args: Static<P>, signal?: AbortSignal) => Promise<ToolOutput> | ToolOutput;
}

export const tool = <P extends TSchema>(def: SuiteTool<P>): SuiteTool => def as unknown as SuiteTool;

/** Thrown by tools for mistakes the model can fix (bad arguments, wrong place). */
export class ToolError extends Error {}

export type AppKind = "home" | "doc" | "sheet" | "slide";

/** One screen of the app that offers tools: home, or an open editor. */
export interface AgentHost {
  kind: AppKind;
  /** Short description of the current state, given to the model with each request. */
  snapshot: () => string;
  tools: SuiteTool[];
}

const hosts = new Map<string, AgentHost>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** Tools that work everywhere (navigation, files, servers), registered by the app shell. */
let globalHost: AgentHost | undefined;

export function registerGlobalHost(host: AgentHost) {
  globalHost = host;
  changed();
  return () => {
    if (globalHost === host) globalHost = undefined;
    changed();
  };
}

export function registerAgentHost(id: string, host: AgentHost) {
  hosts.set(id, host);
  changed();
  return () => {
    if (hosts.get(id) === host) hosts.delete(id);
    changed();
  };
}

/** Register a screen's tools while it is mounted. `build` is re-read on every call. */
export function useAgentHost(id: string, build: () => AgentHost) {
  const latest = useRef(build);
  latest.current = build;
  useEffect(
    () =>
      registerAgentHost(id, {
        get kind() {
          return latest.current().kind;
        },
        snapshot: () => latest.current().snapshot(),
        get tools() {
          return latest.current().tools;
        },
      }),
    [id],
  );
}

/** The screen the user is on: an open editor, or home. */
export function activeHost(): AgentHost | undefined {
  const all = [...hosts.values()];
  return all.find((h) => h.kind !== "home") ?? all[0];
}

export function onHostsChanged(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Resolve once a screen of `kind` is registered (after navigation). */
export function waitForHost(kind: AppKind, timeoutMs = 20000): Promise<AgentHost> {
  return new Promise((done, fail) => {
    const check = () => {
      const host = hosts.get(kind === "home" ? "home" : "editor");
      // Editors offer tools only once their engine has started.
      if (host?.kind !== kind || !host.tools.length) return;
      cleanup();
      // Let the editor finish its first layout before tools touch it.
      setTimeout(() => done(host), 400);
    };
    const timer = setTimeout(() => {
      cleanup();
      fail(new ToolError(`The ${kind} screen did not open.`));
    }, timeoutMs);
    const poll = setInterval(check, 150);
    const off = onHostsChanged(check);
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(poll);
      off();
    };
    check();
  });
}

const mounted = () => [...hosts.values(), ...(globalHost ? [globalHost] : [])];

/** The screen that last offered each tool, to explain tools called from the wrong screen. */
const toolScreens = new Map<string, string>();

/** Where a tool that isn't available here was offered: "home", "doc", "sheet", "slide", "workspace" (any open file) or another screen's id. */
export const toolScreen = (name: string) => toolScreens.get(name);

/** Every tool available right now, from every mounted screen. */
export function currentSuiteTools(): SuiteTool[] {
  const seen = new Set<string>();
  const list: SuiteTool[] = [];
  for (const [id, h] of [...hosts.entries(), ...(globalHost ? [["global", globalHost] as const] : [])]) {
    for (const t of h.tools) {
      if (id !== "global") toolScreens.set(t.name, id === "editor" ? h.kind : id);
      if (seen.has(t.name)) continue;
      seen.add(t.name);
      list.push(t);
    }
  }
  return list;
}

export function currentSnapshot() {
  return mounted()
    .map((h) => h.snapshot())
    .filter(Boolean)
    .join("\n");
}

/** A pi tool that moves the agent's pointer to its target, then runs. */
export function toAgentTool(t: SuiteTool): AgentTool {
  return {
    name: t.name,
    label: t.label,
    description: t.description,
    parameters: t.parameters,
    executionMode: "sequential",
    async execute(_id, params, signal) {
      let target: Target;
      try {
        target = await t.target?.(params as never);
      } catch {
        target = undefined;
      }
      await moveCursor(target, t.label);
      const out = await t.execute(params as never, signal);
      const text = typeof out === "string" ? out : out.text;
      return {
        content: [{ type: "text", text }],
        details: typeof out === "string" ? undefined : (out.details as never),
      };
    },
  };
}
