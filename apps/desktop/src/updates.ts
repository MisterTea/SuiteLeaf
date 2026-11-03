/**
 * Signed desktop update manifests.
 *
 * The trusted public key is supplied by the caller. A key carried inside the
 * manifest is ignored, so a substituted key cannot approve its own bytes.
 * Production signing keys are not stored in this repository.
 */
import { createHash, sign, verify } from "node:crypto";
import { basename, join } from "node:path";
import { desktopUpdateBlock, nodeRuntimeNotice } from "./supported-platform";

export type UpdateChannel = "stable" | "pilot";

export type UpdateManifest = {
  product: "suiteleaf";
  version: string;
  channel: UpdateChannel;
  sha256: string;
  schemaVersion: number;
  restartRequired: boolean;
  minRuntime: string;
};

export type UpdatePolicy = {
  channel: UpdateChannel;
  /** When set, this is the only version the fleet may install. */
  heldVersion?: string;
  paused: boolean;
  /** An ISO time. A release is held until this moment. */
  deferUntil?: string;
  /** 0 to 100. A computer installs when its bucket is below this number. */
  ring?: number;
};

export type UpdateDecision =
  | { action: "install"; version: string; restartRequired: boolean }
  | { action: "hold"; reason: string }
  | { action: "reject"; reason: string; recovery?: string };

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export function canonicalManifest(manifest: UpdateManifest): string {
  const ordered: UpdateManifest = {
    product: manifest.product,
    version: manifest.version,
    channel: manifest.channel,
    sha256: manifest.sha256,
    schemaVersion: manifest.schemaVersion,
    restartRequired: manifest.restartRequired,
    minRuntime: manifest.minRuntime,
  };
  return JSON.stringify(ordered);
}

export function signUpdate(manifest: UpdateManifest, privateKeyPem: string): string {
  return sign(null, Buffer.from(canonicalManifest(manifest)), privateKeyPem).toString("base64");
}

export function signatureMatches(
  manifest: UpdateManifest,
  signature: string,
  publicKeyPem: string,
): boolean {
  const bytes = Buffer.from(signature, "base64");
  if (bytes.length === 0) return false;
  try {
    return verify(null, Buffer.from(canonicalManifest(manifest)), publicKeyPem, bytes);
  } catch {
    return false;
  }
}

function parseVersion(version: string): [number, number, number] | undefined {
  const match = VERSION.exec(version);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: string, right: string): number | undefined {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return undefined;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function decideUpdate(input: {
  currentVersion: string;
  currentSchema: number;
  /** `major.minor.patch` of the runtime this app is running. */
  currentRuntime: string;
  manifest: UpdateManifest;
  signature: string;
  publicKeyPem: string;
  installerSha256: string;
  policy: UpdatePolicy;
  /** ISO time of this check. Missing means the clock on this computer. */
  now?: string;
  /** Stable name for this computer. It is not written into the decision. */
  deviceId?: string;
  /** `darwin`, `win32`, or `linux`. Missing skips the operating-system floor. */
  currentPlatform?: string;
  /** Marketing version from the desktop host. It is not written into the decision. */
  currentOsVersion?: string;
}): UpdateDecision {
  const { manifest, policy } = input;
  if (input.currentPlatform) {
    const blocked = desktopUpdateBlock(input.currentPlatform, input.currentOsVersion ?? "");
    if (blocked) {
      return { action: "reject", reason: blocked, recovery: "Keep the installed app." };
    }
  }
  if (manifest.product !== "suiteleaf") {
    return { action: "reject", reason: "The update is not a SuiteLeaf release." };
  }
  if (!signatureMatches(manifest, input.signature, input.publicKeyPem)) {
    return { action: "reject", reason: "The update signature does not match." };
  }
  if (input.installerSha256 !== manifest.sha256) {
    return { action: "reject", reason: "The installer hash does not match the manifest." };
  }
  const runtime = compareVersions(input.currentRuntime, manifest.minRuntime);
  if (runtime === undefined) {
    return { action: "reject", reason: "The runtime requirement is not major.minor.patch." };
  }
  if (runtime < 0) {
    return {
      action: "reject",
      reason: `This release needs runtime ${manifest.minRuntime}. This app is running ${input.currentRuntime}.`,
      recovery: `Keep the installed app until this computer runs runtime ${manifest.minRuntime} or newer.`,
    };
  }
  if (policy.paused) return { action: "hold", reason: "Updates are paused." };
  if (policy.deferUntil) {
    const until = Date.parse(policy.deferUntil);
    const now = Date.parse(input.now ?? new Date().toISOString());
    if (Number.isFinite(until) && Number.isFinite(now) && now < until) {
      return { action: "hold", reason: `Updates are deferred until ${policy.deferUntil}.` };
    }
  }
  if (policy.channel !== manifest.channel) {
    return { action: "hold", reason: "This release is for a different update channel." };
  }
  if (policy.heldVersion && policy.heldVersion !== manifest.version) {
    return { action: "hold", reason: "The fleet is held on a different version." };
  }
  const compared = compareVersions(manifest.version, input.currentVersion);
  if (compared === undefined) {
    return { action: "reject", reason: "The version is not major.minor.patch." };
  }
  if (compared < 0 && manifest.schemaVersion < input.currentSchema) {
    return {
      action: "reject",
      reason: "This release is older than the document schema already in use.",
      recovery: `Keep the installed app. Do not replace its files with this older release. Documents use schema ${input.currentSchema}; this release only opens schema ${manifest.schemaVersion}.`,
    };
  }
  if (compared < 0 && policy.heldVersion === manifest.version) {
    return (
      ringHold(policy, input.deviceId) ?? {
        action: "install",
        version: manifest.version,
        restartRequired: manifest.restartRequired,
      }
    );
  }
  if (compared < 0) {
    return { action: "hold", reason: "This release is older than the installed version." };
  }
  if (compared === 0) return { action: "hold", reason: "This version is already installed." };
  return (
    ringHold(policy, input.deviceId) ?? {
      action: "install",
      version: manifest.version,
      restartRequired: manifest.restartRequired,
    }
  );
}

/** After a failed start, return to the previous release only when documents were not moved forward. Nothing is replaced. */
export function planRollback(input: {
  previousVersion: string;
  previousSchema: number;
  failedVersion: string;
  failedSchema: number;
}): { action: "restore"; version: string } | { action: "keep"; reason: string } {
  if (!parseVersion(input.previousVersion) || !parseVersion(input.failedVersion)) {
    return { action: "keep", reason: "The installed version is not major.minor.patch." };
  }
  const schema = (value: number) => Number.isInteger(value) && value >= 1 && value <= 9999;
  if (!schema(input.previousSchema) || !schema(input.failedSchema)) {
    return { action: "keep", reason: "The document schema is not a supported number." };
  }
  if (input.failedSchema > input.previousSchema) {
    return { action: "keep", reason: "This release changed the document schema. Keep it installed." };
  }
  if (input.previousVersion === input.failedVersion) {
    return { action: "keep", reason: "This release is the one already installed." };
  }
  return { action: "restore", version: input.previousVersion };
}

/** Read a failed-start record. The file text is not copied into the plan. */
export function failedStartPlan(text: string): ReturnType<typeof planRollback> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { action: "keep", reason: "The failed start record cannot be read." };
  }
  if (!value || typeof value !== "object") {
    return { action: "keep", reason: "The failed start record cannot be read." };
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.previousVersion !== "string" ||
    typeof row.failedVersion !== "string" ||
    typeof row.previousSchema !== "number" ||
    typeof row.failedSchema !== "number"
  ) {
    return { action: "keep", reason: "The failed start record cannot be read." };
  }
  return planRollback({
    previousVersion: row.previousVersion,
    previousSchema: row.previousSchema,
    failedVersion: row.failedVersion,
    failedSchema: row.failedSchema,
  });
}

/**
 * On the next launch, turn a failed-start record into a rollback plan.
 * A restore writes only the previous version. The installed app is not replaced.
 * The record is removed either way so a later launch does not plan it again.
 */
export async function consumeFailedStart(input: {
  text: string | null;
  writePlan: (version: string) => Promise<void>;
  removeRecord: () => Promise<void>;
}): Promise<ReturnType<typeof planRollback> | null> {
  if (input.text == null) return null;
  const plan = failedStartPlan(input.text);
  if (plan.action === "restore") await input.writePlan(plan.version);
  await input.removeRecord();
  return plan;
}

/** The version named by a rollback plan. Other text in the plan is ignored. */
export function rollbackHeldVersion(text: string | null): string | null {
  if (text == null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const version = (value as Record<string, unknown>).version;
  if (typeof version !== "string" || !parseVersion(version)) return null;
  return version;
}

/** Hold the poll on the planned version unless an operator already named one. */
export function holdForRollback<T extends UpdatePolicy>(policy: T, text: string | null): T {
  const version = rollbackHeldVersion(text);
  if (!version || policy.heldVersion) return policy;
  return { ...policy, heldVersion: version };
}

/** A bucket from 0 through 99. The same computer stays in the same bucket. */
export function updateRingBucket(deviceId: string): number {
  let hash = 0;
  for (const char of deviceId) hash = (Math.imul(hash, 33) + char.charCodeAt(0)) >>> 0;
  return hash % 100;
}

function ringHold(policy: UpdatePolicy, deviceId?: string): UpdateDecision | null {
  if (policy.ring === undefined) return null;
  if (!deviceId) return { action: "hold", reason: "This computer is not assigned to an update ring." };
  if (updateRingBucket(deviceId) >= policy.ring) {
    return { action: "hold", reason: "This computer is waiting for a later ring." };
  }
  return null;
}

export type ReleaseRecord = {
  version: string;
  signing: string;
  migration: string;
  restart: string;
};

/** What a release offer actually decided: version, signature, schema, and restart. */
export function releaseRecord(input: {
  manifest: UpdateManifest;
  decision: UpdateDecision;
  currentSchema: number;
  signatureAccepted: boolean;
}): ReleaseRecord {
  const { manifest, decision } = input;
  const signing = input.signatureAccepted
    ? "The signature matches."
    : "The signature was rejected. This release is not signed for this app.";
  let migration: string;
  if (!input.signatureAccepted) {
    migration = `This release was not accepted. Documents stay on schema ${input.currentSchema}.`;
  } else if (decision.action === "reject" && decision.recovery) {
    migration = decision.recovery;
  } else if (manifest.schemaVersion > input.currentSchema) {
    migration = `Documents move from schema ${input.currentSchema} to schema ${manifest.schemaVersion}.`;
  } else if (manifest.schemaVersion < input.currentSchema) {
    migration = `This release only opens schema ${manifest.schemaVersion}. Documents use schema ${input.currentSchema}. Do not replace the installed files.`;
  } else {
    migration = `Documents stay on schema ${input.currentSchema}.`;
  }
  const restart =
    decision.action === "install" && manifest.restartRequired
      ? "The app must quit and reopen."
      : "The app does not need to restart.";
  return { version: manifest.version, signing, migration, restart };
}

export type RestartPlan =
  | { action: "wait"; reason: string }
  | { action: "restart"; version: string }
  | { action: "continue"; reason: string };

/**
 * Whether the running app may quit to finish an update.
 * Unsaved edits stay open until a save has completed.
 */
export function planRestart(input: {
  decision: UpdateDecision;
  unsavedEdits: boolean;
  saved: boolean;
}): RestartPlan {
  if (input.decision.action !== "install") {
    return { action: "continue", reason: input.decision.reason };
  }
  if (!input.decision.restartRequired) {
    return { action: "continue", reason: "This release does not ask the app to restart." };
  }
  if (input.unsavedEdits && !input.saved) {
    return {
      action: "wait",
      reason: "Save open documents before restarting. The update does not discard them.",
    };
  }
  return { action: "restart", version: input.decision.version };
}

let pendingRestart: UpdateDecision | null = null;

/** Remember a decision the close handler should honor. This does not download or replace the app. */
export function noteUpdateDecision(decision: UpdateDecision | null) {
  pendingRestart =
    decision?.action === "install" && decision.restartRequired ? decision : null;
}

export type ReleaseOffer = {
  manifest: UpdateManifest;
  signature: string;
  installerSha256: string;
};

function isManifest(value: unknown): value is UpdateManifest {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.product === "suiteleaf" &&
    typeof row.version === "string" &&
    (row.channel === "stable" || row.channel === "pilot") &&
    typeof row.sha256 === "string" &&
    typeof row.schemaVersion === "number" &&
    typeof row.restartRequired === "boolean" &&
    typeof row.minRuntime === "string"
  );
}

function parseOffer(value: unknown): ReleaseOffer | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!isManifest(row.manifest)) return null;
  if (typeof row.signature !== "string" || typeof row.installerSha256 !== "string") return null;
  return {
    manifest: row.manifest,
    signature: row.signature,
    installerSha256: row.installerSha256,
  };
}

/**
 * Record the latest offer a caller already fetched. A signed install that
 * needs a restart is what the close handler remembers. Anything else clears
 * that memory. This does not download an installer or open a network request,
 * including when the offer also carries a URL.
 */
export function recordReleaseOffer(input: {
  offer: unknown;
  currentVersion: string;
  currentSchema: number;
  currentRuntime: string;
  publicKeyPem: string;
  policy: UpdatePolicy;
  deviceId?: string;
  currentPlatform?: string;
  currentOsVersion?: string;
}): UpdateDecision {
  const parsed = parseOffer(input.offer);
  if (!parsed) {
    const decision: UpdateDecision = {
      action: "reject",
      reason: "The release offer is not a SuiteLeaf manifest.",
    };
    noteUpdateDecision(decision);
    return decision;
  }
  const decision = decideUpdate({
    currentVersion: input.currentVersion,
    currentSchema: input.currentSchema,
    currentRuntime: input.currentRuntime,
    manifest: parsed.manifest,
    signature: parsed.signature,
    publicKeyPem: input.publicKeyPem,
    installerSha256: parsed.installerSha256,
    policy: input.policy,
    deviceId: input.deviceId,
    currentPlatform: input.currentPlatform,
    currentOsVersion: input.currentOsVersion,
  });
  noteUpdateDecision(decision);
  return decision;
}

const MAX_OFFER_CHARS = 64_000;

export type FetchedOffer = { ok: boolean; status: number; text: string };

const MAX_INSTALLER_BYTES = 512 * 1024 * 1024;

export function installerSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type FetchedBytes = { ok: boolean; status: number; bytes: Uint8Array };

/**
 * Download an installer and keep it only when its SHA-256 is the signed hash.
 * A mismatch clears a remembered restart. A server that does not answer does not.
 * This does not open the file or replace the installed app.
 */
export async function downloadCheckedInstaller(input: {
  url: string;
  expectedSha256: string;
  fetchBytes: (url: string) => Promise<FetchedBytes>;
  save?: (bytes: Uint8Array) => Promise<void> | void;
}): Promise<UpdateDecision | { action: "checked"; sha256: string }> {
  if (!input.url.startsWith("https://")) {
    const decision: UpdateDecision = {
      action: "reject",
      reason: "The installer address is not an https address.",
    };
    noteUpdateDecision(decision);
    return decision;
  }
  let response: FetchedBytes;
  try {
    response = await input.fetchBytes(input.url);
  } catch {
    return { action: "hold", reason: "The installer could not be downloaded." };
  }
  if (!response.ok) {
    return { action: "hold", reason: "The installer could not be downloaded." };
  }
  if (response.bytes.byteLength > MAX_INSTALLER_BYTES) {
    const decision: UpdateDecision = {
      action: "reject",
      reason: "The installer is too large.",
    };
    noteUpdateDecision(decision);
    return decision;
  }
  const sha256 = installerSha256(response.bytes);
  if (sha256 !== input.expectedSha256) {
    const decision: UpdateDecision = {
      action: "reject",
      reason: "The installer hash does not match the manifest.",
    };
    noteUpdateDecision(decision);
    return decision;
  }
  await input.save?.(response.bytes);
  return { action: "checked", sha256 };
}

function installerAddress(offer: unknown): string {
  if (!offer || typeof offer !== "object") return "";
  const url = (offer as Record<string, unknown>).installerUrl;
  return typeof url === "string" ? url : "";
}

const PROXY_ERROR = "The update proxy is not an http address.";

/**
 * An empty value means a direct request. An http or https proxy is kept.
 * Any other value is refused. The refusal does not repeat the value.
 */
export function updateProxyAddress(
  value: string | undefined,
): { proxy: string | null } | { error: typeof PROXY_ERROR } {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { proxy: null };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: PROXY_ERROR };
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
    return { error: PROXY_ERROR };
  }
  return { proxy: parsed.toString() };
}

async function fetchResponse(address: string, proxy?: string): Promise<Response> {
  if (!proxy) return fetch(address);
  const { ProxyAgent } = (await import("undici")) as {
    ProxyAgent: new (uri: string) => object;
  };
  return fetch(address, { dispatcher: new ProxyAgent(proxy) } as RequestInit);
}

/**
 * Read one release offer from an https address and record it.
 * A network failure leaves a previously recorded restart in place.
 * When the offer names an https installer and a byte fetcher is set, those
 * bytes are kept only if their hash matches the signed manifest.
 * This does not open the installer or replace the app.
 */
export async function fetchReleaseOffer(input: {
  url: string;
  /** When set, the offer and the installer are requested through this proxy. */
  proxy?: string;
  fetchOffer: (url: string, proxy?: string) => Promise<FetchedOffer>;
  fetchBytes?: (url: string, proxy?: string) => Promise<FetchedBytes>;
  save?: (bytes: Uint8Array) => Promise<void> | void;
  currentVersion: string;
  currentSchema: number;
  currentRuntime: string;
  publicKeyPem: string;
  policy: UpdatePolicy;
  deviceId?: string;
  currentPlatform?: string;
  currentOsVersion?: string;
}): Promise<UpdateDecision> {
  if (!input.url.startsWith("https://")) {
    return {
      action: "reject",
      reason: "The release address is not an https address.",
    };
  }
  const routed = updateProxyAddress(input.proxy);
  if ("error" in routed) {
    return { action: "reject", reason: routed.error };
  }
  const via = routed.proxy ?? undefined;
  let response: FetchedOffer;
  try {
    response = await input.fetchOffer(input.url, via);
  } catch {
    return { action: "hold", reason: "The release server did not answer." };
  }
  if (!response.ok) {
    return { action: "hold", reason: "The release server did not answer." };
  }
  if (response.text.length > MAX_OFFER_CHARS) {
    const decision: UpdateDecision = {
      action: "reject",
      reason: "The release offer is too large.",
    };
    noteUpdateDecision(decision);
    return decision;
  }
  let offer: unknown = null;
  try {
    offer = JSON.parse(response.text);
  } catch {
    offer = null;
  }
  const decision = recordReleaseOffer({ ...input, offer });
  const installerUrl = installerAddress(offer);
  if (decision.action !== "install" || !input.fetchBytes || !installerUrl) return decision;
  const parsed = parseOffer(offer);
  if (!parsed) return decision;
  const checked = await downloadCheckedInstaller({
    url: installerUrl,
    expectedSha256: parsed.manifest.sha256,
    fetchBytes: (address) => input.fetchBytes!(address, via),
    save: input.save,
  });
  return checked.action === "checked" ? decision : checked;
}

const RELEASE_POLL_MS = 6 * 60 * 60 * 1000;

const MANAGED_SECRET = new Set(["password", "secret", "apikey", "token", "credential", "clientsecret"]);

function utcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Environment policy, then an administrator file. A secret field is refused. */
export function managedUpdatePolicy(
  env: Record<string, string | undefined>,
  raw: string | null,
): { policy: UpdatePolicy } | { error: string } {
  const policy: UpdatePolicy = {
    channel: env.SUITELEAF_UPDATE_CHANNEL === "pilot" ? "pilot" : "stable",
    paused: env.SUITELEAF_UPDATE_PAUSED === "1",
  };
  const held = env.SUITELEAF_UPDATE_HELD?.trim() ?? "";
  if (/^\d+\.\d+\.\d+$/.test(held)) policy.heldVersion = held;
  if (raw == null || raw.trim() === "") return { policy };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "The managed update settings are not valid." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "The managed update settings are not valid." };
  }
  const record = parsed as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (MANAGED_SECRET.has(key.toLowerCase().replace(/[-_]/g, ""))) {
      return { error: "The managed update settings do not store a secret." };
    }
  }
  if (record.channel !== undefined) {
    const channel = typeof record.channel === "string" ? record.channel.trim().toLowerCase() : "";
    if (channel !== "stable" && channel !== "pilot") {
      return { error: "The managed update channel is stable or pilot." };
    }
    policy.channel = channel === "pilot" ? "pilot" : "stable";
  }
  if (record.heldVersion !== undefined) {
    if (typeof record.heldVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(record.heldVersion)) {
      return { error: "The managed update version is not a version." };
    }
    policy.heldVersion = record.heldVersion;
  }
  if (record.paused !== undefined) {
    if (typeof record.paused !== "boolean") return { error: "The managed update settings are not valid." };
    policy.paused = record.paused;
  }
  if (record.deferUntil !== undefined) {
    if (typeof record.deferUntil !== "string" || !utcTimestamp(record.deferUntil)) {
      return { error: "The defer date is not a time." };
    }
    policy.deferUntil = record.deferUntil;
  }
  if (record.ring !== undefined) {
    if (typeof record.ring !== "number" || !Number.isInteger(record.ring) || record.ring < 0 || record.ring > 100) {
      return { error: "The update ring is not a percent." };
    }
    policy.ring = record.ring;
  }
  return { policy };
}

/**
 * Poll a release address when the operator set both the address and the
 * trusted public key. With either missing, nothing is requested.
 */
export function startReleasePoll(input: {
  currentVersion: string;
  currentSchema: number;
  currentRuntime: string;
  env: Record<string, string | undefined>;
  installerDirectory?: string;
  fetchOffer?: (url: string, proxy?: string) => Promise<FetchedOffer>;
  fetchBytes?: (url: string, proxy?: string) => Promise<FetchedBytes>;
  save?: (bytes: Uint8Array) => Promise<void> | void;
  /** Contents of `update-policy.json`, when that file exists. */
  managedText?: string | null;
  /** Contents of `rollback-plan.json`, when that file exists. */
  rollbackText?: string | null;
  /** Stable name for this computer. It is not written into a decision. */
  deviceId?: string;
  currentPlatform?: string;
  currentOsVersion?: string;
}): () => void {
  const url = input.env.SUITELEAF_UPDATE_URL?.trim() ?? "";
  const publicKeyPem = input.env.SUITELEAF_UPDATE_PUBLIC_KEY?.trim() ?? "";
  if (!url || !publicKeyPem) return () => {};
  const routed = updateProxyAddress(input.env.SUITELEAF_UPDATE_PROXY);
  if ("error" in routed) return () => {};
  const managed = managedUpdatePolicy(input.env, input.managedText ?? null);
  if ("error" in managed) return () => {};
  if (nodeRuntimeNotice(input.currentRuntime) !== "This runtime is supported.") return () => {};
  if (input.currentPlatform) {
    const blocked = desktopUpdateBlock(input.currentPlatform, input.currentOsVersion ?? "");
    if (blocked) return () => {};
  }
  const policy = holdForRollback(managed.policy, input.rollbackText ?? null);
  const fetchOffer =
    input.fetchOffer ??
    (async (address: string, via?: string) => {
      const response = await fetchResponse(address, via);
      return { ok: response.ok, status: response.status, text: await response.text() };
    });
  const fetchBytes =
    input.fetchBytes ??
    (async (address: string, via?: string) => {
      const response = await fetchResponse(address, via);
      return {
        ok: response.ok,
        status: response.status,
        bytes: new Uint8Array(await response.arrayBuffer()),
      };
    });
  const save =
    input.save ??
    (input.installerDirectory
      ? async (bytes: Uint8Array) => {
          const { mkdir, writeFile } = await import("node:fs/promises");
          const { join } = await import("node:path");
          await mkdir(input.installerDirectory!, { recursive: true });
          await writeFile(
            join(input.installerDirectory!, `${installerSha256(bytes)}.bin`),
            bytes,
          );
        }
      : undefined);
  const run = () => {
    void (async () => {
      if (policy.paused && input.installerDirectory) {
        await recoverPausedRollout({
          paused: true,
          updatesDirectory: input.installerDirectory,
          unsavedEdits: false,
        });
      }
      await fetchReleaseOffer({
        url,
        proxy: routed.proxy ?? undefined,
        fetchOffer,
        fetchBytes,
        save,
        currentVersion: input.currentVersion,
        currentSchema: input.currentSchema,
        currentRuntime: input.currentRuntime,
        publicKeyPem,
        policy,
        deviceId: input.deviceId,
        currentPlatform: input.currentPlatform,
        currentOsVersion: input.currentOsVersion,
      });
    })();
  };
  run();
  const timer = setInterval(run, RELEASE_POLL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

const KEPT_INSTALLER = /^[a-f0-9]{64}\.bin$/;

/**
 * When a rollout is paused, drop a remembered restart and delete kept installer
 * files in the updates directory. Other files in that directory stay. Open
 * documents are not read or deleted.
 */
export async function recoverPausedRollout(input: {
  paused: boolean;
  updatesDirectory: string;
  unsavedEdits: boolean;
  list?: (directory: string) => Promise<string[]>;
  remove?: (path: string) => Promise<void>;
}): Promise<{
  action: "recovered" | "left";
  removed: string[];
  editsDiscarded: false;
  unsavedEdits: boolean;
}> {
  if (!input.paused) {
    return { action: "left", removed: [], editsDiscarded: false, unsavedEdits: input.unsavedEdits };
  }
  noteUpdateDecision(null);
  const list = input.list ?? listUpdates;
  const remove = input.remove ?? removeUpdate;
  let names: string[] = [];
  try {
    names = await list(input.updatesDirectory);
  } catch {
    names = [];
  }
  const removed: string[] = [];
  for (const name of names) {
    const base = basename(name);
    if (!KEPT_INSTALLER.test(base)) continue;
    await remove(join(input.updatesDirectory, base));
    removed.push(base);
  }
  return {
    action: "recovered",
    removed,
    editsDiscarded: false,
    unsavedEdits: input.unsavedEdits,
  };
}

async function listUpdates(directory: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  return readdir(directory);
}

async function removeUpdate(path: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(path, { force: true });
}

export function restartWhileDirty(unsavedEdits: boolean): RestartPlan {
  if (!pendingRestart) return { action: "continue", reason: "No update is waiting." };
  return planRestart({
    decision: pendingRestart,
    unsavedEdits,
    saved: !unsavedEdits,
  });
}
