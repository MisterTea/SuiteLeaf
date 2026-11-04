import { describe, expect, it } from "vitest";
import { formatMergeField, mergeLetters, mergeLocale } from "../apps/web/src/editors/mail-merge";

describe("merge locale", () => {
  it("formats a date and a number for the locale and leaves the template", () => {
    const template = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "{{Planted|date}} {{Fee|number}} {{Note}}" }],
        },
      ],
    };
    const english = mergeLetters(template, ["Planted", "Fee", "Note"], [["2026-10-31", "1234.5", "31/10"]], "en-US");
    const german = mergeLetters(template, ["Planted", "Fee", "Note"], [["2026-10-31", "1234.5", "31/10"]], "de-DE");
    expect(english.ok).toBe(true);
    expect(german.ok).toBe(true);
    if (!english.ok || !german.ok) return;
    const englishText = english.content.content?.[0].content?.[0].text;
    const germanText = german.content.content?.[0].content?.[0].text;
    expect(englishText).toBe(
      `${formatMergeField("2026-10-31", "date", "en-US")} ${formatMergeField("1234.5", "number", "en-US")} 31/10`,
    );
    expect(germanText).toBe(
      `${formatMergeField("2026-10-31", "date", "de-DE")} ${formatMergeField("1234.5", "number", "de-DE")} 31/10`,
    );
    expect(englishText).not.toBe(germanText);
    expect(template.content[0].content[0].text).toBe("{{Planted|date}} {{Fee|number}} {{Note}}");
    expect(mergeLocale("de")).toBe("de-DE");
    expect(mergeLocale("en")).toBe("en-US");
    expect(formatMergeField("31/10", "date", "en-US")).toBe("31/10");
    expect(formatMergeField("2026-02-31", "date", "en-US")).toBe("2026-02-31");
    expect(formatMergeField("2026-13-01", "date", "en-US")).toBe("2026-13-01");
    expect(formatMergeField("2026-10-31T15:00:00Z", "date", "en-US")).toBe(
      formatMergeField("2026-10-31", "date", "en-US"),
    );
    expect(formatMergeField(" 2026-01-15T23:00:00-05:00 ", "date", "en-US")).toBe(
      formatMergeField("2026-01-15", "date", "en-US"),
    );
    expect(formatMergeField("2026-01-15T24:00:00Z", "date", "en-US")).toBe("2026-01-15T24:00:00Z");
    expect(formatMergeField("2026-02-31T00:00:00Z", "date", "en-US")).toBe("2026-02-31T00:00:00Z");
    expect(formatMergeField("secret-value", "date", "en-US")).toBe("secret-value");
    expect(formatMergeField("1234.5", "word", "en-US")).toBe("1234.5");
  });

  it("formats a currency for the locale and leaves an unknown code as written", () => {
    const template = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "{{Fee|currency:USD}}" }],
        },
      ],
    };
    const english = mergeLetters(template, ["Fee"], [["10"]], "en-US");
    expect(english.ok).toBe(true);
    if (!english.ok) return;
    expect(english.content.content?.[0].content?.[0].text).toBe(
      formatMergeField("10", "currency:USD", "en-US"),
    );
    expect(formatMergeField("10", "currency:USD", "en-US")).toBe("$10.00");
    expect(formatMergeField("10", "currency:usd", "en-US")).toBe("$10.00");
    expect(formatMergeField("10", "currency:secret-value", "en-US")).toBe("10");
    expect(formatMergeField("secret-value", "currency:USD", "en-US")).toBe("secret-value");
    expect(formatMergeField("10.0", "number", "en-US")).toBe("10");
    expect(formatMergeField("1e2", "number", "en-US")).toBe("1e2");
    expect(formatMergeField("10 beds", "currency:USD", "en-US")).toBe("10 beds");
    expect(formatMergeField("10.0", "currency:USD", "en-US")).toBe("$10.00");
    expect(template.content[0].content[0].text).toBe("{{Fee|currency:USD}}");
  });
});
