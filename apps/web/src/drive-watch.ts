/** What the open file should do when SuiteDrive's head is not the version
 * this tab last stored. */
export type DriveWatchDecision = "idle" | "conflict" | "adopt" | "wait";

export function driveWatchDecision(input: {
  /** This tab is uploading. The write's If-Match response reports a real conflict. */
  uploading: boolean;
  /** Local edits have not been stored as the current SuiteDrive head yet. */
  unsent: boolean;
  remoteHead?: string | null;
  localHead?: string | null;
}): DriveWatchDecision {
  // The head we just wrote is visible before this tab stores it. That is our
  // upload, not a newer copy from someone else. If-Match reports a real clash.
  if (input.uploading) return "wait";
  if (!input.remoteHead || input.remoteHead === input.localHead) return "idle";
  if (input.unsent) return "conflict";
  return "adopt";
}
