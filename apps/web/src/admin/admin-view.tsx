import { Link } from "react-router-dom";
import type { SyncHealth } from "../upload-queue";
import { adminDestination, documentLabel, formatBytes } from "./admin-model";

export function AdminLink({
  cluster,
  role,
}: {
  cluster: boolean;
  role?: string | null;
}) {
  if (adminDestination(cluster, role) !== "admin") return null;
  return (
    <Link className="admin-link" to="/admin">
      Admin
    </Link>
  );
}

export function DocumentTrail({
  entries,
}: {
  entries: { at: string; action: string; name: string }[];
}) {
  if (entries.length === 0) return <p>No documents opened or edited yet.</p>;
  return (
    <ul className="admin-list" aria-label="Documents">
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${entry.action}-${index}`}>
          <span>{documentLabel(entry.action, entry.name)}</span>
          <small className="admin-muted">{entry.at}</small>
        </li>
      ))}
    </ul>
  );
}

export function ReplicationLagNote({
  pending,
  peers,
}: {
  pending: number;
  peers: { peer: string; sameEpoch: boolean; behind: number }[];
}) {
  return (
    <section className="admin-card" aria-label="Replication">
      <h2>Replication</h2>
      <p>
        {pending} operations waiting to apply on this node. Counts only. Document contents are not
        included.
      </p>
      {peers.length === 0 ? (
        <p>No other node has synced with this one yet.</p>
      ) : (
        <ul className="admin-list">
          {peers.map((peer) => (
            <li key={peer.peer}>
              <span>{peer.peer}</span>
              <small className="admin-muted">
                {peer.sameEpoch
                  ? `${peer.behind} operations behind`
                  : "Different database. The saved cursor does not apply."}
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export type BackupFreshness = {
  configured: boolean;
  readable?: boolean;
  recordedAt?: string;
  contentCount?: number;
  drilledAt?: string;
  elapsedMs?: number | null;
  restoreTested?: boolean;
  due?: boolean;
  schedule?: string;
};

const SCHEDULE_NOTES = new Set([
  "No backup has been recorded.",
  "The last backup time is not a time.",
  "That backup is newer than the current time.",
  "A backup is due.",
  "The last backup is still inside the schedule.",
  "The backup schedule must be from 1 to 168 hours.",
  "The current time is not a time.",
]);

const BACKUP_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function shownBackupTime(value: string | undefined): string | null {
  return value && BACKUP_TIME.test(value) ? value : null;
}

/** The backup note. A time that is not a timestamp is not repeated. */
export function backupFreshnessText(report: BackupFreshness): string {
  if (!report.configured) return "No backup directory is set.";
  if (report.readable === false) return "The backup directory could not be read.";
  const written = shownBackupTime(report.recordedAt);
  const lead = written ? `Last written ${written}.` : "The backup time is not a date.";
  const count =
    Number.isInteger(report.contentCount) && (report.contentCount ?? -1) >= 0
      ? `${report.contentCount} ${report.contentCount === 1 ? "file" : "files"}.`
      : "The file count is not a number.";
  let test = "No successful restore test is recorded.";
  if (report.restoreTested) {
    const when = shownBackupTime(report.drilledAt);
    const elapsed = report.elapsedMs;
    const ms = Number.isInteger(elapsed) && (elapsed ?? -1) >= 0 ? `${elapsed} ms` : "";
    test =
      when && written && when < written
        ? `Restore test ${when} is older than this backup.`
        : when
          ? ms
            ? `Restore test ${when}, ${ms}.`
            : `Restore test ${when}.`
          : "The restore test time is not a date.";
  }
  const schedule = SCHEDULE_NOTES.has(report.schedule ?? "") ? ` ${report.schedule}` : "";
  return `${lead} ${count} ${test}${schedule} This is not a recovery-time target.`;
}

/** Backup time and restore-test evidence. Hashes and file bytes are not shown. */
export function BackupFreshnessNote({ report }: { report: BackupFreshness }) {
  return (
    <section className="admin-card" aria-label="Backup">
      <h2>Backup</h2>
      <p>{backupFreshnessText(report)}</p>
    </section>
  );
}

/** One retry button per failed upload. The file id is not shown. */
export function FailedUploadList({
  jobs,
  onRetry,
}: {
  jobs: { itemId: string; failure?: { remedy: string } }[];
  onRetry: (itemId: string) => void;
}) {
  const failed = jobs.filter((job) => job.failure);
  if (!failed.length) return null;
  return (
    <ul className="admin-list" aria-label="Failed uploads">
      {failed.map((job, index) => (
        <li key={job.itemId}>
          <span>
            File {index + 1}. {job.failure?.remedy}
          </span>
          <button type="button" onClick={() => onRetry(job.itemId)}>
            Retry
          </button>
        </li>
      ))}
    </ul>
  );
}

/** This browser's SuiteDrive upload queue. It does not name files or quote server errors. */
export function SyncHealthNote({ health }: { health: SyncHealth }) {
  return (
    <section className="admin-card" aria-label="Uploads from this browser">
      <h2>Uploads from this browser</h2>
      <p>
        {health.pendingFiles} {health.pendingFiles === 1 ? "file" : "files"} waiting,{" "}
        {formatBytes(health.pendingBytes)}. {health.retrying} retrying. {health.needsPerson} waiting
        for someone to act.{" "}
        {health.lastSuccessAt !== undefined
          ? `The last successful upload was at ${new Date(health.lastSuccessAt).toISOString()}.`
          : "No upload has succeeded from this browser."}{" "}
        This is not other people's uploads, and it does not include file names or contents.
      </p>
      {health.failures.length > 0 ? (
        <ul className="admin-list">
          {health.failures.map((failure) => (
            <li key={failure.kind}>
              <span>
                {failure.files} {failure.kind}
              </span>
              <small className="admin-muted">{failure.remedy}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function OrganizationExportButton({
  busy,
  error,
  onExport,
}: {
  busy: boolean;
  error: string;
  onExport: () => void;
}) {
  return (
    <section className="access-notes" aria-label="Organization export">
      <h2>Organization export</h2>
      <p>
        Accounts, groups, sharing, and a file list with names, owners, the folder each file is in, and whether a file is in the trash. Passwords and file
        bytes are not included.
      </p>
      <button type="button" onClick={onExport} disabled={busy}>
        {busy ? "Exporting…" : "Download export"}
      </button>
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function CycleNotice({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="admin-error" role="alert">
      {message}
    </p>
  );
}
