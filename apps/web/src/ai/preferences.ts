import { AI_MODELS, type AiModelId } from "@suiteleaf/core/ai";

const PLACE = "suiteleaf.ai.place";
const MODEL = "suiteleaf.ai.model";
const ENDPOINT = "suiteleaf.ai.endpoint";
const API_KEY = "suiteleaf.ai.apiKey";

export const DEFAULT_MODEL = "frognano-4b";

/** Where the assistant runs outside serverless mode. */
export type AiPlace = "server" | "remote";

export interface AiPreferences {
  place: AiPlace;
  /** Model id sent to a server or a remote endpoint. FrogNano unless the user chooses another. */
  model: string;
  /** OpenAI-compatible base URL, used when `place` is `remote`. */
  endpoint: string;
  /** Optional bearer token for the remote endpoint. Kept in this browser. */
  apiKey: string;
}

const listeners = new Set<() => void>();
let snapshot = load();

function stored(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function load(): AiPreferences {
  const place = stored(PLACE);
  const model = stored(MODEL).trim();
  return {
    place: place === "remote" ? "remote" : "server",
    model: model || DEFAULT_MODEL,
    endpoint: stored(ENDPOINT).trim(),
    apiKey: stored(API_KEY),
  };
}

export function readAiPreferences(): AiPreferences {
  return snapshot;
}

/** The model name the user chose, or FrogNano. */
export function readModelName(): string {
  return snapshot.model || DEFAULT_MODEL;
}

/** A built-in model id, when the chosen name is one this app runs itself. */
export function knownModel(): AiModelId {
  const name = readModelName();
  return name in AI_MODELS ? (name as AiModelId) : DEFAULT_MODEL;
}

export function writeAiPreferences(next: Partial<AiPreferences>) {
  snapshot = { ...snapshot, ...next };
  if (next.model !== undefined) snapshot.model = next.model.trim();
  if (next.endpoint !== undefined) snapshot.endpoint = next.endpoint.trim();
  if (next.place !== undefined) snapshot.place = next.place === "remote" ? "remote" : "server";
  try {
    localStorage.setItem(PLACE, snapshot.place);
    localStorage.setItem(MODEL, snapshot.model || DEFAULT_MODEL);
    localStorage.setItem(ENDPOINT, snapshot.endpoint);
    if (snapshot.apiKey) localStorage.setItem(API_KEY, snapshot.apiKey);
    else localStorage.removeItem(API_KEY);
  } catch {
    // Private mode can refuse storage; the choice still applies until reload.
  }
  listeners.forEach((listener) => listener());
}

export function onAiPreferencesChanged(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Tests and a fresh page start from what is stored now. */
export function reloadAiPreferences() {
  snapshot = load();
  listeners.forEach((listener) => listener());
}
