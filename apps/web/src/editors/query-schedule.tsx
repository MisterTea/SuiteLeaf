import { useEffect, useRef, useState } from "react";
import {
  queryDocument,
  runScheduledRefresh,
  sourceUrlProblem,
  type QueryDocument,
  type QueryRow,
  type QuerySchedule,
} from "@suiteleaf/core";

type RemoteTable = { ok: boolean; rows: string[][] };

/** Refresh an https source on a timer. The address is not shown in the note. */
export function QuerySchedule({
  document = queryDocument([]),
  fetchRows,
  clock = () => new Date().toISOString(),
  onRows,
  initial,
  onRemember,
  onForget,
}: {
  document?: QueryDocument;
  fetchRows?: (url: string, authorization?: string) => Promise<RemoteTable>;
  clock?: () => string;
  onRows?: (rows: QueryRow[]) => string | void;
  initial?: { everyMinutes: number; source: string } | null;
  onRemember?: (minutes: number, source: string) => void;
  onForget?: () => void;
}) {
  const [address, setAddress] = useState(initial?.source ?? "");
  const [minutes, setMinutes] = useState(initial ? String(initial.everyMinutes) : "1");
  const [token, setToken] = useState("");
  const tokenRef = useRef("");
  const [note, setNote] = useState("");
  const timer = useRef<number | null>(null);
  const schedule = useRef<QuerySchedule | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, []);

  async function tick(started: number) {
    const current = schedule.current;
    if (!current || started !== generation.current) return;
    const result = await runScheduledRefresh({
      document,
      schedule: current,
      now: clock(),
      allowed: true,
      fetchRows: async (url) => {
        const authorization = tokenRef.current.trim();
        if (fetchRows) return fetchRows(url, authorization || undefined);
        const response = await fetch(
          url,
          authorization ? { headers: { Authorization: `Bearer ${authorization}` } } : undefined,
        );
        if (!response.ok) return { ok: false, rows: [] };
        const body = (await response.json()) as { rows?: string[][] };
        return { ok: true, rows: Array.isArray(body.rows) ? body.rows : [] };
      },
      previous: null,
    });
    if (started !== generation.current || !schedule.current) return;
    schedule.current = result.schedule;
    if (!result.run) return;
    if (!result.run.ok) {
      setNote(result.run.error);
      return;
    }
    const written = onRows?.(result.run.rows);
    setNote(typeof written === "string" ? written : "The source was refreshed.");
  }

  function start() {
    const count = Number(minutes.trim());
    if (!Number.isInteger(count) || count < 1 || count > 1440) {
      setNote("Name the wait in whole minutes.");
      return;
    }
    const problem = sourceUrlProblem(address.trim());
    if (problem) {
      setNote(problem);
      return;
    }
    if (timer.current !== null) window.clearInterval(timer.current);
    const everyMs = count * 60_000;
    const url = address.trim();
    onRemember?.(count, url);
    generation.current += 1;
    const started = generation.current;
    schedule.current = { url, everyMs, lastRunAt: null };
    void tick(started);
    timer.current = window.setInterval(() => void tick(started), everyMs);
  }

  function stop() {
    generation.current += 1;
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    schedule.current = null;
    onForget?.();
    setNote("The scheduled refresh is stopped.");
  }

  return (
    <div>
      <label>
        Source address
        <input
          aria-label="Source address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </label>
      <label>
        Source token
        <input
          aria-label="Source token"
          type="password"
          value={token}
          autoComplete="off"
          onChange={(event) => {
            const next = event.target.value.replace(/[\r\n]/g, "");
            tokenRef.current = next;
            setToken(next);
          }}
        />
      </label>
      <label>
        Minutes
        <input aria-label="Refresh minutes" value={minutes} onChange={(event) => setMinutes(event.target.value)} />
      </label>
      <button type="button" onClick={start}>
        Refresh on a schedule
      </button>
      <button type="button" onClick={stop}>
        Stop scheduled refresh
      </button>
      {note ? <p>{note}</p> : null}
    </div>
  );
}
