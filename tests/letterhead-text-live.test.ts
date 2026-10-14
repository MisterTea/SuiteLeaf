import { describe, expect, it } from "vitest";
import {
  documentPageSettings,
  pageDimensions,
  pageFace,
  type PageSettings,
} from "../packages/core/src/document-layout";
import {
  liveLetterheadText,
  publishLiveLetterhead,
  readLiveLetterhead,
} from "../apps/web/src/editors/letterhead-text-live";
import { livePageSettings } from "../apps/web/src/editors/margin-live";

const inch = (n: number) => n * 96;

function page(patch: Partial<PageSettings> = {}): PageSettings {
  return documentPageSettings({
    type: "doc",
    attrs: {
      pageSettings: {
        margin: inch(1),
        marginTop: inch(1),
        marginBottom: inch(1),
        marginLeft: inch(1),
        marginRight: inch(1),
        header: "Club minutes",
        footer: "Draft",
        headerFromEdge: inch(1),
        footerFromEdge: inch(1),
        ...patch,
      },
    },
  });
}

function fakeRoot() {
  const data: Record<string, string> = {};
  let events = 0;
  const dataset = new Proxy({} as DOMStringMap, {
    get: (_target, key: string) => data[key],
    set: (_target, key: string, value: string) => {
      data[key] = String(value);
      return true;
    },
    deleteProperty: (_target, key: string) => {
      delete data[key];
      return true;
    },
  });
  return {
    root: {
      dataset,
      dispatchEvent: () => {
        events += 1;
        return true;
      },
    } as unknown as HTMLElement,
    events: () => events,
  };
}

describe("live header and footer text", () => {
  it("draws the words before apply and still turns the page", () => {
    const saved = page();
    const shown = livePageSettings(saved, {
      ...saved,
      header: "Town council",
      footer: "Hearing notes",
      landscape: true,
      marginTop: inch(1.5),
    });
    expect(shown.header).toBe("Town council");
    expect(shown.footer).toBe("Hearing notes");
    expect(pageFace(shown, 0, 1).header).toBe("Town council");
    expect(pageFace(shown, 0, 1).footer).toBe("Hearing notes");
    expect(shown.landscape).toBe(true);
    expect(shown.marginTop).toBe(inch(1.5));
    expect(shown.headerFromEdge).toBe(inch(1));
    expect(pageDimensions(shown).width).toBeGreaterThan(pageDimensions(shown).height);
  });

  it("restores the saved words when the draft is unchanged", () => {
    const saved = page();
    expect(liveLetterheadText(saved, saved)).toBe(saved);
    expect(livePageSettings(saved, { ...saved })).toBe(saved);
    expect(pageFace(saved, 0, 1).header).toBe("Club minutes");
    expect(pageFace(saved, 0, 1).footer).toBe("Draft");
  });

  it("clears a header before apply and leaves the footer", () => {
    const saved = page();
    const shown = liveLetterheadText(saved, { ...saved, header: "" });
    expect(shown.header).toBe("");
    expect(shown.footer).toBe("Draft");
    expect(pageFace(shown, 0, 1).header).toBe("");
  });

  it("keeps quotes, a line break, and the 500 character cap", () => {
    const saved = page();
    const words = 'Say "hello" & <town>\nnext';
    expect(liveLetterheadText(saved, { ...saved, footer: words }).footer).toBe(words);
    expect(
      liveLetterheadText(saved, { ...saved, header: "x".repeat(600) }).header,
    ).toHaveLength(500);
    expect(
      liveLetterheadText(saved, { ...saved, header: 4 as unknown as string }),
    ).toBe(saved);
  });

  it("draws a different first-page header when the file already uses one", () => {
    const saved = page({
      differentFirstPage: true,
      firstHeader: "Cover",
      header: "Later",
    });
    const shown = liveLetterheadText(saved, {
      ...saved,
      firstHeader: "Town council",
    });
    expect(pageFace(shown, 0, 2).header).toBe("Town council");
    expect(pageFace(shown, 1, 2).header).toBe("Later");
    expect(shown.differentFirstPage).toBe(true);
  });

  it("publishes the words for pagination and drops them on cancel", () => {
    const { root, events } = fakeRoot();
    const shown = liveLetterheadText(page(), {
      ...page(),
      header: 'Town "council"',
      footer: "Hearing notes",
    });
    publishLiveLetterhead(root, shown);
    expect(events()).toBe(1);
    expect(readLiveLetterhead(root)).toMatchObject({
      header: 'Town "council"',
      footer: "Hearing notes",
    });
    publishLiveLetterhead(root, shown);
    expect(events()).toBe(1);
    publishLiveLetterhead(root, null);
    expect(readLiveLetterhead(root)).toBeNull();
    expect(events()).toBe(2);
  });
});
