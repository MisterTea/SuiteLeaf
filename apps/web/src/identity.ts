import type { NodeUser } from "./node-client";

const NAME_KEY = "suiteleaf:display-name";
const ID_KEY = "suiteleaf:local-author";
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

export function setLocalName(name: string) {
  write(NAME_KEY, name.trim().slice(0, 80));
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
