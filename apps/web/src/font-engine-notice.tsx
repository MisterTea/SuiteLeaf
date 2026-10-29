import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

/** Set once the notice has shown, so it shows only once in this browser. */
export const FONT_NOTICE_COOKIE = "suiteleaf-font-notice";

type BrowserInfo = {
  userAgent: string;
  maxTouchPoints: number;
  /** Present in Chromium-based browsers only. */
  userAgentData?: unknown;
};

/**
 * Whether the browser lays out text with Apple's Core Text rather than
 * HarfBuzz: Safari, and every browser on iPhone and iPad, which all use
 * WebKit. SuiteLeaf's fonts are built and checked against Office with
 * HarfBuzz, which Chromium (Chrome, Edge, the desktop app) and Firefox use.
 */
export function shapesWithoutHarfBuzz(browser: BrowserInfo): boolean {
  if (browser.userAgentData) return false;
  const ua = browser.userAgent;
  if (!ua.includes("AppleWebKit/")) return false;
  // iPadOS reports a Mac but has touch.
  if (/iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && browser.maxTouchPoints > 1))
    return true;
  return ua.includes("Macintosh") && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Electron\//.test(ua);
}

export function seenFontNotice(cookie: string): boolean {
  return cookie.split(/;\s*/).includes(`${FONT_NOTICE_COOKIE}=1`);
}

function rememberFontNotice() {
  document.cookie = `${FONT_NOTICE_COOKIE}=1; max-age=31536000; path=/; SameSite=Lax`;
}

/** A one-time warning in browsers whose text layout may differ from Office's. */
export function FontEngineNotice() {
  const [shown, setShown] = useState(
    () => shapesWithoutHarfBuzz(navigator) && !seenFontNotice(document.cookie),
  );
  useEffect(() => {
    if (shown) rememberFontNotice();
  }, [shown]);
  return shown ? (
    <div className="notice font-engine-notice" role="status">
      <TriangleAlert size={18} />
      <span>
        Fonts may not match Microsoft Office in this browser, so lines and
        pages can break differently. Safari and every browser on iPhone and
        iPad lay out text with Apple’s Core Text; SuiteLeaf matches Office in
        Chrome, Edge, Firefox, and the SuiteLeaf desktop app.
      </span>
      <button aria-label="Dismiss" onClick={() => setShown(false)}>
        ×
      </button>
    </div>
  ) : null;
}
