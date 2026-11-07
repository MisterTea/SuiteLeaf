// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); document.head.innerHTML = ""; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete (window as any).__onGCastApiAvailable; delete (window as any).cast; });

it("explains missing configuration, insecure contexts, and native desktop", async () => {
  const { castUnavailable, castCancelled } = await import("../apps/web/src/editors/slide-cast-sdk");
  vi.stubGlobal("isSecureContext", true);
  expect(castUnavailable(undefined)).toContain("not configured");
  expect(castUnavailable(" ")).toContain("not configured");
  expect(castUnavailable("ABCD1234")).toBeNull();
  vi.stubGlobal("isSecureContext", false);
  expect(castUnavailable("id")).toContain("HTTPS");
  vi.stubGlobal("suiteleaf", {});
  expect(castUnavailable("id")).toContain("Chrome");
  expect(castCancelled("cancel")).toBe(true);
  expect(castCancelled({ code: "cancel" })).toBe(true);
  expect(castCancelled(null)).toBe(false);
  expect(castCancelled(new Error())).toBe(false);
});

it("loads the SDK once, preserves the existing callback, and configures a tab-scoped session", async () => {
  const { loadCastSdk, configureCast, CAST_SENDER_URL } = await import("../apps/web/src/editors/slide-cast-sdk");
  const previous = vi.fn();
  (window as any).__onGCastApiAvailable = previous;
  const loading = loadCastSdk();
  expect(loadCastSdk()).toBe(loading);
  expect(document.querySelector("script")?.src).toBe(CAST_SENDER_URL);
  const context = { setOptions: vi.fn() };
  (window as any).cast = { framework: { CastContext: { getInstance: () => context }, CastContextEventType: { SESSION_STATE_CHANGED: "session" } } };
  (window as any).__onGCastApiAvailable(true);
  await loading;
  expect(previous).toHaveBeenCalledWith(true);
  expect((window as any).__onGCastApiAvailable).toBe(previous);
  expect(configureCast("APP12345")).toEqual({ context, event: "session" });
  expect(context.setOptions).toHaveBeenCalledWith({ receiverApplicationId: "APP12345", autoJoinPolicy: "tab_and_origin_scoped", resumeSavedSession: false });
  await loadCastSdk();
  expect(document.querySelectorAll("script")).toHaveLength(1);
});

it.each(["unavailable", "network", "timeout"])("handles %s SDK failures and permits retry", async (failure) => {
  const { loadCastSdk } = await import("../apps/web/src/editors/slide-cast-sdk");
  const loading = loadCastSdk();
  const rejected = expect(loading).rejects.toThrow("Casting is unavailable");
  if (failure === "unavailable") (window as any).__onGCastApiAvailable(false);
  else if (failure === "network") document.querySelector("script")!.dispatchEvent(new Event("error"));
  else await vi.advanceTimersByTimeAsync(15_000);
  await rejected;
  expect(document.querySelector("script")).toBeNull();
  const retry = loadCastSdk();
  (window as any).__onGCastApiAvailable(true);
  await retry;
});
