/** A working localStorage and sessionStorage for tests (Node's own shadows jsdom's). */
export function memoryStorage(name: "localStorage" | "sessionStorage" = "localStorage") {
  const store = new Map<string, string>();
  const storage: Storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, name, { configurable: true, value: storage });
  if (typeof window !== "undefined" && window !== (globalThis as unknown))
    Object.defineProperty(window, name, { configurable: true, value: storage });
  return storage;
}
