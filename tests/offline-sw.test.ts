import { describe, expect, it } from "vitest";
import { precachePaths, serviceWorkerSource } from "../apps/web/offline";

describe("published app updates", () => {
  it("does not cache the empty script Vite drops for a stylesheet import", () => {
    const paths = precachePaths([
      {
        fileName: "assets/index-real.js",
        type: "chunk",
        code: "alert(1)",
        facadeModuleId: null,
      },
      {
        fileName: "assets/index-empty.js",
        type: "chunk",
        code: "\n",
        facadeModuleId: "/node_modules/@excalidraw/excalidraw/dist/prod/index.css",
      },
      { fileName: "assets/app.css", type: "asset" },
    ]);
    expect(paths).toContain("./assets/index-real.js");
    expect(paths).toContain("./assets/app.css");
    expect(paths).not.toContain("./assets/index-empty.js");
  });

  it("replaces a cached copy and reloads tabs that still have it open", () => {
    const source = serviceWorkerSource("abc123", ["./"]);
    expect(source).toContain("CACHE=PREFIX+'-abc123'");
    expect(source).toContain("self.skipWaiting()");
    expect(source).toContain("client.navigate(client.url)");
    expect(source).toContain("if(!stale.length)return");
  });
});
