import { useEffect, useState } from "react";

/** What a server reports about the rest of its cluster. */
export interface ServerSync {
  /** Other servers it is connected to right now. */
  peers: number;
  /** Files whose content it is still copying from other servers. */
  replicating: number;
  /** Changes whenever the server's database changes. */
  heads: string;
}

export async function serverSync(url: string): Promise<ServerSync | null> {
  try {
    const response = await fetch(`${url}/api/node/info`);
    if (!response.ok) return null;
    const info = await response.json();
    return {
      peers: Array.isArray(info.peers) ? info.peers.length : 0,
      replicating: Number(info.suitedrive?.replicating) || 0,
      heads: Array.isArray(info.suitedb?.heads) ? info.suitedb.heads.join() : "",
    };
  } catch {
    return null;
  }
}

/** One line for people: which servers this one shares files with, and
 * whether files are still on their way. A lone server has nothing to say. */
export function syncSummary(sync: ServerSync | null): string | null {
  if (!sync) return null;
  const s = (n: number) => (n === 1 ? "" : "s");
  if (sync.replicating)
    return `Copying ${sync.replicating} file${s(sync.replicating)} from other servers…`;
  if (!sync.peers) return null;
  return `Connected to ${sync.peers} other server${s(sync.peers)}`;
}

/** Poll a server's cluster status while the page is visible. */
export function useServerSync(url: string, every = 4000) {
  const [sync, setSync] = useState<ServerSync | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => {
      if (document.visibilityState === "hidden") return;
      void serverSync(url).then((next) => alive && setSync(next));
    };
    poll();
    const timer = setInterval(poll, every);
    addEventListener("focus", poll);
    return () => {
      alive = false;
      clearInterval(timer);
      removeEventListener("focus", poll);
    };
  }, [url, every]);
  return sync;
}

/** When a SuiteDrive item last changed: the time for today, like Google
 * Drive, otherwise the date. */
export function formatModified(iso: string, now = new Date()) {
  const date = new Date(iso);
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
