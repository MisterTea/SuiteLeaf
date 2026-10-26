const plain = (value: object) => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Whether two JSON values would serialize to the same data, ignoring key order.
 * Parts that are the same object are not walked, and equal strings compare by
 * reference first, so large unchanged text such as embedded pictures costs nothing.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    // JSON writes a missing array item as null.
    return a.every((item, i) => sameJson(item ?? null, b[i] ?? null));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  if (keys.length !== Object.keys(right).filter((key) => right[key] !== undefined).length) return false;
  return keys.every((key) => right[key] !== undefined && sameJson(left[key], right[key]));
}

/**
 * A copy of JSON data with new objects and arrays and the same strings. Strings
 * cannot change, so sharing them keeps embedded pictures from being copied.
 */
export function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item)) as T;
  if (value && typeof value === "object") {
    if (!plain(value)) return structuredClone(value);
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) if (item !== undefined) copy[key] = cloneJson(item);
    return copy as T;
  }
  return value;
}
