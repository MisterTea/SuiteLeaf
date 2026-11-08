const tails = new Map<string, Promise<void>>();
/** Serialize a job's cancellation and delivery on its owning sidecar. */
export async function withMailLock<T>(
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(key) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  tails.set(key, next);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (tails.get(key) === next) tails.delete(key);
  }
}
