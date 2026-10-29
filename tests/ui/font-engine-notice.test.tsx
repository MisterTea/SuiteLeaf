// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FONT_NOTICE_COOKIE,
  FontEngineNotice,
  seenFontNotice,
  shapesWithoutHarfBuzz,
} from "../../apps/web/src/font-engine-notice";

const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15";
const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const FIREFOX_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0";
const DESKTOP_APP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) SuiteLeaf/1.0.0 Chrome/146.0.0.0 Electron/44.6.0 Safari/537.36";
const CHROME_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1";
const WEBKIT_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 Epiphany/48";

describe("which browsers lay out text without HarfBuzz", () => {
  it("flags Safari and every browser on iPhone and iPad", () => {
    expect(shapesWithoutHarfBuzz({ userAgent: SAFARI_MAC, maxTouchPoints: 0 })).toBe(true);
    expect(shapesWithoutHarfBuzz({ userAgent: CHROME_IPHONE, maxTouchPoints: 5 })).toBe(true);
    // iPadOS reports itself as a Mac.
    expect(shapesWithoutHarfBuzz({ userAgent: SAFARI_MAC, maxTouchPoints: 5 })).toBe(true);
  });

  it("trusts Chromium, Firefox, the desktop app, and WebKit off Apple systems", () => {
    expect(shapesWithoutHarfBuzz({ userAgent: CHROME_MAC, maxTouchPoints: 0 })).toBe(false);
    expect(shapesWithoutHarfBuzz({ userAgent: EDGE_WINDOWS, maxTouchPoints: 0 })).toBe(false);
    expect(shapesWithoutHarfBuzz({ userAgent: FIREFOX_MAC, maxTouchPoints: 0 })).toBe(false);
    expect(shapesWithoutHarfBuzz({ userAgent: DESKTOP_APP, maxTouchPoints: 0 })).toBe(false);
    expect(shapesWithoutHarfBuzz({ userAgent: WEBKIT_LINUX, maxTouchPoints: 0 })).toBe(false);
    expect(shapesWithoutHarfBuzz({ userAgent: SAFARI_MAC, maxTouchPoints: 0, userAgentData: {} })).toBe(false);
  });

  it("reads the cookie among others", () => {
    expect(seenFontNotice(`a=b; ${FONT_NOTICE_COOKIE}=1; c=d`)).toBe(true);
    expect(seenFontNotice(`${FONT_NOTICE_COOKIE}=10`)).toBe(false);
    expect(seenFontNotice("")).toBe(false);
  });
});

describe("the font notice", () => {
  beforeEach(() => {
    document.cookie = `${FONT_NOTICE_COOKIE}=; max-age=0; path=/`;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows once in Safari, and never again after", () => {
    vi.stubGlobal("navigator", { userAgent: SAFARI_MAC, maxTouchPoints: 0 });
    render(<FontEngineNotice />);
    expect(screen.getByRole("status").textContent).toContain("Fonts may not match Microsoft Office");
    expect(seenFontNotice(document.cookie)).toBe(true);
    act(() => screen.getByRole("button", { name: "Dismiss" }).click());
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    render(<FontEngineNotice />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("stays away in Chrome", () => {
    vi.stubGlobal("navigator", { userAgent: CHROME_MAC, maxTouchPoints: 0 });
    render(<FontEngineNotice />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(seenFontNotice(document.cookie)).toBe(false);
  });
});
