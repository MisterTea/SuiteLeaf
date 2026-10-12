import { createContext, useContext } from "react";
import { appModeSchema, type AppMode } from "@suiteleaf/core";

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

async function nodeInfo(url: string): Promise<NodeInfo | null> {
  try {
    const response = await fetch(`${url}/api/node/info`);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** Validate a SuiteLeaf server address and return its normalized form. */
export async function probeServer(input: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(
      "Enter a server address such as https://suiteleaf.example.com.",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("Use an http:// or https:// address.");
  const server = url.origin + url.pathname.replace(/\/+$/, "");
  const info = await nodeInfo(server);
  if (info?.name !== "SuiteLeaf node" || info.mode !== "cluster")
    throw new Error("No SuiteLeaf server answered at that address.");
  if (!info.auth?.enabled)
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
    const info = await nodeInfo(location.origin);
    if (info?.name === "SuiteLeaf node" && info.mode === "cluster")
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
  if (window.suiteleaf?.setMode) return window.suiteleaf.setMode(mode);
  if (mode.kind === "single") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(mode));
  location.hash = "#/";
  location.reload();
}

export const ModeContext = createContext<ResolvedMode>({
  mode: { kind: "single" },
  locked: false,
  demo: false,
});
export const useMode = () => useContext(ModeContext);
