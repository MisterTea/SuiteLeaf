/**
 * Repeated picture bytes are one string in memory and one entry on disk.
 * A deck that pastes the same photo on every slide otherwise exceeds the
 * converter heap and the largest string JSON can build.
 */
const TOKEN = "\u0000slmedia:";

export function retainSharedData<T>(value: T, pool: Map<string, string>): T {
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") {
      if (item.length < 4096 || !item.startsWith("data:")) return item;
      const known = pool.get(item);
      if (known) return known;
      pool.set(item, item);
      return item;
    }
    if (Array.isArray(item)) {
      for (let i = 0; i < item.length; i++) item[i] = visit(item[i]);
      return item;
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      for (const key of Object.keys(record)) record[key] = visit(record[key]);
    }
    return item;
  };
  return visit(value) as T;
}

export function packSharedMedia<T>(value: T): T {
  const assets: string[] = [];
  const ids = new Map<string, number>();
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") {
      if (item.length < 4096 || !item.startsWith("data:")) return item;
      let id = ids.get(item);
      if (id === undefined) {
        id = assets.length;
        assets.push(item);
        ids.set(item, id);
      }
      return `${TOKEN}${id}`;
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const copy: Record<string, unknown> = {};
      for (const key of Object.keys(record)) copy[key] = visit(record[key]);
      return copy;
    }
    return item;
  };
  if (!value || typeof value !== "object") return value;
  const packed = visit(value) as T & { sharedMedia?: string[] };
  if (!assets.length) return value;
  packed.sharedMedia = assets;
  return packed;
}

export function unpackSharedMedia<T>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const assets = record.sharedMedia;
  if (!Array.isArray(assets) || assets.some((item) => typeof item !== "string"))
    return value;
  const media = assets as string[];
  const copy: Record<string, unknown> = { ...record };
  delete copy.sharedMedia;
  const visit = (item: unknown): unknown => {
    if (typeof item === "string") {
      if (!item.startsWith(TOKEN)) return item;
      const asset = media[Number(item.slice(TOKEN.length))];
      return typeof asset === "string" ? asset : item;
    }
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") {
      const next: Record<string, unknown> = {};
      for (const key of Object.keys(item as Record<string, unknown>))
        next[key] = visit((item as Record<string, unknown>)[key]);
      return next;
    }
    return item;
  };
  return visit(copy) as T;
}
