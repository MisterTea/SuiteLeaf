import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("node:fs", () => ({ existsSync: vi.fn() }));

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("embedded Supermail build", () => {
  it("uses the stub for optional builds without the submodule", async () => {
    vi.stubEnv("VITE_SUITELEAF_SERVER", "0");
    vi.mocked(existsSync).mockReturnValue(false);
    const config = await import("../apps/web/supermail/vite");
    expect(config.supermailAliases("stub.tsx")).toEqual([
      { find: "@supermail/App", replacement: "stub.tsx" },
    ]);
    expect(await config.supermailPlugins()).toEqual([]);
  });

  it("fails server builds rather than silently shipping a stub", async () => {
    vi.stubEnv("VITE_SUITELEAF_SERVER", "1");
    vi.mocked(existsSync).mockReturnValue(false);
    await expect(import("../apps/web/supermail/vite")).rejects.toThrow(
      "Server builds require packages/supermail source and dependencies.",
    );
  });

  it("resolves the submodule from the repository root and embeds its router", async () => {
    vi.mocked(existsSync).mockImplementation(
      (path) => !String(path).includes("@tailwindcss"),
    );
    const config = await import("../apps/web/supermail/vite");
    expect(existsSync).toHaveBeenCalledWith(
      resolve("packages/supermail/src/App.tsx"),
    );
    const aliases = config.supermailAliases("stub.tsx");
    expect(aliases[0].replacement).toBe(
      resolve("apps/web/supermail/SuperMailEmbedded.tsx"),
    );
    expect(
      aliases.some((alias) => alias.replacement.includes("fullfat_base64.js")),
    ).toBe(true);
    const [plugin] = (await config.supermailPlugins()) as any[];
    const context = {
      resolve: vi
        .fn()
        .mockResolvedValue({
          id: resolve("packages/supermail/src/router/index.ts").replace(
            /\\/g,
            "/",
          ),
        }),
    };
    const importer = resolve("packages/supermail/src/App.tsx");
    expect(await plugin.resolveId.call(context, "./router", importer, {})).toBe(
      resolve("apps/web/supermail/router.ts").replace(/\\/g, "/"),
    );
    expect(
      await plugin.resolveId.call(
        context,
        "./index",
        resolve("packages/supermail/src/router/navigate.ts"),
        {},
      ),
    ).toBe(resolve("apps/web/supermail/router.ts").replace(/\\/g, "/"));
    expect(
      await plugin.resolveId.call(context, "react", importer, {}),
    ).toBeNull();
    expect(
      await plugin.resolveId.call(context, "./router", undefined, {}),
    ).toBeNull();
    expect(
      await plugin.resolveId.call(
        context,
        "./router",
        resolve("apps/web/src/App.tsx"),
        {},
      ),
    ).toBeNull();
    context.resolve.mockResolvedValue(null);
    expect(
      await plugin.resolveId.call(context, "./router", importer, {}),
    ).toBeNull();
  });
});
