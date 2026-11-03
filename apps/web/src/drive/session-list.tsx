import { useState } from "react";
import { api, json } from "../node-client";
import { sessionActivityNote } from "../session-policy";

export type VisibleSession = {
  id: string;
  userAgent: string;
  current: boolean;
  updatedAt?: string;
  expiresAt?: string;
  reauth?: boolean;
};

function deviceName(session: VisibleSession): string {
  const name = session.userAgent.trim();
  if (!name || /[\r\n]/.test(session.userAgent)) return "Unnamed device";
  return name;
}

/** The signed-in person's sessions. The token is not part of this list. */
export async function nodeSessions(): Promise<VisibleSession[]> {
  const body = (await (await api("/api/node/sessions")).json()) as { sessions?: VisibleSession[] };
  return body.sessions ?? [];
}

/** Replace one session. The new token is discarded here. */
export async function rotateNodeSession(id: string): Promise<void> {
  await api(`/api/node/sessions/${encodeURIComponent(id)}/rotate`, { method: "POST" });
}

/** End one session. */
export async function endNodeSession(id: string): Promise<void> {
  await api(`/api/node/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Sign out every session whose device name matches. The name is not returned. */
export async function endLostDevice(device: string): Promise<number> {
  const response = await api("/api/node/sessions/lost-device", {
    method: "POST",
    ...json({ device }),
  });
  if (!response.ok) {
    let message = "";
    try {
      const body = (await response.json()) as { error?: unknown };
      if (body.error === "Name the device to sign out.") message = body.error;
    } catch {
      message = "";
    }
    throw new Error(message || "That device was not signed out.");
  }
  const body = (await response.json()) as { ended?: unknown };
  return typeof body.ended === "number" && Number.isInteger(body.ended) ? body.ended : 0;
}

/** Ask one device to sign in again. The response body is discarded. */
export async function requireNodeSession(id: string): Promise<void> {
  await api(`/api/node/sessions/${encodeURIComponent(id)}/reauth`, { method: "POST" });
}

/** Devices for the signed-in person. The session token is not shown. */
export function SessionList({
  sessions,
  onRotate,
  onEnd,
  onReauth,
  onLostDevice,
  activity,
}: {
  sessions: VisibleSession[];
  onRotate: (id: string) => Promise<unknown>;
  onEnd: (id: string) => Promise<unknown>;
  onReauth?: (id: string) => Promise<unknown>;
  onLostDevice?: (device: string) => Promise<number>;
  activity?: { now: string; idleSecs?: number };
}) {
  const [note, setNote] = useState("");
  const [device, setDevice] = useState("");
  return (
    <section className="access-notes" aria-label="Sessions">
      <h2>Sessions</h2>
      {sessions.length === 0 ? <p>No sessions.</p> : null}
      <ul>
        {sessions.map((session) => {
          const name = deviceName(session);
          return (
            <li key={session.id}>
              <span>{name}</span>
              {session.current ? <span> This device.</span> : null}
              {activity ? (
                <span>
                  {" "}
                  {sessionActivityNote({
                    expiresAt: session.expiresAt,
                    updatedAt: session.updatedAt,
                    now: activity.now,
                    idleSecs: activity.idleSecs,
                    reauth: session.reauth,
                  })}
                </span>
              ) : null}
              {onReauth ? (
                <button
                  type="button"
                  aria-label={`Ask ${name} to sign in again`}
                  onClick={() => {
                    void onReauth(session.id).then(() => {
                      setNote("That device must sign in again.");
                    });
                  }}
                >
                  Ask to sign in again
                </button>
              ) : null}
              <button
                type="button"
                aria-label={`Rotate ${name}`}
                onClick={() => {
                  void onRotate(session.id).then(() => {
                    setNote("That session was replaced. The new token is not shown here.");
                  });
                }}
              >
                Rotate
              </button>
              {session.current ? null : (
                <button
                  type="button"
                  aria-label={`Sign out ${name}`}
                  onClick={() => {
                    void onEnd(session.id).then(() => {
                      setNote("That device was signed out.");
                    });
                  }}
                >
                  Sign out
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {onLostDevice ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const name = device;
            void onLostDevice(name)
              .then((ended) => {
                setDevice("");
                setNote(
                  ended > 0 ? "That device was signed out." : "No session uses that device name.",
                );
              })
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : "";
                setNote(
                  message === "Name the device to sign out."
                    ? message
                    : "That device was not signed out.",
                );
              });
          }}
        >
          <label>
            Device name
            <input
              aria-label="Lost device name"
              value={device}
              onChange={(event) => setDevice(event.target.value)}
            />
          </label>
          <button type="submit">Sign out that device</button>
        </form>
      ) : null}
      {note ? <p role="status">{note}</p> : null}
    </section>
  );
}
