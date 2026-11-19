import { describe, expect, it } from "vitest";
import {
  hashPath,
  isExternalWebUrl,
  openablePath,
  openablePathFromUrl,
  tabKey,
} from "../apps/desktop/src/tab-url";

describe("openablePath", () => {
  it("accepts the home screen, a file, a slide, and a shared file", () => {
    expect(openablePath("/")).toBe("/");
    expect(openablePath("/file/abc_DEF-1")).toBe("/file/abc_DEF-1");
    expect(openablePath("/file/abc/slide1")).toBe("/file/abc/slide1");
    expect(openablePath("/shared/doc")).toBe("/shared/doc");
    expect(openablePath("/file/abc?x=1")).toBe("/file/abc");
  });

  it("rejects other routes and unsafe paths", () => {
    expect(openablePath("/settings")).toBeNull();
    expect(openablePath("/file/../secret")).toBeNull();
    expect(openablePath("/file/a/b/c")).toBeNull();
    expect(openablePath("https://evil.test/file/abc")).toBeNull();
    expect(openablePath("/file/has space")).toBeNull();
    expect(openablePath("/shared/a\\b")).toBeNull();
    expect(openablePath("")).toBeNull();
  });
});

describe("hashPath", () => {
  it("reads the hash route and drops traversal", () => {
    expect(hashPath("suiteleaf://app/index.html#/file/abc")).toBe("/file/abc");
    expect(hashPath("http://localhost:5173/#/shared/doc")).toBe("/shared/doc");
    expect(hashPath("suiteleaf://app/index.html")).toBe("/");
    expect(hashPath("suiteleaf://app/index.html#/file/..%2Fsecret")).toBe("/");
    expect(hashPath("not a url")).toBeNull();
  });
});

describe("app urls", () => {
  const packaged = "suiteleaf://app/index.html";

  it("opens an in-app document and treats other sites as external", () => {
    expect(openablePathFromUrl("suiteleaf://app/index.html#/file/abc", packaged)).toBe("/file/abc");
    expect(openablePathFromUrl("https://evil.test/#/file/abc", packaged)).toBeNull();
    expect(openablePathFromUrl("suiteleaf://app/index.html#/settings", packaged)).toBeNull();
    expect(openablePathFromUrl("http://localhost:5173/#/file/abc", "http://localhost:5173/")).toBe(
      "/file/abc",
    );
    expect(isExternalWebUrl("https://example.com/docs", packaged)).toBe(true);
    expect(isExternalWebUrl("http://localhost:5173/#/file/abc", "http://localhost:5173/")).toBe(false);
    expect(isExternalWebUrl("suiteleaf://app/index.html#/file/abc", packaged)).toBe(false);
    expect(isExternalWebUrl("about:blank", packaged)).toBe(false);
  });
});

describe("tabKey", () => {
  it("treats a slide address as the same document", () => {
    expect(tabKey("/file/abc")).toBe("file:abc");
    expect(tabKey("/file/abc/slide")).toBe("file:abc");
    expect(tabKey("/shared/doc")).toBe("shared:doc");
    expect(tabKey("/")).toBe("/");
  });
});
