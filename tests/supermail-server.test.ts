import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getUserSupermailDir,
  resolveSafeUserPath,
  handleSupermailRequest,
  closeAllUserDbs,
} from "../services/auth/src/mail/supermail-server";
import { EventEmitter } from "node:events";

describe("SuperMail Server Multi-User Storage & Isolation", () => {
  let tempBaseDir: string;

  beforeEach(async () => {
    tempBaseDir = await mkdtemp(join(tmpdir(), "supermail-test-"));
    process.env.SUITELEAF_SUPERMAIL_DIR = tempBaseDir;
  });

  afterEach(async () => {
    closeAllUserDbs();
    delete process.env.SUITELEAF_SUPERMAIL_DIR;
    await rm(tempBaseDir, { recursive: true, force: true }).catch(() => {});
  });

  it("assigns distinct, isolated filesystem directories for each user", () => {
    const aliceDir = getUserSupermailDir("user-alice");
    const bobDir = getUserSupermailDir("user-bob");

    expect(aliceDir).not.toEqual(bobDir);
    expect(aliceDir).toContain(tempBaseDir);
    expect(bobDir).toContain(tempBaseDir);
    expect(aliceDir).toMatch(/users[\\/][a-f0-9]{64}$/);
    expect(bobDir).toMatch(/users[\\/][a-f0-9]{64}$/);
  });

  it("prevents directory traversal attacks outside user directory", () => {
    const aliceDir = getUserSupermailDir("user-alice");

    // Safe path within user directory
    const safePath = resolveSafeUserPath(aliceDir, "attachments/file.txt");
    expect(safePath.startsWith(aliceDir)).toBe(true);

    // Traversal attempts
    expect(() => resolveSafeUserPath(aliceDir, "../user-bob/secret.txt")).toThrow(
      /Access denied/,
    );
    expect(() => resolveSafeUserPath(aliceDir, "../../etc/passwd")).toThrow(
      /Access denied/,
    );
    expect(() => resolveSafeUserPath(aliceDir, "/absolute/path")).toThrow(
      /Access denied/,
    );
  });

  function mockReqRes(body: unknown) {
    const req = new EventEmitter() as any;
    req.method = "POST";
    req.headers = { "content-type": "application/json" };

    let resStatus = 0;
    let resHeaders: Record<string, string> = {};
    let resData = "";

    const res = {
      writeHead: (status: number, headers: Record<string, string>) => {
        resStatus = status;
        resHeaders = headers;
      },
      end: (data?: string) => {
        if (data) resData += data;
      },
    } as any;

    // The handler creates the user directory before it reads the body. A timer
    // can emit the payload before those listeners exist, and then the read
    // waits forever. Deliver it once the handler is listening.
    const payload = Buffer.from(JSON.stringify(body));
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      req.emit("data", payload);
      req.emit("end");
    };
    req.on("newListener", (event: string) => {
      if (event === "end") queueMicrotask(send);
    });

    return {
      req,
      res,
      getResult: () =>
        new Promise<{ status: number; headers: Record<string, string>; body: any }>(
          (resolve) => {
            setTimeout(() => {
              let parsed: any;
              try {
                parsed = JSON.parse(resData);
              } catch {
                parsed = resData;
              }
              resolve({ status: resStatus, headers: resHeaders, body: parsed });
            }, 30);
          },
        ),
    };
  }

  it("handles user DB execution and queries in per-user isolated database", async () => {
    // 1. Create table for alice
    const { req: req1, res: res1, getResult: getRes1 } = mockReqRes({
      query: "CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT);",
    });
    await handleSupermailRequest(
      req1,
      res1,
      "user-alice",
      new URL("http://localhost/api/auth/suiteleaf/supermail/db/execute"),
    );
    const result1 = await getRes1();
    expect(result1.status).toBe(200);

    // 2. Insert item for alice
    const { req: req2, res: res2, getResult: getRes2 } = mockReqRes({
      query: "INSERT INTO items (id, title) VALUES ($1, $2);",
      params: ["item-1", "Alice's Secret Note"],
    });
    await handleSupermailRequest(
      req2,
      res2,
      "user-alice",
      new URL("http://localhost/api/auth/suiteleaf/supermail/db/execute"),
    );
    const result2 = await getRes2();
    expect(result2.status).toBe(200);
    expect(result2.body.rowsAffected).toBe(1);

    // 3. Select items for alice
    const { req: req3, res: res3, getResult: getRes3 } = mockReqRes({
      query: "SELECT * FROM items;",
      params: [],
    });
    await handleSupermailRequest(
      req3,
      res3,
      "user-alice",
      new URL("http://localhost/api/auth/suiteleaf/supermail/db/select"),
    );
    const result3 = await getRes3();
    expect(result3.status).toBe(200);
    expect(result3.body).toEqual([
      { id: "item-1", title: "Alice's Secret Note" },
    ]);

    // 4. Bob queries items - bob should NOT have items table yet or see alice's data
    const { req: req4, res: res4, getResult: getRes4 } = mockReqRes({
      query: "SELECT name FROM sqlite_master WHERE type='table' AND name='items';",
      params: [],
    });
    await handleSupermailRequest(
      req4,
      res4,
      "user-bob",
      new URL("http://localhost/api/auth/suiteleaf/supermail/db/select"),
    );
    const result4 = await getRes4();
    expect(result4.status).toBe(200);
    expect(result4.body).toEqual([]);
  });

  it("handles user filesystem operations strictly jailed to user directory", async () => {
    // 1. Write text file for alice
    const { req: req1, res: res1, getResult: getRes1 } = mockReqRes({
      path: "notes/hello.txt",
      text: "Hello from Alice",
    });
    await handleSupermailRequest(
      req1,
      res1,
      "user-alice",
      new URL("http://localhost/api/auth/suiteleaf/supermail/fs/writeTextFile"),
    );
    expect((await getRes1()).status).toBe(200);

    // 2. Check exists for alice
    const { req: req2, res: res2, getResult: getRes2 } = mockReqRes({
      path: "notes/hello.txt",
    });
    await handleSupermailRequest(
      req2,
      res2,
      "user-alice",
      new URL("http://localhost/api/auth/suiteleaf/supermail/fs/exists"),
    );
    expect((await getRes2()).body).toEqual({ exists: true });

    // 3. Read text file for alice
    const { req: req3, res: res3, getResult: getRes3 } = mockReqRes({
      path: "notes/hello.txt",
    });
    await handleSupermailRequest(
      req3,
      res3,
      "user-alice",
      new URL("http://localhost/api/auth/suiteleaf/supermail/fs/readTextFile"),
    );
    expect((await getRes3()).body).toEqual({ text: "Hello from Alice" });

    // 4. Bob cannot see alice's file
    const { req: req4, res: res4, getResult: getRes4 } = mockReqRes({
      path: "notes/hello.txt",
    });
    await handleSupermailRequest(
      req4,
      res4,
      "user-bob",
      new URL("http://localhost/api/auth/suiteleaf/supermail/fs/exists"),
    );
    expect((await getRes4()).body).toEqual({ exists: false });

    // 5. User attempts path traversal attack via fs
    const { req: req5, res: res5, getResult: getRes5 } = mockReqRes({
      path: "../user-alice/notes/hello.txt",
    });
    await handleSupermailRequest(
      req5,
      res5,
      "user-bob",
      new URL("http://localhost/api/auth/suiteleaf/supermail/fs/readTextFile"),
    );
    const result5 = await getRes5();
    expect(result5.status).toBe(403);
    expect(result5.body.error).toContain("Access denied");
  });
});
