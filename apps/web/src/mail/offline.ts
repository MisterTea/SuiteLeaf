const reads = new Set([
  "accounts",
  "folders",
  "list",
  "read",
  "conversation",
  "attachment",
  "original",
  "contacts",
  "templates",
  "preferences",
]);
interface Session {
  url: string;
  token: string;
}
interface CacheEntry {
  id: string;
  iv: Uint8Array;
  data: ArrayBuffer;
  savedAt: number;
}
const encode = new TextEncoder();
async function identity(session: Session) {
  const material = await crypto.subtle.digest(
    "SHA-256",
    encode.encode(JSON.stringify([session.url, session.token])),
  );
  const id = Array.from(new Uint8Array(material), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  const key = await crypto.subtle.importKey(
    "raw",
    material,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return { id, key };
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("SuiteLeafMailOffline", 1);
    open.onupgradeneeded = () =>
      open.result.createObjectStore("mail", { keyPath: "id" });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("mail", mode);
    const request = run(tx.objectStore("mail"));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
async function cacheId(session: Session, request: Record<string, unknown>) {
  const user = await identity(session);
  const hash = await crypto.subtle.digest(
    "SHA-256",
    encode.encode(JSON.stringify(request)),
  );
  return {
    ...user,
    entry: `${user.id}:${Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join("")}`,
  };
}
export async function setOfflineMail(session: Session, enabled: boolean) {
  try {
    const { id } = await identity(session);
    const pref = `suiteleaf:mail-offline:${id}`;
    if (enabled) localStorage.setItem(pref, "1");
    else {
      localStorage.removeItem(pref);
      const rows = await transaction<CacheEntry[]>("readonly", (s) =>
        s.getAll(),
      );
      for (const row of rows)
        if (row.id.startsWith(`${id}:`))
          await transaction("readwrite", (s) => s.delete(row.id));
    }
  } catch {
    /* Storage can be denied by the browser; it must not break online mail. */
  }
}
export async function cacheMail(
  session: Session,
  request: Record<string, unknown>,
  payload: unknown,
) {
  if (!reads.has(String(request.action))) return;
  try {
    const { id, key, entry } = await cacheId(session, request);
    if (localStorage.getItem(`suiteleaf:mail-offline:${id}`) !== "1") return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encode.encode(JSON.stringify(payload)),
    );
    await transaction("readwrite", (s) =>
      s.put({ id: entry, iv, data, savedAt: Date.now() }),
    );
  } catch {
    /* Offline storage is optional. */
  }
}
export async function cachedMail<T>(
  session: Session,
  request: Record<string, unknown>,
): Promise<T | undefined> {
  if (!reads.has(String(request.action))) return;
  try {
    const { id, key, entry } = await cacheId(session, request);
    if (localStorage.getItem(`suiteleaf:mail-offline:${id}`) !== "1") return;
    const row = await transaction<CacheEntry | undefined>("readonly", (s) =>
      s.get(entry),
    );
    if (!row || Date.now() - row.savedAt > 30 * 86400000) return;
    const data = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: row.iv as BufferSource },
      key,
      row.data,
    );
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    return;
  }
}
