import { vi } from "vitest";
import { MailStore } from "../src/mail/store";
import type { MailAccount } from "../src/mail/types";
export const account: MailAccount = {
  id: "a",
  name: "Ada",
  email: "ada@example.com",
  signature: "Regards",
  imap: {
    host: "imap.example.com",
    port: 993,
    secure: true,
    user: "ada",
    password: "secret",
  },
  smtp: {
    host: "smtp.example.com",
    port: 465,
    secure: true,
    user: "ada",
    password: "secret",
  },
};
export function memoryStore() {
  const rows = new Map<string, any>();
  rows.set("user:ada", { id: "ada", banned: 0 });
  let google: (
    url: string,
    init?: RequestInit,
  ) => Response | Promise<Response> = () => Response.json({});
  const fetch = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("http://db/")) return google(url, init);
      const body = JSON.parse(String(init?.body));
      const matching = [...rows.entries()].filter(
        ([id, row]) =>
          id.startsWith(`${body.model}:`) &&
          (body.where || []).every((w: any) =>
            w.operator === "lte"
              ? row[w.field] <= w.value
              : row[w.field] === w.value,
          ),
      );
      let result;
      if (body.op === "create") {
        rows.set(`${body.model}:${body.data.id}`, { ...body.data });
        result = body.data;
      } else if (body.op === "update") {
        const entry = matching[0];
        if (entry) {
          const next = { ...entry[1], ...body.update };
          rows.set(entry[0], next);
          result = next;
        } else result = null;
      } else if (body.op === "delete" || body.op === "deleteMany") {
        matching.forEach(([id]) => rows.delete(id));
        result = matching.length;
      } else if (body.op === "findMany")
        result = matching.map(([, r]) => r).slice(0, body.limit || 1000);
      else result = matching[0]?.[1] ?? null;
      return Response.json({ result });
    },
  );
  vi.stubGlobal("fetch", fetch);
  return {
    store: new MailStore("http://db", "token", "s".repeat(32)),
    rows,
    fetch,
    setGoogle: (handler: typeof google) => {
      google = handler;
    },
  };
}
