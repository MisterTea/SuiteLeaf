import type { NodeUser } from "./node-client";

const NAME_KEY = "suiteleaf:display-name";
const ID_KEY = "suiteleaf:local-author";
/** Names this computer already knows. Single-node @ suggestions use this list. */
const KNOWN_KEY = "suiteleaf:known-names";
const listeners = new Set<() => void>();

/** The person comments are attributed to on this device. */
export interface Author {
  /** Stable across sessions, so your own comments stay editable after reopening a file. */
  id: string;
  /** Shown beside your own comments. */
  name: string;
  /** Saved with each comment for other readers; empty until a name is chosen. */
  signature: string;
}

function read(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function write(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // ignore localStorage failures
  }
}

/** The display name chosen on this device for single-node mode, if any. */
export function localName() {
  return read(NAME_KEY).trim();
}

function readKnown() {
  try {
    const raw = JSON.parse(read(KNOWN_KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, 80))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** The local display name, plus every name remembered on this computer. */
export function knownNames() {
  const names: string[] = [];
  const push = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (names.some((item) => item.toLowerCase() === trimmed.toLowerCase())) return;
    names.push(trimmed);
  };
  push(localName());
  for (const name of readKnown()) push(name);
  return names;
}

function storeKnown(name: string) {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed || trimmed.toLowerCase() === "you") return false;
  const current = readKnown();
  if (current.some((item) => item.toLowerCase() === trimmed.toLowerCase())) return false;
  write(KNOWN_KEY, JSON.stringify([...current, trimmed].slice(-40)));
  return true;
}

/** Remember a name for later @ suggestions. Does not change who is commenting. */
export function rememberName(name: string) {
  if (storeKnown(name)) listeners.forEach((listener) => listener());
}

export function setLocalName(name: string) {
  const trimmed = name.trim().slice(0, 80);
  write(NAME_KEY, trimmed);
  if (trimmed) storeKnown(trimmed);
  listeners.forEach((listener) => listener());
}

export function onAuthorChange(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** A signed-in SuiteDrive account takes precedence over the local name. */
export function currentAuthor(user?: NodeUser | null): Author {
  if (user) {
    const name = (user.name || user.username || user.email || "").trim();
    return { id: `user-${user.id}`, name: name || "You", signature: name };
  }
  let id = read(ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    write(ID_KEY, id);
  }
  const name = localName();
  return { id: `local-${id}`, name: name || "You", signature: name };
}
