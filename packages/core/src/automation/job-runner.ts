import type { AutomationJob } from "./types";

export type JobHandler = (
  params: Record<string, unknown>,
  context: { dryRun: boolean },
) => Promise<Record<string, unknown>>;

export class AutomationJobRunner {
  private jobs: Map<string, AutomationJob> = new Map();
  private idempotencyRegistry: Map<string, string> = new Map(); // idempotencyKey -> jobId
  private handlers: Map<string, JobHandler> = new Map();
  private concurrencyLimit: number;
  private runningCount = 0;

  constructor(options: { concurrencyLimit?: number } = {}) {
    this.concurrencyLimit = options.concurrencyLimit ?? 5;
  }

  registerHandler(name: string, handler: JobHandler) {
    this.handlers.set(name, handler);
  }

  createJob(params: {
    name: string;
    trigger: AutomationJob["trigger"];
    idempotencyKey?: string;
    params?: Record<string, unknown>;
    maxAttempts?: number;
    dryRun?: boolean;
  }): AutomationJob {
    if (params.idempotencyKey && this.idempotencyRegistry.has(params.idempotencyKey)) {
      const existingJobId = this.idempotencyRegistry.get(params.idempotencyKey)!;
      return this.jobs.get(existingJobId)!;
    }

    const id = `job_${Math.random().toString(36).slice(2, 9)}`;
    const job: AutomationJob = {
      id,
      name: params.name,
      trigger: params.trigger,
      idempotencyKey: params.idempotencyKey,
      status: "pending",
      dryRun: params.dryRun ?? false,
      attempts: 0,
      maxAttempts: params.maxAttempts ?? 3,
      params: params.params ?? {},
      createdAt: new Date().toISOString(),
    };

    this.jobs.set(id, job);
    if (params.idempotencyKey) {
      this.idempotencyRegistry.set(params.idempotencyKey, id);
    }
    return job;
  }

  getJob(id: string): AutomationJob | undefined {
    return this.jobs.get(id);
  }

  async runJob(id: string): Promise<AutomationJob> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found.`);

    if (job.status === "completed") {
      return job; // Idempotent: return completed job without re-executing
    }

    if (this.runningCount >= this.concurrencyLimit) {
      throw new Error(`Concurrency limit (${this.concurrencyLimit}) exceeded. Job queued.`);
    }

    const handler = this.handlers.get(job.name);
    if (!handler) {
      job.status = "failed";
      job.error = `No handler registered for '${job.name}'`;
      return job;
    }

    this.runningCount++;
    job.status = "running";
    job.attempts++;

    try {
      const result = await handler(job.params, { dryRun: job.dryRun });
      job.result = result;
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      job.error = undefined;
    } catch (err: unknown) {
      job.error = err instanceof Error ? err.message : String(err);
      job.status = "failed";
    } finally {
      this.runningCount--;
    }

    return job;
  }

  async resumeJob(id: string): Promise<AutomationJob> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found.`);
    if (job.status !== "failed") {
      throw new Error(`Job ${id} is in status '${job.status}', only failed jobs can be resumed.`);
    }
    job.status = "pending";
    return this.runJob(id);
  }
}
