/** Completion-based polling. Hidden/offline pages stop scheduling requests;
 * returning to the page refreshes immediately. Failures back off to one minute. */
export function visiblePoll(
  work: () => Promise<unknown>,
  every: number | (() => number),
  {
    immediate = true,
    events = [],
  }: { immediate?: boolean; events?: string[] } = {},
): () => void {
  let stopped = false;
  let running = false;
  let requested = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const visible = () =>
    document.visibilityState !== "hidden" && navigator.onLine !== false;
  const schedule = () => {
    clearTimeout(timer);
    const interval = typeof every === "number" ? every : every();
    if (!stopped && visible())
      timer = setTimeout(
        () => void run(),
        Math.min(60_000, interval * 2 ** failures),
      );
  };
  const run = async () => {
    clearTimeout(timer);
    if (stopped || !visible() || running) return;
    running = true;
    try {
      await work();
      failures = 0;
    } catch {
      failures = Math.min(failures + 1, 6);
    } finally {
      running = false;
      if (requested && !stopped && visible()) {
        requested = false;
        void run();
      } else {
        requested = false;
        schedule();
      }
    }
  };
  const resume = () => {
    clearTimeout(timer);
    if (visible()) void run();
  };
  const changed = () => {
    if (running && visible()) requested = true;
    else resume();
  };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("focus", resume);
  window.addEventListener("online", resume);
  window.addEventListener("offline", resume);
  for (const event of events) window.addEventListener(event, changed);
  if (immediate) void run();
  else schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("focus", resume);
    window.removeEventListener("online", resume);
    window.removeEventListener("offline", resume);
    for (const event of events) window.removeEventListener(event, changed);
  };
}
