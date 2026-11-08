import { useEffect, useState } from "react";
import { mailCall, type Compose } from "./client";
interface Job {
  id: string;
  key: string;
  type: string;
  subject: string;
  dueAt: string;
  state: string;
  result?: string;
}
export function JobList({
  accountId,
  onClose,
  onEdit,
}: {
  accountId: string;
  onClose: () => void;
  onEdit?: (message: Compose) => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void mailCall<Job[]>("jobs", { accountId })
      .then((rows) => {
        if (!cancelled) setJobs(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    const timer = setTimeout(() => setRevision((n) => n + 1), 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accountId, revision]);
  return (
    <section
      className="mail-settings"
      aria-label="Scheduled mail and snoozed messages"
    >
      <header>
        <h2>Scheduled & snoozed</h2>
        <button onClick={onClose}>Back to inbox</button>
      </header>
      <p>
        Jobs run on the server that created them, including while this window is
        closed.
      </p>
      {error && <p role="alert">{error}</p>}
      {jobs.length ? (
        jobs
          .sort((a, b) => b.dueAt.localeCompare(a.dueAt))
          .map((job) => (
            <article className="mail-job" key={job.id}>
              <strong>{job.subject || "(no subject)"}</strong>
              <p>
                {job.type === "snooze" ? "Return to inbox" : "Send"} ·{" "}
                {new Date(job.dueAt).toLocaleString()} · {job.state}
              </p>
              {job.result && <p>{job.result}</p>}
              {job.type === "send" &&
                (job.state === "scheduled" || job.state === "cancelled") &&
                onEdit && (
                  <button
                    onClick={() => {
                      void mailCall<{ message?: Compose }>("editJob", {
                        accountId,
                        key: job.key,
                      })
                        .then((result) => {
                          if (result.message) onEdit(result.message);
                          else
                            setError(
                              "The queued message could not be reopened.",
                            );
                        })
                        .catch((e) => setError(e.message));
                    }}
                  >
                    Cancel and edit
                  </button>
                )}
              {job.state === "scheduled" && (
                <button
                  onClick={() => {
                    void mailCall("cancelJob", { accountId, key: job.key })
                      .then(() => setRevision((n) => n + 1))
                      .catch((e) => setError(e.message));
                  }}
                >
                  {job.type === "snooze" ? "Unsnooze now" : "Cancel send"}
                </button>
              )}
            </article>
          ))
      ) : (
        <p>No scheduled jobs.</p>
      )}
    </section>
  );
}
