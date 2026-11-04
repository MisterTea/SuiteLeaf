import { vi } from "vitest";

/** Queue animation frames so a test decides when layout work runs. */
export function frameQueue() {
  let queue = new Map<number, FrameRequestCallback>();
  let serial = 0;
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    serial += 1;
    queue.set(serial, run);
    return serial;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    queue.delete(id);
  });
  return {
    get size() {
      return queue.size;
    },
    flush(rounds = 1) {
      for (let round = 0; round < rounds; round++) {
        const pending = queue;
        queue = new Map();
        for (const run of pending.values()) run(performance.now());
      }
    },
  };
}

/** jsdom has no ResizeObserver. Keep the callbacks so a test can fire them. */
export function resizeObservers() {
  const callbacks = new Set<() => void>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private run: () => void) {
        callbacks.add(run);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        callbacks.delete(this.run);
      }
    },
  );
  return {
    fire: () => callbacks.forEach((run) => run()),
    get size() {
      return callbacks.size;
    },
  };
}

/** jsdom ranges and elements have no client rects; ProseMirror scrolling and pagination read them. */
export function emptyRects() {
  const none = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const list = () => [] as unknown as DOMRectList;
  const patched: [object, string, PropertyDescriptor | undefined][] = [];
  const patch = (target: object, name: string, value: () => unknown) => {
    patched.push([target, name, Object.getOwnPropertyDescriptor(target, name)]);
    Object.defineProperty(target, name, { value, configurable: true, writable: true });
  };
  patch(Range.prototype, "getClientRects", list);
  patch(Range.prototype, "getBoundingClientRect", none);
  if (!("getClientRects" in Element.prototype)) patch(Element.prototype, "getClientRects", list);
  return () => {
    for (const [target, name, descriptor] of patched.reverse()) {
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else delete (target as Record<string, unknown>)[name];
    }
  };
}

/** Node's own localStorage is empty without a storage file, so give the page one. */
export function memoryStorage() {
  const store = new Map<string, string>();
  const memory: Storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: memory, configurable: true });
  return memory;
}

type Box = { top?: number; left?: number; width?: number; height?: number };

/** Give elements a layout box. jsdom reports zero for every rectangle. */
export function layoutBoxes(box: (el: Element) => Box | undefined) {
  const rect = (el: Element): DOMRect => {
    const found = box(el) ?? {};
    const top = found.top ?? 0;
    const left = found.left ?? 0;
    const width = found.width ?? 0;
    const height = found.height ?? 0;
    return {
      top,
      left,
      width,
      height,
      x: left,
      y: top,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    } as DOMRect;
  };
  const spies = [
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return rect(this);
    }),
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      return rect(this).height;
    }),
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return rect(this).width;
    }),
  ];
  return () => spies.forEach((spy) => spy.mockRestore());
}

export function mousedown(el: Element, init: MouseEventInit = {}) {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, ...init }));
}

export function click(el: Element) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

export function key(el: Element, keyName: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  return event;
}
