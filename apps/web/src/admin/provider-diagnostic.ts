/** A draft identity provider. The client secret is not copied into the result. */

export type ProviderDraft = {
  protocol: "oidc" | "saml";
  issuer: string;
  audience: string;
  clientSecret: string;
};

const SAVED = "The provider settings can be saved. The client secret is not shown.";
const NO_SECRET = "The provider settings can be saved. No client secret was entered.";
const HTTPS = "The issuer must be an https address.";

/** Check a provider draft. This does not contact the provider or save it. */
export function providerDiagnostic(draft: ProviderDraft): { ok: boolean; message: string } {
  let url: URL;
  try {
    url = new URL(draft.issuer.trim());
  } catch {
    return { ok: false, message: HTTPS };
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    return { ok: false, message: HTTPS };
  }
  if (/password|secret|token|authorization|api[-_]?key|credential/i.test(`${url.pathname}${url.search}${url.hash}`)) {
    return { ok: false, message: "The issuer address cannot include a credential." };
  }
  if (draft.protocol !== "oidc" && draft.protocol !== "saml") {
    return { ok: false, message: "The provider is OpenID Connect or SAML." };
  }
  if (!draft.audience.trim()) return { ok: false, message: "Name the audience." };
  return { ok: true, message: draft.clientSecret.trim() ? SAVED : NO_SECRET };
}

const METADATA_UNREADABLE = "The provider metadata cannot be read.";
const METADATA_CREDENTIAL = "The provider metadata cannot include a credential.";
const METADATA_HTTPS = "The provider metadata must use https.";
const METADATA_ISSUER = "The metadata issuer does not match.";

function endpointVerdict(value: unknown): "ok" | "https" | "credential" {
  if (typeof value !== "string") return "https";
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return "https";
  }
  if (url.username || url.password) return "credential";
  if (/[?#&](?:token|password|secret|api[-_]?key|credential)=/i.test(`${url.search}${url.hash}`)) {
    return "credential";
  }
  if (/(?:password|secret|api[-_]?key|credential)/i.test(url.pathname)) return "credential";
  if (url.protocol !== "https:") return "https";
  return "ok";
}

/**
 * Check an OpenID Connect metadata document against the issuer.
 * This does not contact the provider or copy the document into the result.
 */
export function providerMetadata(issuer: string, document: string): { ok: boolean; message: string } {
  let value: unknown;
  try {
    value = JSON.parse(document);
  } catch {
    return { ok: false, message: METADATA_UNREADABLE };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: METADATA_UNREADABLE };
  }
  const row = value as Record<string, unknown>;
  let configured: URL;
  try {
    configured = new URL(issuer.trim());
  } catch {
    return { ok: false, message: HTTPS };
  }
  if (configured.protocol !== "https:") return { ok: false, message: HTTPS };
  let published: URL;
  try {
    published = new URL(typeof row.issuer === "string" ? row.issuer.trim() : "");
  } catch {
    return { ok: false, message: METADATA_ISSUER };
  }
  if (published.origin !== configured.origin || published.pathname !== configured.pathname) {
    return { ok: false, message: METADATA_ISSUER };
  }
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    const verdict = endpointVerdict(row[key]);
    if (verdict === "credential") return { ok: false, message: METADATA_CREDENTIAL };
    if (verdict !== "ok") return { ok: false, message: METADATA_HTTPS };
  }
  return { ok: true, message: SAVED };
}

function quotedAttr(document: string, name: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "gi");
  for (const match of document.matchAll(pattern)) found.push(match[1] ?? match[2] ?? "");
  return found;
}

/**
 * Check a SAML metadata document against the issuer.
 * This does not contact the provider or copy the document into the result.
 */
export function samlMetadata(issuer: string, document: string): { ok: boolean; message: string } {
  if (!/EntityDescriptor/i.test(document)) return { ok: false, message: METADATA_UNREADABLE };
  const entityIds = quotedAttr(document, "entityID");
  if (entityIds.length !== 1) return { ok: false, message: METADATA_UNREADABLE };
  let configured: URL;
  try {
    configured = new URL(issuer.trim());
  } catch {
    return { ok: false, message: HTTPS };
  }
  if (configured.protocol !== "https:") return { ok: false, message: HTTPS };
  let published: URL;
  try {
    published = new URL(entityIds[0]?.trim() ?? "");
  } catch {
    return { ok: false, message: METADATA_ISSUER };
  }
  if (published.origin !== configured.origin || published.pathname !== configured.pathname) {
    return { ok: false, message: METADATA_ISSUER };
  }
  const locations = quotedAttr(document, "Location");
  if (locations.length === 0) return { ok: false, message: METADATA_UNREADABLE };
  for (const location of locations) {
    const verdict = endpointVerdict(location);
    if (verdict === "credential") return { ok: false, message: METADATA_CREDENTIAL };
    if (verdict !== "ok") return { ok: false, message: METADATA_HTTPS };
  }
  return { ok: true, message: SAVED };
}
