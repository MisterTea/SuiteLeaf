import { afterEach, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { authOptions } from "../src/options";

afterEach(() => vi.useRealTimers());

it("renews the stored session and cookie across monthly visits, then expires after inactivity", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const start = new Date("2026-11-07T12:00:00.000Z");
  vi.setSystemTime(start);
  const day = 86_400_000;
  const store = {
    jwks: [],
    user: [{ id: "u1", name: "Ann", email: "ann@example.com", emailVerified: true, role: "user", banned: false, createdAt: start, updatedAt: start }],
    session: [{ id: "s1", token: "monthly-token", userId: "u1", createdAt: start, updatedAt: start, expiresAt: new Date(+start + 32 * day) }],
  };
  const baseURL = "https://suite.example.com";
  const auth = betterAuth(authOptions({ baseURL, secret: "s".repeat(32), trustedOrigins: [baseURL] }, memoryAdapter(store)));
  let cookie = "";
  const visit = () => auth.handler(new Request(`${baseURL}/api/auth/get-session`, {
    headers: cookie ? { cookie } : { authorization: "Bearer monthly-token" },
  }));

  for (const elapsed of [31, 62, 93]) {
    vi.setSystemTime(+start + elapsed * day);
    const response = await visit();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.user.id).toBe("u1");
    expect(data.session.expiresAt).toBe(new Date(Date.now() + 32 * day).toISOString());
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith("__Secure-better-auth.session_token="));
    expect(setCookie).toContain(`Max-Age=${32 * 24 * 60 * 60}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    cookie = setCookie!.split(";")[0];
    expect(+store.session[0]!.expiresAt).toBe(Date.now() + 32 * day);
  }

  vi.setSystemTime(+start + 126 * day);
  expect(await (await visit()).json()).toBeNull();
});
