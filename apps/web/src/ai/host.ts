import { useEffect, useRef } from "react";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "@earendil-works/pi-ai";
import { moveCursor, type Target } from "./cursor";
import { requestApproval, requested } from "./guard";
import { PARSE_ERROR } from "./model-stream";

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
  /** Reshapes the model's raw arguments before schema checks (which would otherwise coerce them in unhelpful ways). */
  prepare?: (args: Record<string, unknown>) => Record<string, unknown>;
  /** The same call does something new each time (e.g. the next slide), so repeating it is not a loop. */
  repeatable?: boolean;
  /**
   * For actions that destroy or overwrite the user's work: the question to ask
   * before running, or undefined when nothing would be lost. Not asked when the
   * request's words match `intent` (the user asked for it).
   */
  confirm?: (args: Static<P>) => string | undefined;
  intent?: RegExp;
  execute: (args: Static<P>, signal?: AbortSignal) => Promise<ToolOutput> | ToolOutput;
}

export const tool = <P extends TSchema>(def: SuiteTool<P>): SuiteTool => def as unknown as SuiteTool;

/** Thrown by tools for mistakes the model can fix (bad arguments, wrong place). */
export class ToolError extends Error {}

export type AppKind = "home" | "doc" | "sheet" | "slide" | "form";

/** One screen of the app that offers tools: home, or an open editor. */
export interface AgentHost {
  kind: AppKind;
  /** Short description of the current state, given to the model with each request. */
  snapshot: () => string;
  /** One line naming the open document, or that none is open. Shown in the assistant panel. */
  place?: () => string;
  tools: SuiteTool[];
  /** Runs before every tool call, e.g. to note the editor's undo depth before the request's first change. */
  beforeTool?: () => void;
  /** Problems the screen can see in the request's changes, checked before the assistant says it is done. */
  review?: () => string[];
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
        place: () => latest.current().place?.() ?? "",
        get tools() {
          return latest.current().tools;
        },
        beforeTool: () => latest.current().beforeTool?.(),
        review: () => latest.current().review?.() ?? [],
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

/** Tools offered on every screen, such as the assistant's checklist. */
const everywhere: SuiteTool[] = [];
export function registerToolEverywhere(t: SuiteTool) {
  if (!everywhere.some((x) => x.name === t.name)) everywhere.push(t);
  changed();
}

/** Every tool available right now, from every mounted screen. */
export function currentSuiteTools(): SuiteTool[] {
  const seen = new Set<string>(everywhere.map((t) => t.name));
  const list: SuiteTool[] = [...everywhere];
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

/** The problems every open screen sees in the request's changes. */
export const currentReview = () => mounted().flatMap((h) => h.review?.() ?? []);

export function currentSnapshot() {
  return mounted()
    .map((h) => h.snapshot())
    .filter(Boolean)
    .join("\n");
}

/** Where the user is, for the assistant panel: the open document, or none. */
export function documentContextLabel() {
  const places = mounted()
    .map((h) => h.place?.() ?? "")
    .filter(Boolean);
  return places.find((p) => p !== "No document open") ?? places[0] ?? "No document open";
}

/**
 * Tool calls can open and close files. Hold the assistant's conversation across
 * those navigations, then release it once React has applied the route change.
 */
let acting = 0;
export function agentIsActing() {
  return acting > 0;
}
export async function whileAgentActs<T>(fn: () => Promise<T>): Promise<T> {
  acting++;
  try {
    return await fn();
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 80));
    acting--;
  }
}

/** A pi tool that moves the agent's pointer to its target, then runs. */
export function toAgentTool(t: SuiteTool): AgentTool {
  return {
    name: t.name,
    label: t.label,
    description: t.description,
    parameters: t.parameters,
    executionMode: "sequential",
    // Runs before schema checks, so an unreadable call is explained, not reported as missing arguments.
    prepareArguments(args) {
      const error = (args as Record<string, unknown> | undefined)?.[PARSE_ERROR];
      if (error) throw new Error(`This tool call could not be read: ${error} Write the call again with valid arguments.`);
      return (t.prepare && args && typeof args === "object" ? t.prepare(args as Record<string, unknown>) : args) as never;
    },
    async execute(_id, params, signal) {
      return whileAgentActs(async () => {
      // Screens rebuild their tools as their state changes (and calls in one
      // turn can change it): once the last change has rendered, run the tool
      // the screen offers now.
      await new Promise((r) => setTimeout(r, 50));
      const live = currentSuiteTools().find((x) => x.name === t.name);
      if (!live) throw new Error(`Tool ${t.name} not found`);
      let target: Target;
      try {
        target = await live.target?.(params as never);
      } catch {
        target = undefined;
      }
      await moveCursor(target, live.label);
      for (const h of mounted()) h.beforeTool?.();
      const question = live.intent && requested(live.intent) ? undefined : live.confirm?.(params as never);
      if (question && !(await requestApproval(question)))
        throw new ToolError(
          `The user answered no to "${question}", so nothing was changed. Don't try it another way; finish the rest of the request, then say what you left alone.`,
        );
      const out = await live.execute(params as never, signal);
      const text = typeof out === "string" ? out : out.text;
      return {
        content: [{ type: "text", text }],
        details: typeof out === "string" ? undefined : (out.details as never),
      };
      });
    },
  };
}
