import type { AiPlace } from "./preferences";

export type OrgAssistantPolicy = {
  assistant: "off" | "local" | "remote";
  providers: string[];
  maxTokens: number;
};

const SECRET_KEYS = new Set([
  "password",
  "secret",
  "clientsecret",
  "token",
  "apikey",
  "credential",
  "accesstoken",
]);

/** An organization policy. A secret field is refused and is not returned. */
export function readOrgAssistantPolicy(raw: unknown): OrgAssistantPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("The organization policy is not a policy.");
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (SECRET_KEYS.has(key.toLowerCase().replace(/[-_]/g, ""))) {
      throw new Error("The organization policy does not store a secret.");
    }
  }
  const assistant = record.assistant;
  if (assistant !== "off" && assistant !== "local" && assistant !== "remote") {
    throw new Error("The organization policy is not a policy.");
  }
  const providers = record.providers;
  if (
    !Array.isArray(providers) ||
    providers.some((item) => typeof item !== "string" || item.length === 0 || item.length > 253)
  ) {
    throw new Error("The organization policy is not a policy.");
  }
  const maxTokens = record.maxTokens;
  if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) {
    throw new Error("The organization token limit is not a number of tokens.");
  }
  return {
    assistant,
    providers: providers.map((item) => item.toLowerCase()),
    maxTokens,
  };
}

/** The organization token cap, or null when there is no usable policy. */
export function orgAssistantLimit(raw: unknown): number | null {
  if (raw == null) return null;
  try {
    return readOrgAssistantPolicy(raw).maxTokens;
  } catch {
    return null;
  }
}

/** A request may not ask for more tokens than the organization allows. */
export function cappedTokens(requested: number, limit: number | null): number {
  if (limit == null) return requested;
  return Math.min(requested, limit);
}

/** Whether a prompt may be given to a model. */
export function assistantBlock(
  prefs: { enabled: boolean; localOnly: boolean; place: AiPlace },
  demo: boolean,
  orgRaw?: unknown,
  endpoint = "",
): string | null {
  let org: OrgAssistantPolicy | null = null;
  if (orgRaw != null) {
    try {
      org = readOrgAssistantPolicy(orgRaw);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        message === "The organization policy does not store a secret." ||
        message === "The organization token limit is not a number of tokens." ||
        message === "The organization policy is not a policy."
      ) {
        return message;
      }
      return "The organization policy is not a policy.";
    }
    if (org.assistant === "off") return "The organization turned the assistant off.";
  }
  if (!prefs.enabled) return "The assistant is off.";
  if (org?.assistant === "local" && prefs.place === "remote") {
    return "The organization allows only a local assistant.";
  }
  if (org?.assistant === "remote" && prefs.place === "remote") {
    let host = "";
    try {
      host = new URL(endpoint).hostname.toLowerCase();
    } catch {
      host = "";
    }
    if (!host || !org.providers.includes(host)) return "That provider is not approved.";
  }
  if (!demo && prefs.place === "remote" && prefs.localOnly) {
    return "Remote endpoints are off. Document text stays here.";
  }
  return null;
}

/**
 * A remote model receives the document only after that choice.
 * The refusal does not include the document.
 */
export function remotePrompt(
  prompt: string,
  sendDocument: boolean,
): { prompt: string } | { error: string } {
  if (sendDocument) return { prompt };
  return { error: "Document text stays on this computer until you choose to send it." };
}

/** Local mode permits this computer and the connected SuiteLeaf server's assistant routes. */
export function promptHostAllowed(url: string, localOnly: boolean, serverUrl?: string): boolean {
  if (!localOnly) return true;
  try {
    const target = new URL(url);
    const host = target.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    if (!serverUrl) return false;
    const server = new URL(`${serverUrl.replace(/\/+$/, "")}/api/ai/v1/`);
    return (server.protocol === "https:" || server.protocol === "http:") &&
      target.origin === server.origin &&
      (target.pathname === `${server.pathname}load` || target.pathname === `${server.pathname}completions`);
  } catch {
    return false;
  }
}
