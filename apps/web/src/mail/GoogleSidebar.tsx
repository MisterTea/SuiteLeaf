import { useEffect, useState } from "react";
import { mailCall } from "./client";
interface Task {
  id: string;
  title: string;
  notes?: string;
}
interface Event {
  id: string;
  summary?: string;
  htmlLink: string;
  start: { dateTime?: string; date?: string };
}
export function GoogleSidebar({
  accountId,
  onClose,
}: {
  accountId: string;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<Event[]>([]),
    [tasks, setTasks] = useState<Task[]>([]),
    [title, setTitle] = useState(""),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      mailCall<{ items?: Event[] }>("googleCalendar", { accountId }),
      mailCall<{ items?: Task[] }>("googleTasks", { accountId }),
    ])
      .then(([calendar, taskList]) => {
        if (!cancelled) {
          setEvents(calendar.items || []);
          setTasks(taskList.items || []);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, revision]);
  const run = (action: string, body: Record<string, unknown>) => {
    void mailCall(action, { accountId, ...body })
      .then(() => {
        setTitle("");
        setRevision((n) => n + 1);
      })
      .catch((e) => setError(e.message));
  };
  return (
    <aside className="mail-google-panel" aria-label="Google calendar and tasks">
      <header>
        <h2>Calendar & tasks</h2>
        <button onClick={onClose}>Close panel</button>
      </header>
      {error && <p role="alert">{error}</p>}
      <h3>Upcoming events</h3>
      {events.map((e) => (
        <p key={e.id}>
          <a
            target="_blank"
            rel="noreferrer"
            href={/^https:\/\//.test(e.htmlLink) ? e.htmlLink : undefined}
          >
            {e.summary || "Untitled event"}
          </a>
          <br />
          {e.start.dateTime
            ? new Date(e.start.dateTime).toLocaleString()
            : e.start.date}
        </p>
      ))}
      <h3>Tasks</h3>
      {tasks.map((t) => (
        <p key={t.id}>
          <button
            aria-label={`Complete ${t.title}`}
            onClick={() => run("googleCompleteTask", { id: t.id })}
          >
            ✓
          </button>{" "}
          {t.title}
        </p>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run("googleAddTask", { title });
        }}
      >
        <label>
          New task
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <button>Add task</button>
      </form>
    </aside>
  );
}
