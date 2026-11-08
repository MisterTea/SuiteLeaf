import { createServer, type TLSSocket } from "node:tls";
import type { AddressInfo } from "node:net";
import { generate } from "selfsigned";
import { describe, expect, it, vi } from "vitest";
import { simpleParser } from "mailparser";
import { mailCommand, mailDependencies } from "../src/mail/service";
import {
  confidentialCommand,
  readConfidential,
} from "../src/mail/confidential";
import { memoryStore } from "./mail-support";
import type { MailAccount } from "../src/mail/types";

/** A loopback protocol fixture: real ImapFlow/Nodemailer, sockets and verified TLS. */
describe("mail transport integration", () => {
  it("authenticates, reads MIME, mutates mail, saves drafts and delivers Bcc over TLS", async () => {
    const pems = await generate([{ name: "commonName", value: "localhost" }], {
      algorithm: "sha256",
      extensions: [
        {
          name: "subjectAltName",
          altNames: [
            { type: 7, ip: "127.0.0.1" },
            { type: 2, value: "localhost" },
          ],
        },
      ],
    });
    const sockets = new Set<TLSSocket>();
    const commands: string[] = [];
    const appended: Buffer[] = [];
    const delivered: string[] = [];
    const recipients: string[] = [];
    let authenticated = 0;
    const raw = Buffer.from(
      "From: Lin <lin@example.com>\r\nTo: ada@example.com\r\nSubject: Wire test\r\nMessage-ID: <wire@example.com>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello from IMAP\r\n",
    );
    const imapServer = createServer(
      { key: pems.private, cert: pems.cert },
      (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => {});
        socket.write("* OK loopback mail ready\r\n");
        let data = Buffer.alloc(0);
        let authTag = "";
        let literal: { tag: string; length: number } | undefined;
        socket.on("data", (chunk) => {
          data = Buffer.concat([data, chunk]);
          while (data.length) {
            if (literal) {
              if (data.length < literal.length + 2) return;
              appended.push(Buffer.from(data.subarray(0, literal.length)));
              data = data.subarray(literal.length + 2);
              socket.write(`${literal.tag} OK [APPENDUID 42 10] appended\r\n`);
              literal = undefined;
              continue;
            }
            const at = data.indexOf("\r\n");
            if (at < 0) return;
            const line = data.subarray(0, at).toString();
            data = data.subarray(at + 2);
            if (authTag) {
              authenticated++;
              socket.write(`${authTag} OK authenticated\r\n`);
              authTag = "";
              continue;
            }
            const [tag, verb] = line.split(" ");
            commands.push(
              verb === "LOGIN" || verb === "AUTHENTICATE"
                ? verb
                : line.replace(/^\S+ /, ""),
            );
            const ok = (text = "completed") =>
              socket.write(`${tag} OK ${text}\r\n`);
            if (verb === "CAPABILITY") {
              socket.write(
                "* CAPABILITY IMAP4rev1 AUTH=PLAIN UIDPLUS MOVE\r\n",
              );
              ok();
            } else if (verb === "LOGIN") {
              authenticated++;
              ok();
            } else if (verb === "AUTHENTICATE") {
              authTag = tag;
              socket.write("+ \r\n");
            } else if (verb === "LIST" || verb === "LSUB") {
              if (/LIST "" ""$/.test(line)) {
                socket.write('* LIST (\\Noselect) "/" ""\r\n');
                ok();
                continue;
              }
              for (const [path, flag] of [
                ["INBOX", ""],
                ["Drafts", "\\Drafts"],
                ["Sent", "\\Sent"],
              ])
                socket.write(
                  `* LIST (\\HasNoChildren ${flag}) "/" "${path}"\r\n`,
                );
              ok();
            } else if (verb === "STATUS") {
              const mailbox = /STATUS ("[^"]+"|\S+)/.exec(line)?.[1] ?? "INBOX";
              socket.write(
                `* STATUS ${mailbox} (MESSAGES 1 UNSEEN 1 UIDNEXT 10 UIDVALIDITY 42)\r\n`,
              );
              ok();
            } else if (verb === "SELECT" || verb === "EXAMINE") {
              socket.write(
                "* FLAGS (\\Seen \\Flagged \\Deleted \\Draft)\r\n* OK [PERMANENTFLAGS (\\Seen \\Flagged \\Deleted \\Draft \\*)] flags\r\n* 1 EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 42] validity\r\n* OK [UIDNEXT 10] next\r\n",
              );
              ok("[READ-WRITE] selected");
            } else if (/^\S+ UID SEARCH /.test(line)) {
              socket.write("* SEARCH 9\r\n");
              ok();
            } else if (/^\S+ UID FETCH /.test(line)) {
              if (line.includes("BODY.PEEK[]")) {
                socket.write(`* 1 FETCH (UID 9 BODY[] {${raw.length}}\r\n`);
                socket.write(raw);
                socket.write(")\r\n");
              } else if (line.includes("ENVELOPE"))
                socket.write(
                  `* 1 FETCH (UID 9 FLAGS () RFC822.SIZE ${raw.length} ENVELOPE ("7 Nov 2026 12:00:00 +0000" "Wire test" (("Lin" NIL "lin" "example.com")) NIL NIL ((NIL NIL "ada" "example.com")) NIL NIL NIL "<wire@example.com>"))\r\n`,
                );
              else
                socket.write(`* 1 FETCH (UID 9 RFC822.SIZE ${raw.length})\r\n`);
              ok();
            } else if (/^\S+ UID STORE /.test(line)) {
              socket.write("* 1 FETCH (UID 9 FLAGS (\\Seen))\r\n");
              ok();
            } else if (/^\S+ UID (MOVE|COPY) /.test(line))
              ok("[COPYUID 42 9 10] moved");
            else if (verb === "APPEND") {
              literal = { tag, length: Number(/\{(\d+)\}$/.exec(line)?.[1]) };
              socket.write("+ continue\r\n");
            } else if (verb === "LOGOUT") {
              socket.write(`* BYE closing\r\n${tag} OK logout\r\n`);
              socket.end();
            } else ok();
          }
        });
      },
    );
    const smtpServer = createServer(
      { key: pems.private, cert: pems.cert },
      (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => {});
        socket.write("220 localhost SMTP ready\r\n");
        let data = "",
          receiving = false;
        socket.on("data", (chunk) => {
          data += chunk.toString();
          while (data) {
            if (receiving) {
              const end = data.indexOf("\r\n.\r\n");
              if (end < 0) return;
              delivered.push(data.slice(0, end));
              data = data.slice(end + 5);
              receiving = false;
              socket.write("250 accepted\r\n");
              continue;
            }
            const at = data.indexOf("\r\n");
            if (at < 0) return;
            const line = data.slice(0, at);
            data = data.slice(at + 2);
            if (/^(EHLO|HELO)/.test(line))
              socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
            else if (line.startsWith("AUTH PLAIN"))
              socket.write("235 authenticated\r\n");
            else if (line.startsWith("RCPT TO:")) {
              recipients.push(line);
              socket.write("250 recipient\r\n");
            } else if (line === "DATA") {
              receiving = true;
              socket.write("354 send message\r\n");
            } else if (line === "QUIT") {
              socket.write("221 bye\r\n");
              socket.end();
            } else socket.write("250 ok\r\n");
          }
        });
      },
    );
    const listen = (server: typeof imapServer) =>
      new Promise<number>((resolve) =>
        server.listen(0, "127.0.0.1", () =>
          resolve((server.address() as AddressInfo).port),
        ),
      );
    const imapPort = await listen(imapServer),
      smtpPort = await listen(smtpServer);
    const endpoint = {
      host: "127.0.0.1",
      secure: true,
      user: "ada",
      password: "fixture-password",
    };
    const account: MailAccount = {
      id: "wire",
      name: "Ada",
      email: "ada@example.com",
      signature: "",
      imap: { ...endpoint, port: imapPort },
      smtp: { ...endpoint, port: smtpPort },
    };
    const originalImap = mailDependencies.imap,
      originalSmtp = mailDependencies.smtp;
    try {
      // Keep production certificate verification enabled; add only this fixture's CA.
      vi.spyOn(mailDependencies, "imap").mockImplementation((a) => {
        const client = originalImap(a);
        client.options.tls = { ca: pems.cert };
        return client;
      });
      vi.spyOn(mailDependencies, "smtp").mockImplementation((a) => {
        const transport = originalSmtp(a);
        (transport.transporter as any).options.tls = { ca: pems.cert };
        return transport;
      });
      await expect(mailCommand(account, "test", {})).resolves.toEqual({
        ok: true,
      });
      expect(await mailCommand(account, "folders", {})).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "Drafts", specialUse: "\\Drafts" }),
        ]),
      );
      const list = (await mailCommand(account, "list", {
        folder: "INBOX",
      })) as any;
      expect(list).toMatchObject({
        total: 1,
        uidValidity: "42",
        messages: [{ uid: 9, subject: "Wire test" }],
      });
      const base = { folder: "INBOX", uidValidity: "42", uid: 9, uids: [9] };
      expect(await mailCommand(account, "read", base)).toMatchObject({
        subject: "Wire test",
        text: "Hello from IMAP\n",
      });
      await mailCommand(account, "flags", {
        ...base,
        flag: "\\Flagged",
        add: true,
      });
      await mailCommand(account, "copy", { ...base, destination: "Drafts" });
      await mailCommand(account, "move", { ...base, destination: "Sent" });
      const message = {
        to: "lin@example.com",
        bcc: "hidden@example.com",
        subject: "Delivery",
        text: "Wire body",
        attachments: [
          { filename: "file.txt", content: "aGk=", contentType: "text/plain" },
        ],
      };
      await mailCommand(account, "draft", { message });
      await mailCommand(account, "send", { message });
      expect(authenticated).toBeGreaterThan(5);
      expect(commands.some((c) => c.startsWith("UID MOVE"))).toBe(true);
      expect(delivered).toHaveLength(1);
      expect(recipients.some((r) => r.includes("hidden@example.com"))).toBe(
        true,
      );
      const parsed = await simpleParser(delivered[0]);
      expect(parsed.bcc).toBeUndefined();
      expect(parsed.attachments[0].content.toString()).toBe("hi");
      expect(appended).toHaveLength(2);
      expect((await simpleParser(appended[0])).bcc).toBeTruthy();
      expect((await simpleParser(appended[1])).messageId).toBe(
        parsed.messageId,
      );
      const storage = memoryStore();
      vi.stubEnv("SUITELEAF_PUBLIC_URL", "https://suite.example");
      await storage.store.put("ada", account);
      const secured = (await confidentialCommand(
        storage.store,
        "ada",
        account,
        "confidentialSend",
        {
          message: {
            to: "lin@example.com",
            subject: "Secure wire",
            text: "Kept out of SMTP",
          },
          passcode: "separate-code",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      )) as { link: string };
      expect(delivered).toHaveLength(2);
      const notification = await simpleParser(delivered[1]);
      expect(notification.text).toContain(secured.link);
      expect(notification.text).not.toContain("Kept out of SMTP");
      expect(notification.text).not.toContain("separate-code");
      expect(
        await readConfidential(storage.store, {
          token: decodeURIComponent(secured.link.split("/confidential/")[1]),
          passcode: "separate-code",
        }),
      ).toMatchObject({ text: "Kept out of SMTP" });
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise<void>((resolve) => imapServer.close(() => resolve())),
        new Promise<void>((resolve) => smtpServer.close(() => resolve())),
      ]);
    }
  }, 30_000);
});
