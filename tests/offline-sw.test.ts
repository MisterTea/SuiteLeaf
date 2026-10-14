import { describe, expect, it } from "vitest";
import { serviceWorkerSource } from "../apps/web/offline";

describe("published app updates", () => {
  it("replaces a cached copy and reloads tabs that still have it open", () => {
    const source = serviceWorkerSource("abc123", ["./"]);
    expect(source).toContain("CACHE=PREFIX+'-abc123'");
    expect(source).toContain("self.skipWaiting()");
    expect(source).toContain("client.navigate(client.url)");
    expect(source).toContain("if(!stale.length)return");
  });
});
