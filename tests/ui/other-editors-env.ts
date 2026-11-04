import { vi } from "vitest";

/** Node's own localStorage is absent without a storage file, and it shadows jsdom's. */
export function memoryStorage() {
  const store = new Map<string, string>();
  const memory = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  Object.defineProperty(globalThis, "localStorage", { value: memory, configurable: true });
  Object.defineProperty(window, "localStorage", { value: memory, configurable: true });
  return memory;
}

/** The browser pieces jsdom leaves out that the editors reach for while they mount. */
export function stubBrowser() {
  memoryStorage();
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo ??= () => {};
  document.elementFromPoint ??= () => null;
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}
