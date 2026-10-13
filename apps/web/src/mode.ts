import { createContext, useContext } from "react";
import { appModeSchema, type AppMode } from "@suiteleaf/core";
import { signOut } from "./node-client";

export interface ResolvedMode {
  mode: AppMode;
  /** The mode comes from how the app is delivered and cannot be switched. */
  locked: boolean;
  /** The public demo: single-node mode with files kept in browser storage. */
  demo: boolean;
}

/** Set by the GitHub Pages build (`VITE_SUITELEAF_DEMO=1`). */
export const isDemo = import.meta.env.VITE_SUITELEAF_DEMO === "1";
const KEY = "suiteleaf:mode";

interface NodeInfo {
  name?: string;
  mode?: string;
  auth?: { enabled?: boolean };
}

function abortAfter(timeout: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(timeout);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeout);
  return controller.signal;
}

async function nodeInfo(
  url: string,
  timeout?: number,
): Promise<NodeInfo | null> {
  try {
    const response = await fetch(`${url}/api/node/info`, {
      signal: timeout ? abortAfter(timeout) : undefined,
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

const isClusterNode = (info: NodeInfo | null) =>
  info?.name === "SuiteLeaf node" && info.mode === "cluster";

/** Validate a SuiteLeaf server address and return its normalized form. An
 * address without a scheme, such as `suiteleaf.example.com`, is tried with
 * https first and then http. */
export async function probeServer(input: string): Promise<string> {
  const text = input.trim();
  const bare = !/^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url: URL;
  try {
    url = new URL(bare ? `https://${text}` : text);
  } catch {
    throw new Error("Enter a server address such as suiteleaf.example.com.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Use an http:// or https:// address.");
  const candidates = [url.origin + url.pathname.replace(/\/+$/, "")];
  if (bare) candidates.push(candidates[0].replace(/^https:/, "http:"));
  let server = "";
  let info: NodeInfo | null = null;
  for (const candidate of candidates) {
    info = await nodeInfo(candidate, 10000);
    server = candidate;
    if (isClusterNode(info)) break;
  }
  if (!isClusterNode(info))
    throw new Error("No SuiteLeaf server answered at that address.");
  if (!info?.auth?.enabled)
    throw new Error(
      "That server's sign-in service is not running yet. Try again shortly.",
    );
  return server;
}

export async function resolveMode(): Promise<ResolvedMode> {
  if (isDemo) return { mode: { kind: "single" }, locked: true, demo: true };
  if (window.suiteleaf?.getMode)
    return {
      mode: await window.suiteleaf.getMode(),
      locked: false,
      demo: false,
    };
  if (location.protocol.startsWith("http")) {
    if (isClusterNode(await nodeInfo(location.origin)))
      return {
        mode: { kind: "cluster", serverUrl: location.origin },
        locked: true,
        demo: false,
      };
  }
  let saved: unknown = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    /* A corrupt preference falls back to single-node mode. */
  }
  const parsed = appModeSchema.safeParse(saved);
  return {
    mode: parsed.success ? parsed.data : { kind: "single" },
    locked: false,
    demo: false,
  };
}

/** Persist a mode and restart the app in it. */
export async function switchMode(mode: AppMode) {
  location.hash = "#/";
  if (window.suiteleaf?.setMode) return window.suiteleaf.setMode(mode);
  if (mode.kind === "single") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(mode));
  location.reload();
}

const LEFT_KEY = "suiteleaf:left-server";
/** Sign out of `serverUrl` and return to single-node mode. */
export async function disconnect(serverUrl: string) {
  await signOut();
  sessionStorage.setItem(LEFT_KEY, new URL(serverUrl).host);
  await switchMode({ kind: "single" });
}
/** The server this window just disconnected from, shown once. */
export function leftServer() {
  return sessionStorage.getItem(LEFT_KEY);
}
export function forgetLeftServer() {
  sessionStorage.removeItem(LEFT_KEY);
}

export const ModeContext = createContext<ResolvedMode>({
  mode: { kind: "single" },
  locked: false,
  demo: false,
});
export const useMode = () => useContext(ModeContext);
