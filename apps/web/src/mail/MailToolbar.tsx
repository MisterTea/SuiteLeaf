import type { Dispatch, SetStateAction } from "react";
import type { Account, Folder, Listing } from "./client";
export function MailToolbar({
  account,
  folders,
  folder,
  listing,
  selected,
  busy,
  loading,
  perform,
  moveSpecial,
  setSelected,
}: {
  account?: Account;
  folders: Folder[];
  folder: string;
  listing: Listing;
  selected: number[];
  busy: boolean;
  loading: boolean;
  perform: (action: string, body?: Record<string, unknown>) => Promise<unknown>;
  moveSpecial: (special: string) => void;
  setSelected: Dispatch<SetStateAction<number[]>>;
}) {
  return (
    <div className="mail-toolbar" aria-label="Message actions">
      <button
        disabled={!selected.length || busy || loading}
        onClick={() => {
          const dueAt = window.prompt(
            "Snooze until (date and time, e.g. 2026-11-10T09:00)",
          );
          if (dueAt && !Number.isNaN(Date.parse(dueAt)))
            void perform("snooze", {
              dueAt: new Date(dueAt).toISOString(),
            });
        }}
      >
        Snooze
      </button>
      {account?.provider === "gmail" && (
        <>
          <button
            disabled={!selected.length || busy || loading}
            onClick={() => {
              const label = window.prompt("Apply Gmail label");
              if (label) void perform("labels", { labels: [label], add: true });
            }}
          >
            Apply label
          </button>
          <button
            disabled={!selected.length || busy || loading}
            onClick={() => {
              const label = window.prompt("Remove Gmail label");
              if (label)
                void perform("labels", { labels: [label], add: false });
            }}
          >
            Remove label
          </button>
        </>
      )}
      <label className="mail-check">
        <input
          type="checkbox"
          aria-label="Select all messages"
          disabled={loading || busy}
          checked={
            listing.messages.length > 0 &&
            selected.length === listing.messages.length
          }
          onChange={(e) =>
            setSelected(
              e.target.checked ? listing.messages.map((m) => m.uid) : [],
            )
          }
        />
        {selected.length} selected
      </label>
      <button
        disabled={!selected.length || busy || loading}
        onClick={() => moveSpecial("\\Archive")}
      >
        Archive
      </button>
      <button
        disabled={!selected.length || busy || loading}
        onClick={() => moveSpecial("\\Trash")}
      >
        Trash
      </button>
      <button
        disabled={!selected.length || busy || loading}
        onClick={() => moveSpecial("\\Junk")}
      >
        Spam
      </button>
      <select
        aria-label="Move to"
        value=""
        disabled={!selected.length || busy || loading}
        onChange={(e) => {
          if (e.target.value)
            void perform("move", { destination: e.target.value });
        }}
      >
        <option value="">Move to…</option>
        {folders
          .filter((f) => f.path !== folder)
          .map((f) => (
            <option key={f.path}>{f.path}</option>
          ))}
      </select>
      <select
        aria-label="Copy to folder"
        value=""
        disabled={!selected.length || busy || loading}
        onChange={(e) => {
          if (e.target.value)
            void perform("copy", { destination: e.target.value });
        }}
      >
        <option value="">Copy to…</option>
        {folders
          .filter((f) => f.path !== folder)
          .map((f) => (
            <option key={f.path}>{f.path}</option>
          ))}
      </select>
      <button
        disabled={!selected.length || busy || loading}
        onClick={() => void perform("flags", { flag: "\\Seen", add: true })}
      >
        Mark read
      </button>
      <button
        disabled={!selected.length || busy || loading}
        onClick={() => void perform("flags", { flag: "\\Seen", add: false })}
      >
        Mark unread
      </button>
      <button
        disabled={!selected.length || busy || loading}
        onClick={() => {
          if (
            window.confirm(
              "Permanently delete selected messages? This cannot be undone.",
            )
          )
            void perform("delete");
        }}
      >
        Delete forever
      </button>
    </div>
  );
}
