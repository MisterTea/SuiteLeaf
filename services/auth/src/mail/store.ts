import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { MailAccount } from "./types";

/** The replicated database only receives authenticated ciphertext. */
export class MailStore {
  private key: Buffer;
  constructor(
    private url: string,
    private token: string,
    secret: string,
  ) {
    if (secret.length < 32)
      throw new Error(
        "Mail requires an auth secret of at least 32 characters.",
      );
    this.key = createHash("sha256")
      .update(`suiteleaf-mail-v1:${secret}`)
      .digest();
  }
  private id(user: string, account: string) {
    return createHash("sha256")
      .update(JSON.stringify([user, account]))
      .digest("hex");
  }
  seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  }
  open<T = MailAccount>(value: string): T {
    const data = Buffer.from(value, "base64");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      data.subarray(0, 12),
    );
    cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        cipher.update(data.subarray(28)),
        cipher.final(),
      ]).toString(),
    );
  }
  private async db(body: Record<string, unknown>) {
    const response = await fetch(`${this.url}/internal/db`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-suiteleaf-internal": this.token,
      },
      body: JSON.stringify({ model: "mail_account", ...body }),
    });
    if (!response.ok) throw new Error("Mail account storage is unavailable.");
    return (await response.json()).result;
  }
  async list(user: string): Promise<MailAccount[]> {
    const rows = await this.db({
      op: "findMany",
      where: [{ field: "userId", value: user }],
      limit: 100,
    });
    return rows.map((row: { payload: string }) => this.open(row.payload));
  }
  async get(user: string, id: string): Promise<MailAccount> {
    const row = await this.db({
      op: "findOne",
      where: [
        { field: "id", value: this.id(user, id) },
        { field: "userId", value: user },
      ],
    });
    if (!row) throw new Error("Mail account not found.");
    return this.open(row.payload);
  }
  async put(user: string, account: MailAccount) {
    const id = this.id(user, account.id);
    const where = [
      { field: "id", value: id },
      { field: "userId", value: user },
    ];
    const existing = await this.db({ op: "findOne", where });
    const payload = this.seal(account);
    await this.db(
      existing
        ? { op: "update", where, update: { payload } }
        : {
            op: "create",
            data: {
              id,
              userId: user,
              workerId: process.env.SUITELEAF_MAIL_WORKER_ID ?? "",
              payload,
            },
          },
    );
  }
  async remove(user: string, account: string) {
    await this.db({
      model: "mail_record",
      op: "deleteMany",
      where: [
        { field: "userId", value: user },
        { field: "accountId", value: account },
      ],
    });
    await this.db({
      op: "delete",
      where: [
        { field: "id", value: this.id(user, account) },
        { field: "userId", value: user },
      ],
    });
  }
  async records<T>(
    user: string,
    accountId: string,
    kind: string,
  ): Promise<StoredRecord<T>[]> {
    const rows = await this.db({
      model: "mail_record",
      op: "findMany",
      where: [
        { field: "userId", value: user },
        { field: "accountId", value: accountId },
        { field: "kind", value: kind },
      ],
      limit: 1000,
    });
    return rows.map((row: StoredRecord<string>) => ({
      ...row,
      payload: this.open<T>(row.payload),
    }));
  }
  async record<T>(
    user: string,
    accountId: string,
    kind: string,
    key: string,
  ): Promise<StoredRecord<T> | undefined> {
    const row = await this.db({
      model: "mail_record",
      op: "findOne",
      where: [
        {
          field: "id",
          value: this.id(user, JSON.stringify([accountId, kind, key])),
        },
        { field: "userId", value: user },
      ],
    });
    return row ? { ...row, payload: this.open<T>(row.payload) } : undefined;
  }
  async saveRecord<T>(
    userId: string,
    accountId: string,
    kind: string,
    key: string,
    payload: T,
    metadata: { state?: string; dueAt?: string; owner?: string } = {},
  ): Promise<StoredRecord<T>> {
    const id = this.id(userId, JSON.stringify([accountId, kind, key]));
    const where = [
      { field: "id", value: id },
      { field: "userId", value: userId },
    ];
    const existing = await this.db({
      model: "mail_record",
      op: "findOne",
      where,
    });
    const data = {
      id,
      userId,
      accountId,
      kind,
      state: "saved",
      dueAt: "",
      owner: "",
      ...metadata,
      payload: this.seal(payload),
    };
    await this.db({
      model: "mail_record",
      ...(existing
        ? { op: "update", where, update: data }
        : { op: "create", data }),
    });
    return { ...data, payload };
  }
  async updateRecord<T>(row: StoredRecord<T>) {
    await this.db({
      model: "mail_record",
      op: "update",
      where: [
        { field: "id", value: row.id },
        { field: "userId", value: row.userId },
      ],
      update: {
        state: row.state,
        dueAt: row.dueAt,
        payload: this.seal(row.payload),
      },
    });
  }
  async deleteRecord(user: string, id: string) {
    await this.db({
      model: "mail_record",
      op: "delete",
      where: [
        { field: "id", value: id },
        { field: "userId", value: user },
      ],
    });
  }
  async dueJobs(owner: string, now: string): Promise<StoredRecord<MailJob>[]> {
    const rows = await this.db({
      model: "mail_record",
      op: "findMany",
      where: [
        { field: "kind", value: "job" },
        { field: "owner", value: owner },
        { field: "state", value: "scheduled" },
        { field: "dueAt", operator: "lte", value: now },
      ],
      limit: 20,
    });
    return rows.map((row: StoredRecord<string>) => ({
      ...row,
      payload: this.open<MailJob>(row.payload),
    }));
  }
  async interruptedJobs(owner: string): Promise<StoredRecord<MailJob>[]> {
    const rows = await this.db({
      model: "mail_record",
      op: "findMany",
      where: [
        { field: "kind", value: "job" },
        { field: "owner", value: owner },
        { field: "state", value: "running" },
      ],
      limit: 1000,
    });
    return rows.map((row: StoredRecord<string>) => ({
      ...row,
      payload: this.open<MailJob>(row.payload),
    }));
  }
  async workerAccounts(
    owner: string,
  ): Promise<{ userId: string; account: MailAccount }[]> {
    const rows = await this.db({
      op: "findMany",
      where: [{ field: "workerId", value: owner }],
      limit: 1000,
    });
    return rows.map((row: { userId: string; payload: string }) => ({
      userId: row.userId,
      account: this.open(row.payload),
    }));
  }
  async ownerActive(user: string) {
    const row = await this.db({
      model: "user",
      op: "findOne",
      where: [{ field: "id", value: user }],
    });
    return !!row && !row.banned;
  }
}

export interface StoredRecord<T> {
  id: string;
  userId: string;
  accountId: string;
  kind: string;
  state: string;
  dueAt: string;
  owner: string;
  payload: T;
}
export interface MailJob {
  key: string;
  type: "send" | "snooze";
  message?: import("./types").MailCompose;
  folder?: string;
  destination?: string;
  uidValidity?: string;
  uids?: number[];
  subject?: string;
  result?: string;
}
