import { expect, it } from "vitest";
import { desktopOsNotice, nodeRuntimeNotice } from "../apps/desktop/src/supported-platform";

it("names the Node.js and desktop floors without repeating a bad version", () => {
  expect(nodeRuntimeNotice("22.12.0")).toBe("This runtime is supported.");
  expect(nodeRuntimeNotice("22.11.9")).toBe("This runtime is older than Node.js 22.12.0.");
  expect(nodeRuntimeNotice("secret-value")).toBe("Name the runtime as major.minor.patch.");
  expect(nodeRuntimeNotice("secret-value")).not.toContain("secret-value");

  expect(desktopOsNotice("darwin", "13")).toBe("This Mac is supported.");
  expect(desktopOsNotice("darwin", "12.7")).toBe("This Mac is older than macOS 13.");
  expect(desktopOsNotice("darwin", "secret-value")).toBe("Name the macOS version.");
  expect(desktopOsNotice("darwin", "secret-value")).not.toContain("secret-value");

  expect(desktopOsNotice("win32", "10.0.19045")).toBe("This Windows version is supported.");
  expect(desktopOsNotice("win32", "6.1")).toBe("This Windows version is older than Windows 10.");
  expect(desktopOsNotice("win32", "secret-value")).not.toContain("secret-value");

  expect(desktopOsNotice("linux", "secret-value")).toBe(
    "Linux support follows the packaged Electron build. No minimum distribution is recorded.",
  );
  expect(desktopOsNotice("linux", "secret-value")).not.toContain("secret-value");
  expect(desktopOsNotice("secret-value", "13")).toBe("Name macOS, Windows, or Linux.");
  expect(desktopOsNotice("secret-value", "13")).not.toContain("secret-value");
});
