import { randomUUID } from "node:crypto";
import type { MailStore, MailJob } from "./store";
import type { MailAccount } from "./types";
import { validateCompose } from "./types";
import { mailCommand } from "./service";
import { authorizedAccount } from "./google";
import { syncMailAccounts } from "./sync";
import { withMailLock } from "./locks";

export function scheduleTime(input: unknown, now = Date.now()) {
  if (typeof input !== "string" || Number.isNaN(Date.parse(input)))
    throw new Error("Invalid scheduled time.");
  const time = Date.parse(input);
  if (time < now + 5_000 || time > now + 366 * 86_400_000)
    throw new Error("Choose a time between 5 seconds and one year from now.");
  return new Date(time).toISOString();
}
export async function jobCommand(
  store: MailStore,
  user: string,
  account: MailAccount,
  action: string,
  body: Record<string, unknown>,
  owner: string,
) {
  if (action === "jobs")
    return (await store.records<MailJob>(user, account.id, "job")).map((r) => ({
      id: r.id,
      key: r.payload.key,
      type: r.payload.type,
      subject: r.payload.subject,
      dueAt: r.dueAt,
      state: r.state,
      result: r.payload.result,
    }));
  if (action === "cancelJob" || action === "editJob") {
    return withMailLock(
      `${user}:${account.id}:${String(body.key)}`,
      async () => {
        const record = await store.record<MailJob>(
          user,
          account.id,
          "job",
          String(body.key),
        );
        if (
          !record ||
          (record.state !== "scheduled" &&
            !(action === "editJob" && record.state === "cancelled"))
        )
          throw new Error("The job has already started or no longer exists.");
        if (record.owner !== owner)
          throw new Error(
            "Use the SuiteLeaf server that scheduled this job to cancel it.",
          );
        if (record.payload.type === "snooze") {
          record.dueAt = new Date().toISOString();
          await store.updateRecord(record);
          return {
            ok: true,
            notice: "Snoozed messages will return on the next worker tick.",
          };
        }
        record.state = "cancelled";
        await store.updateRecord(record);
        return { ok: true, message: record.payload.message };
      },
    );
  }
  if (!owner)
    throw new Error(
      "This server has no mail worker identity. Configure SUITELEAF_MAIL_WORKER_ID.",
    );
  const dueAt = scheduleTime(body.dueAt);
  const key = randomUUID();
  let job: MailJob;
  if (action === "scheduleSend") {
    const message = validateCompose(body.message);
    if (!message.to.trim()) throw new Error("Enter a recipient.");
    job = { key, type: "send", message, subject: message.subject };
  } else if (action === "snooze") {
    const moved = (await mailCommand(account, "snooze", body)) as {
      folder: string;
      uidValidity: string;
      uids: number[];
    };
    job = {
      key,
      type: "snooze",
      folder: moved.folder,
      uidValidity: moved.uidValidity,
      uids: moved.uids,
      destination: String(body.folder),
      subject: `${moved.uids.length} snoozed message(s)`,
    };
  } else throw new Error("Unknown job command.");
  try {
    await store.saveRecord(user, account.id, "job", key, job, {
      state: "scheduled",
      dueAt,
      owner,
    });
  } catch (error) {
    if (job.type === "snooze") {
      try {
        await mailCommand(
          account,
          "move",
          job as unknown as Record<string, unknown>,
        );
      } catch {
        throw new Error(
          "Snooze storage failed. Messages remain in SuiteLeaf/Snoozed; move them back manually.",
        );
      }
    }
    throw error;
  }
  if (
    action === "scheduleSend" &&
    body.draftRef &&
    typeof body.draftRef === "object"
  ) {
    const ref = body.draftRef as Record<string, unknown>;
    try {
      await mailCommand(account, "delete", { ...ref, uids: [ref.uid] });
    } catch {
      /* Queue acceptance must not be reported as a send failure. */
    }
  }
  return { ok: true, key, dueAt };
}
export async function runMailJobs(
  store: MailStore,
  owner: string,
  now = new Date().toISOString(),
) {
  for (const candidate of await store.dueJobs(owner, now)) {
    await withMailLock(
      `${candidate.userId}:${candidate.accountId}:${candidate.payload.key}`,
      async () => {
        const row = await store.record<MailJob>(
          candidate.userId,
          candidate.accountId,
          "job",
          candidate.payload.key,
        );
        if (
          !row ||
          row.state !== "scheduled" ||
          row.dueAt > now ||
          row.owner !== owner
        )
          return;
        // Persist the intent before SMTP. An interrupted send is never automatically retried.
        row.state = "running";
        await store.updateRecord(row);
        try {
          if (!(await store.ownerActive(row.userId)))
            throw new Error("Owner unavailable");
          const account = await authorizedAccount(
            store,
            row.userId,
            await store.get(row.userId, row.accountId),
          );
          const result = (await mailCommand(
            account,
            row.payload.type === "send" ? "send" : "move",
            row.payload.type === "send"
              ? { message: row.payload.message }
              : (row.payload as unknown as Record<string, unknown>),
          )) as { warning?: string };
          row.state = "completed";
          row.payload.result = result.warning || "Completed.";
          // Drop queued message content after success; retain a small status receipt.
          delete row.payload.message;
        } catch {
          row.state = row.payload.type === "send" ? "uncertain" : "failed";
          row.payload.result =
            row.payload.type === "send"
              ? "Delivery could not be confirmed. Check Sent before creating another send."
              : "Messages could not be returned. Check the Snoozed folder and move them manually.";
        }
        await store.updateRecord(row);
      },
    );
  }
}
export function startMailJobs(store: MailStore, owner: string) {
  let stopped = false,
    running = false,
    syncing = false,
    ready = false;
  void store
    .interruptedJobs(owner)
    .then(async (rows) => {
      for (const row of rows) {
        row.state = "uncertain";
        row.payload.result =
          "The server restarted during this job. Check the provider before retrying.";
        await store.updateRecord(row);
      }
    })
    .catch(() => {})
    .finally(() => {
      ready = true;
    });
  const timer = setInterval(() => {
    if (stopped || running || !ready) return;
    running = true;
    void runMailJobs(store, owner)
      .catch(() => {})
      .finally(() => {
        running = false;
      });
  }, 5000);
  const syncTimer = setInterval(() => {
    if (stopped || syncing) return;
    syncing = true;
    void syncMailAccounts(store, owner)
      .catch(() => {})
      .finally(() => {
        syncing = false;
      });
  }, 60_000);
  timer.unref();
  syncTimer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
    clearInterval(syncTimer);
  };
}
