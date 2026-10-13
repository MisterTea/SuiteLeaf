import { describe, expect, it } from "vitest";
import {
  appHandlesShortcut,
  eventMatchesShortcut,
  formatShortcut,
  isUnimplemented,
  searchCommands,
  type CommandView,
} from "../apps/web/src/commands";

const strike: CommandView = {
  id: "Format/Strikethrough",
  label: "Strikethrough",
  path: ["Format"],
  shortcut: "Cmd+Shift+X",
  synonyms: ["strike", "strikethrough", "cross out"],
};
const pageSetup: CommandView = {
  id: "File/Page setup…",
  label: "Page setup…",
  path: ["File"],
  synonyms: ["page numbers", "page number", "page setup", "margins"],
};
const freezeRow: CommandView = {
  id: "View/Freeze/1 row",
  label: "1 row",
  path: ["View", "Freeze"],
  synonyms: ["freeze", "freeze row", "freeze header", "freeze the top row"],
};
const freezeTwo: CommandView = {
  id: "View/Freeze/2 rows",
  label: "2 rows",
  path: ["View", "Freeze"],
};
const duplicate: CommandView = {
  id: "Slide/Duplicate slide",
  label: "Duplicate slide",
  path: ["Slide"],
  shortcut: "Cmd+D",
  synonyms: ["dup", "duplicate", "duplicate slide"],
};
const comment: CommandView = {
  id: "Insert/Cell comment",
  label: "Cell comment",
  path: ["Insert"],
  synonyms: ["comment", "comments", "note"],
};
const link: CommandView = {
  id: "Insert/Link",
  label: "Link",
  path: ["Insert"],
  shortcut: "Cmd+K",
  synonyms: ["link", "hyperlink"],
  disabledReason: "Select text to add a link",
};

describe("command search", () => {
  const commands = [pageSetup, freezeTwo, freezeRow, strike, duplicate, link];

  it("ranks strikethrough first for strike", () => {
    const [top] = searchCommands(commands, "strike");
    expect(top.label).toBe("Strikethrough");
    expect(top.path).toEqual(["Format"]);
  });

  it("finds word count from count, and says it is not in SuiteLeaf yet", () => {
    const [top] = searchCommands(commands, "count");
    expect(top.label).toBe("Word count");
    expect(top.path).toEqual(["Tools"]);
    expect(top.disabledReason).toMatch(/doesn't have word count yet/);
  });

  it("runs a real word count command instead of the missing-feature note", () => {
    const wordCount: CommandView = {
      id: "Tools/Word count",
      label: "Word count",
      path: ["Tools"],
      synonyms: ["count", "word count", "words"],
    };
    const [top] = searchCommands([...commands, wordCount], "count");
    expect(top.label).toBe("Word count");
    expect(top.id).toBe("Tools/Word count");
    expect(top.disabledReason).toBeUndefined();
  });

  it("finds page setup from page numbers", () => {
    expect(searchCommands(commands, "page numbers")[0].label).toBe("Page setup…");
  });

  it("ranks freeze 1 row ahead of the other freeze commands", () => {
    expect(searchCommands(commands, "freeze")[0]).toMatchObject({
      label: "1 row",
      path: ["View", "Freeze"],
    });
  });

  it("keeps a command that cannot run, with the reason", () => {
    const [top] = searchCommands(commands, "link");
    expect(top.disabledReason).toBe("Select text to add a link");
  });

  it("finds duplicate slide from dup", () => {
    expect(searchCommands(commands, "dup")[0].label).toBe("Duplicate slide");
  });

  it("says remove duplicates is not available yet", () => {
    const [top] = searchCommands(commands, "remove duplicates");
    expect(top.label).toBe("Remove duplicates");
    expect(top.disabledReason).toMatch(/doesn't have remove duplicates yet/);
  });

  it("uses a real comment command instead of the missing-feature note", () => {
    const [top] = searchCommands([...commands, comment], "comment");
    expect(top.label).toBe("Cell comment");
    expect(top.disabledReason).toBeUndefined();
  });

  it("says comments are missing when the app has none", () => {
    const [top] = searchCommands(commands, "comment");
    expect(top.label).toBe("Comment");
    expect(top.disabledReason).toMatch(/doesn't have comments/);
  });

  it("lists recent commands first when the query is empty", () => {
    const results = searchCommands(commands, "", [
      duplicate.id,
      strike.id,
      "missing",
    ]);
    expect(results.slice(0, 2).map((command) => command.id)).toEqual([
      duplicate.id,
      strike.id,
    ]);
  });
});

describe("shortcut labels", () => {
  it("uses Mac glyphs", () => {
    expect(formatShortcut("Cmd+Shift+X", true)).toBe("⌘⇧X");
    expect(formatShortcut("Alt+/", true)).toBe("⌥/");
    expect(formatShortcut("Mod+/", true)).toBe("⌘/");
    expect(formatShortcut("Ctrl+Alt+M", true)).toBe("⌃⌥M");
  });

  it("uses Ctrl, Alt, and Shift elsewhere", () => {
    expect(formatShortcut("Cmd+Shift+X", false)).toBe("Ctrl+Shift+X");
    expect(formatShortcut("Alt+/", false)).toBe("Alt+/");
    expect(formatShortcut("Mod+/", false)).toBe("Ctrl+/");
  });

  it("matches Option+/ even when the key character is not a slash", () => {
    expect(
      eventMatchesShortcut(
        "Alt+/",
        { key: "÷", code: "Slash", metaKey: false, ctrlKey: false, altKey: true, shiftKey: false },
        true,
      ),
    ).toBe(true);
  });

  it("does not treat editor-owned shortcuts as palette shortcuts", () => {
    expect(appHandlesShortcut("Cmd+B", "doc", false)).toBe(false);
    expect(appHandlesShortcut("Cmd+Shift+H", "doc", false)).toBe(true);
    expect(appHandlesShortcut("Cmd+D", "slide", false)).toBe(true);
    expect(appHandlesShortcut("Cmd+K", "sheet", false)).toBe(true);
    expect(appHandlesShortcut("Cmd+K", "sheet", true)).toBe(false);
    expect(appHandlesShortcut("Cmd+D", "slide", true)).toBe(false);
  });

  it("recognises an empty menu handler", () => {
    expect(isUnimplemented(() => {})).toBe(true);
    expect(isUnimplemented(() => "kept")).toBe(false);
  });
});
