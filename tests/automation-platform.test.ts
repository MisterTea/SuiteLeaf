import { describe, expect, it, vi } from "vitest";
import {
  AutomationJobRunner,
  executeSandboxedScript,
  ScopedAutomationClient,
  signWebhookPayload,
  verifyWebhookSignature,
  WebhookService,
  type AppCredential,
} from "../packages/core/src/automation";
import { createFile, type SheetFile } from "../packages/core/src/native-file";

describe("WP-031: Public APIs, Webhooks, and Safe Automation", () => {
  it("enforces scoped credentials and immediately denies access upon revocation", () => {
    const credential: AppCredential = {
      id: "app_hr_tools",
      name: "HR Automation Tool",
      clientId: "client_hr_123",
      hashedSecret: "secret_hash",
      scopes: ["files.read", "forms.read"], // lacks "files.write"
      resourceConstraints: {
        allowedFileIds: ["doc_allowed_1", "doc_allowed_2"],
      },
      status: "active",
      createdAt: new Date().toISOString(),
    };

    const client = new ScopedAutomationClient(credential);

    // Can access authorized scope and resource
    expect(() => client.checkAccess("files.read", "doc_allowed_1")).not.toThrow();
    expect(client.getAuditLog()).toHaveLength(1);

    // Lacks required scope
    expect(() => client.checkAccess("files.write", "doc_allowed_1")).toThrow(
      "Credential lacks required scope 'files.write'",
    );

    // Out-of-bounds resource constraint
    expect(() => client.checkAccess("files.read", "doc_forbidden_999")).toThrow(
      "Credential is not authorized to access resource 'doc_forbidden_999'",
    );

    // Revocation check
    credential.status = "revoked";
    expect(() => client.checkAccess("files.read", "doc_allowed_1")).toThrow(
      "Application credential has been revoked.",
    );
  });

  it("handles webhooks with HMAC signatures, replay attack protection, retries, dead letters, and secret rotation", async () => {
    const service = new WebhookService();
    const sub = service.registerSubscription({
      url: "https://example.com/webhook",
      events: ["file.created", "form.submitted"],
      signingSecret: "primary_secret_key_1",
      active: true,
    });

    const payload = { fileId: "file_xyz", action: "created" };
    const now = Date.now();

    // 1. Signature generation and verification
    const signature = signWebhookPayload(JSON.stringify(payload), "primary_secret_key_1", now);
    expect(verifyWebhookSignature(JSON.stringify(payload), signature, "primary_secret_key_1", { currentTime: now })).toBe(true);

    // Replay attack protection (timestamp > tolerance)
    expect(
      verifyWebhookSignature(JSON.stringify(payload), signature, "primary_secret_key_1", {
        currentTime: now + 400 * 1000, // 400 seconds later (> 300s tolerance)
      }),
    ).toBe(false);

    // 2. Secret rotation
    service.rotateSecret(sub.id, "rotated_new_secret_key_2");
    expect(sub.signingSecret).toBe("rotated_new_secret_key_2");
    expect(sub.previousSecret).toBe("primary_secret_key_1");

    // Old signature still verifies using previousSecret
    expect(
      verifyWebhookSignature(JSON.stringify(payload), signature, sub.signingSecret, {
        previousSecret: sub.previousSecret,
        currentTime: now,
      }),
    ).toBe(true);

    // 3. Dispatch without senderFn sets status to delivered
    const directDeliveries = await service.dispatchEvent("form.submitted", { formId: "form_1" });
    expect(directDeliveries[0].status).toBe("delivered");

    // 4. Dispatch with HTTP 500 error
    const serverErrorSender = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const failedDeliveries = await service.dispatchEvent("file.created", payload, serverErrorSender);
    expect(failedDeliveries[0].status).toBe("failed");
    expect(failedDeliveries[0].lastError).toContain("500");

    // 5. Dispatch and Retry with dead-letter queue
    const mockSender = vi.fn().mockRejectedValue(new Error("503 Service Unavailable"));
    const deliveries = await service.dispatchEvent("file.created", payload, mockSender);
    expect(deliveries[0].status).toBe("failed");

    // Retry 1 (fails)
    await service.retryDelivery(deliveries[0].id, mockSender, 3);
    expect(deliveries[0].attempts).toBe(2);
    expect(deliveries[0].status).toBe("failed");

    // Successful retry
    const okSender = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const successfulRetryDelivery = await service.retryDelivery(failedDeliveries[0].id, okSender, 3);
    expect(successfulRetryDelivery.status).toBe("delivered");

    // Retry 2 reaches maxAttempts=3 -> dead letter queue
    await service.retryDelivery(deliveries[0].id, mockSender, 3);
    expect(deliveries[0].attempts).toBe(3);
    expect(deliveries[0].status).toBe("dead_letter");
    expect(service.getDeadLetterQueue()).toHaveLength(1);
  });

  it("idempotent job runner prevents duplicate execution and supports inspection & resume", async () => {
    const runner = new AutomationJobRunner();
    let externalExecutionCount = 0;

    runner.registerHandler("sync-external-db", async (params, context) => {
      if (context.dryRun) {
        return { simulated: true, count: 0 };
      }
      externalExecutionCount++;
      if (params.shouldFail) {
        throw new Error("Temporary network timeout connecting to partner API");
      }
      return { syncedCount: 15, updated: true };
    });

    // 1. Dry run execution
    const dryJob = runner.createJob({
      name: "sync-external-db",
      trigger: "manual",
      dryRun: true,
    });
    const dryResult = await runner.runJob(dryJob.id);
    expect(dryResult.status).toBe("completed");
    expect(dryResult.result).toEqual({ simulated: true, count: 0 });
    expect(externalExecutionCount).toBe(0); // Dry-run made 0 external mutations

    // 2. Idempotent job execution with idempotencyKey
    const job1 = runner.createJob({
      name: "sync-external-db",
      trigger: "event",
      idempotencyKey: "idem_key_unique_42",
    });
    await runner.runJob(job1.id);
    expect(job1.status).toBe("completed");
    expect(externalExecutionCount).toBe(1);

    // Creating or running with the same idempotency key does not duplicate execution
    const jobDuplicate = runner.createJob({
      name: "sync-external-db",
      trigger: "event",
      idempotencyKey: "idem_key_unique_42",
    });
    expect(jobDuplicate.id).toBe(job1.id);
    await runner.runJob(jobDuplicate.id);
    expect(externalExecutionCount).toBe(1); // Still 1! Never duplicated!

    // 3. Failed job inspection and resumability
    const failingJob = runner.createJob({
      name: "sync-external-db",
      trigger: "scheduled",
      params: { shouldFail: true },
    });
    await runner.runJob(failingJob.id);
    expect(failingJob.status).toBe("failed");
    expect(failingJob.error).toContain("Temporary network timeout");

    // Repair params and resume failed job
    failingJob.params.shouldFail = false;
    const resumed = await runner.resumeJob(failingJob.id);
    expect(resumed.status).toBe("completed");
    expect(resumed.result?.syncedCount).toBe(15);

    // Resuming a completed job throws error
    await expect(runner.resumeJob(failingJob.id)).rejects.toThrow("only failed jobs can be resumed");

    // Missing handler error
    const noHandlerJob = runner.createJob({ name: "unregistered-task", trigger: "manual" });
    const failedNoHandler = await runner.runJob(noHandlerJob.id);
    expect(failedNoHandler.status).toBe("failed");
    expect(failedNoHandler.error).toContain("No handler registered");

    // getJob inspection
    expect(runner.getJob(failingJob.id)?.id).toBe(failingJob.id);

    // Concurrency limit check
    const throttledRunner = new AutomationJobRunner({ concurrencyLimit: 1 });
    throttledRunner.registerHandler("slow-job", () => new Promise((r) => setTimeout(r, 50)));
    const jA = throttledRunner.createJob({ name: "slow-job", trigger: "manual" });
    const jB = throttledRunner.createJob({ name: "slow-job", trigger: "manual" });
    const pA = throttledRunner.runJob(jA.id);
    await expect(throttledRunner.runJob(jB.id)).rejects.toThrow("Concurrency limit");
    await pA;
  });

  it("sandboxes scripts against escape, secret disclosure, and timeouts", async () => {
    // 1. Blocks dangerous identifiers
    const escapeAttempt = await executeSandboxedScript("return process.env.SECRET_KEY;");
    expect(escapeAttempt.success).toBe(false);
    expect(escapeAttempt.error).toContain("Sandbox security violation");

    // 2. Blocks runaway synchronous loops
    const loopAttempt = await executeSandboxedScript("while(true) {}");
    expect(loopAttempt.success).toBe(false);
    expect(loopAttempt.error).toContain("runaway loop detected");

    // Blocks async execution exceeding timeout
    const timeoutAttempt = await executeSandboxedScript(
      "await new Promise(r => setTimeout(r, 200)); return 'done';",
      {},
      { timeoutMs: 50 },
    );
    expect(timeoutAttempt.success).toBe(false);
    expect(timeoutAttempt.error).toContain("timed out");

    // 3. Safe calculation executes correctly
    const safeCalc = await executeSandboxedScript(
      "const total = items.reduce((acc, x) => acc + x.price, 0); console.log('Calculated:', total); return total * 1.05;",
      {
        items: [
          { name: "item1", price: 100 },
          { name: "item2", price: 200 },
        ],
      },
    );
    expect(safeCalc.success).toBe(true);
    expect(safeCalc.returnValue).toBe(315);
    expect(safeCalc.logs).toContain("Calculated: 300");
  });

  it("executes form-to-document and spreadsheet query refresh reference workflows", () => {
    const credential: AppCredential = {
      id: "app_workflows",
      name: "Workflow App",
      clientId: "client_wf",
      hashedSecret: "secret",
      scopes: ["files.write"],
      status: "active",
      createdAt: new Date().toISOString(),
    };

    const client = new ScopedAutomationClient(credential);

    // Form-to-document workflow
    const generatedDoc = client.generateDocumentFromForm({
      applicant: "Jane Doe",
      department: "Engineering",
      score: 95,
      comments: "Exceptional system design and problem solving.",
    });

    expect(generatedDoc.kind).toBe("doc");
    expect(JSON.stringify(generatedDoc.content)).toContain("Jane Doe (Engineering)");
    expect(JSON.stringify(generatedDoc.content)).toContain("Score: 95/100");

    // Spreadsheet query refresh workflow
    const sheet = createFile("sheet", "Revenue Model") as SheetFile;
    const queryData = [
      ["Region", "Q1 Revenue", "Q2 Revenue"],
      ["North America", 150000, 185000],
      ["EMEA", 95000, 110000],
    ];

    const refreshedSheet = client.refreshSpreadsheetQuery(sheet, queryData, "query_rev_01");
    const activeSheetId = refreshedSheet.content.workbook.sheetOrder[0];
    const cells = refreshedSheet.content.workbook.sheets[activeSheetId].cellData;

    expect(cells?.[0]?.[0]?.v).toBe("Region");
    expect(cells?.[1]?.[1]?.v).toBe(150000);
    expect(cells?.[2]?.[2]?.v).toBe(110000);
  });
});
