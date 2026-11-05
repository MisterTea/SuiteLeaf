export type RoomLink = "joining" | "open" | "reconnecting" | "stopped";
export type RoomStop = "unauthorized" | "forbidden" | "version" | "role";

/** The collaboration protocol this app speaks. */
export const COLLAB_PROTOCOL = 1;

export function joinMessage(): { type: "join"; protocol: number } {
  return { type: "join", protocol: COLLAB_PROTOCOL };
}

/**
 * How often an open room asks for a fresh token. The node rechecks the
 * socket's token every few seconds, and a token lasts 15 minutes, so a new one
 * is sent well before the old one stops signing in.
 */
export const RENEW_TOKEN_EVERY_MS = 30_000;

export function authMessage(accessToken: string): {
  type: "auth";
  accessToken: string;
  protocol: number;
} {
  return { type: "auth", accessToken, protocol: COLLAB_PROTOCOL };
}

/**
 * An expired token pauses the room and keeps queued edits for the next sign-in.
 * A lost grant stops the room. A changed role stops it until the file is opened
 * again with that role. Any other word is not a stop, and it is not kept.
 */
export function authFailurePlan(reason: string): {
  pauseForSignIn: boolean;
  giveUp: boolean;
  stop: RoomStop | null;
} {
  if (reason === "unauthorized") {
    return { pauseForSignIn: true, giveUp: false, stop: "unauthorized" };
  }
  if (reason === "forbidden") {
    return { pauseForSignIn: false, giveUp: true, stop: "forbidden" };
  }
  if (reason === "role-changed") {
    return { pauseForSignIn: false, giveUp: true, stop: "role" };
  }
  return { pauseForSignIn: false, giveUp: false, stop: null };
}

function edits(waiting: number): string {
  return waiting === 1 ? "1 edit is" : `${waiting} edits are`;
}

/** A sentence for the open document. It names a count, not the document text. */
export function roomRecoveryText(
  link: RoomLink,
  waiting: number,
  stop?: RoomStop,
): string | null {
  const pending = Math.max(0, Math.floor(waiting));
  if (link === "stopped") {
    if (stop === "unauthorized") {
      return pending > 0
        ? "Sign in again. Edits still on this device were not stored."
        : "Sign in again to open the shared document.";
    }
    if (stop === "forbidden") {
      return pending > 0
        ? "You no longer have access. Edits still on this device were not stored."
        : "You no longer have access to this shared document.";
    }
    if (stop === "role") {
      return pending > 0
        ? "Your access to this shared document changed. Open it again. Edits still on this device were not stored."
        : "Your access to this shared document changed. Open it again to continue.";
    }
    if (stop === "version") {
      return "This app speaks collaboration protocol 1.";
    }
    return pending > 0
      ? "The shared document stopped. Edits still on this device were not stored."
      : "The shared document stopped.";
  }
  if (link === "open") {
    return pending > 0 ? `${edits(pending)} waiting to be stored.` : null;
  }
  if (pending > 0) {
    const action = link === "joining" ? "Joining" : "Reconnecting";
    return `${action}. ${edits(pending)} still on this device.`;
  }
  if (link === "joining") return "Joining the shared document.";
  return "Reconnecting to the shared document.";
}
