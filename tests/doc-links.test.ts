import { describe, expect, it } from "vitest";
import { linkTarget } from "../apps/web/src/editors/doc-links";

describe("document link dialog addresses", () => {
  it("keeps safe links as typed", () => {
    for (const url of [
      "https://example.org/seed-swap",
      "http://example.org",
      "mailto:asha@example.org",
      "tel:+441234567890",
      "#volunteers",
    ])
      expect(linkTarget(`  ${url} `)).toBe(url);
  });

  it("adds https:// to a bare web address and mailto: to an email address", () => {
    expect(linkTarget("example.org/rules")).toBe("https://example.org/rules");
    expect(linkTarget("www.example.org")).toBe("https://www.example.org");
    expect(linkTarget("club.example.org:8080/a?b=1")).toBe(
      "https://club.example.org:8080/a?b=1",
    );
    expect(linkTarget("asha@example.org")).toBe("mailto:asha@example.org");
  });

  it("rejects unsafe or unusable addresses", () => {
    for (const url of [
      "",
      "   ",
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "ftp://example.org",
      "seed swap",
      "rules",
      "https://example.org/has space",
    ])
      expect(linkTarget(url)).toBeNull();
  });
});
