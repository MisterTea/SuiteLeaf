import { randomUUID } from "node:crypto";
import type { MailStore } from "./store";
import type { MailAccount } from "./types";
export interface MailPreferences {
  keyboard: boolean;
  notifications: boolean;
  density: "comfortable" | "compact";
  theme: "light" | "dark";
  conversation: boolean;
  offline?: boolean;
}
export const defaultPreferences: MailPreferences = {
  keyboard: true,
  notifications: false,
  density: "comfortable",
  theme: "light",
  conversation: true,
  offline: false,
};
export interface MailRule {
  id: string;
  name: string;
  query: string;
  moveTo?: string;
  markRead?: boolean;
  star?: boolean;
  enabled: boolean;
}
export async function preferenceCommand(
  store: MailStore,
  user: string,
  account: MailAccount,
  action: string,
  body: Record<string, unknown>,
) {
  if (action === "preferences")
    return (
      (
        await store.record<MailPreferences>(
          user,
          account.id,
          "preferences",
          "main",
        )
      )?.payload ?? defaultPreferences
    );
  if (action === "savePreferences") {
    const p = body.preferences as MailPreferences;
    if (
      !p ||
      typeof p.keyboard !== "boolean" ||
      typeof p.notifications !== "boolean" ||
      typeof p.conversation !== "boolean" ||
      !["comfortable", "compact"].includes(p.density) ||
      !["light", "dark"].includes(p.theme)
    )
      throw new Error("Invalid mail preferences.");
    await store.saveRecord(user, account.id, "preferences", "main", p);
    return p;
  }
  if (action === "rules")
    return (await store.records<MailRule>(user, account.id, "rule")).map(
      (r) => r.payload,
    );
  if (action === "saveRule") {
    const r = body.rule as MailRule;
    if (
      !r ||
      typeof r.name !== "string" ||
      !r.name ||
      typeof r.query !== "string" ||
      !r.query ||
      r.query.length > 2000 ||
      (r.moveTo !== undefined && typeof r.moveTo !== "string")
    )
      throw new Error("Invalid mail rule.");
    const rule: MailRule = {
      id: r.id || randomUUID(),
      name: r.name,
      query: r.query,
      enabled: r.enabled !== false,
      markRead: r.markRead === true,
      star: r.star === true,
      ...(r.moveTo ? { moveTo: r.moveTo } : {}),
    };
    await store.saveRecord(user, account.id, "rule", rule.id, rule);
    return rule;
  }
  if (action === "deleteRule") {
    const rule = await store.record<MailRule>(
      user,
      account.id,
      "rule",
      String(body.id),
    );
    if (rule) await store.deleteRecord(user, rule.id);
    return { ok: true };
  }
  if (action === "templates")
    return (
      await store.records<{
        id: string;
        name: string;
        text: string;
        html?: string;
      }>(user, account.id, "template")
    ).map((r) => r.payload);
  if (action === "saveTemplate") {
    if (
      typeof body.name !== "string" ||
      !body.name ||
      typeof body.text !== "string" ||
      (body.html !== undefined && typeof body.html !== "string")
    )
      throw new Error("Invalid message template.");
    const template = {
      id: typeof body.id === "string" ? body.id : randomUUID(),
      name: body.name,
      text: body.text,
      ...(body.html ? { html: body.html } : {}),
    };
    await store.saveRecord(user, account.id, "template", template.id, template);
    return template;
  }
  if (action === "deleteTemplate") {
    const t = await store.record(user, account.id, "template", String(body.id));
    if (t) await store.deleteRecord(user, t.id);
    return { ok: true };
  }
  if (action === "contacts")
    return (
      await store.records<{ id: string; name: string; email: string }>(
        user,
        account.id,
        "contact",
      )
    ).map((r) => r.payload);
  if (action === "saveContact") {
    if (
      typeof body.name !== "string" ||
      typeof body.email !== "string" ||
      !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(body.email)
    )
      throw new Error("Invalid contact.");
    const contact = {
      id: typeof body.id === "string" ? body.id : randomUUID(),
      name: body.name,
      email: body.email,
    };
    await store.saveRecord(user, account.id, "contact", contact.id, contact);
    return contact;
  }
  if (action === "deleteContact") {
    const c = await store.record(user, account.id, "contact", String(body.id));
    if (c) await store.deleteRecord(user, c.id);
    return { ok: true };
  }
  throw new Error("Unknown mail settings command.");
}
