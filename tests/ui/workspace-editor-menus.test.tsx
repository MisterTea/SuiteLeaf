// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMenu } from "./workspace-fakes";

const state = vi.hoisted(() => ({ session: null as null | { user: { id: string } } }));
vi.mock("../../apps/web/src/node-client", () => ({ getSession: () => state.session }));

import { CommandPalette } from "../../apps/web/src/command-palette";
import type { EditorActions } from "../../apps/web/src/ui";
import { DocMenus } from "../../apps/web/src/workspace/workspace-doc-menus";
import { SheetMenus } from "../../apps/web/src/workspace/workspace-sheet-menus";
import { SlideMenus } from "../../apps/web/src/workspace/workspace-slide-menus";
import { sheetTextRotation } from "../../apps/web/src/sheet-text-rotation";

/** Editor actions that note each call as "group.name(args)". */
function recording(overrides: Record<string, Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const group = (name: string) =>
    new Proxy(overrides[name] ?? {}, {
      get(target, key) {
        if (typeof key !== "string") return undefined;
        if (key in target) return target[key];
        if (/Reason$|State$|^slideNumbers$|^hasFilter$/.test(key)) return () => undefined;
        return (...args: unknown[]) => {
          calls.push(`${name}.${key}(${args.map((a) => JSON.stringify(a)).join(",")})`);
        };
      },
    });
  const actions = {
    flush: async () => {},
    export: async () => {},
    print: async () => void calls.push("print()"),
    present: () => void calls.push("present()"),
    docActions: group("doc"),
    sheetActions: group("sheet"),
    slideActions: group("slide"),
  } as unknown as EditorActions;
  return { calls, ref: { current: actions } };
}

const sheetView = {
  view: () => ({
    frozenRows: 0,
    frozenColumns: 0,
    row: 1,
    column: 1,
    maxFrozenRows: 10,
    maxFrozenColumns: 10,
    gridlines: true,
    formulaBar: true,
  }),
};

async function expectCalls(calls: string[], commands: [string, string][]) {
  for (const [path, call] of commands) {
    calls.length = 0;
    await runMenu(path);
    expect([path, calls]).toEqual([path, [call]]);
  }
}

beforeEach(() => {
  state.session = null;
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("document menus", () => {
  it("send each command to the document editor", async () => {
    const { calls, ref } = recording();
    const doAction = vi.fn(async () => {});
    render(
      <CommandPalette kind="doc">
        <div className="file-menu">
          <DocMenus actions={ref} doAction={doAction} />
        </div>
      </CommandPalette>,
    );
    await expectCalls(calls, [
      ["Edit › Undo", "doc.undo()"],
      ["Edit › Redo", "doc.redo()"],
      ["Edit › Find and replace", "doc.openFind()"],
      ["Edit › Select all", "doc.selectAll()"],
      ["Insert › Image", "doc.insertImage()"],
      ["Insert › Text box", "doc.insertTextBox()"],
      ["Insert › Shape › Rectangle", 'doc.insertShape("rect")'],
      ["Insert › Shape › Ellipse", 'doc.insertShape("ellipse")'],
      ["Insert › Table", "doc.insertTable()"],
      ["Insert › Insert chart", "doc.insertChart()"],
      ["Insert › Equation", "doc.insertEquation()"],
      ["Insert › Horizontal line", "doc.insertHorizontalRule()"],
      ["Insert › Page break", "doc.insertPageBreak()"],
      ["Insert › Section break", "doc.insertSectionBreak()"],
      ["Insert › Drawing", "doc.insertDrawing()"],
      ["Insert › Table of contents › With page numbers", "doc.insertTableOfContents(true)"],
      ["Insert › Table of contents › With links", "doc.insertTableOfContents(false)"],
      ["Insert › Figure list", 'doc.insertFigureList("figure")'],
      ["Insert › Table list", 'doc.insertFigureList("table")'],
      ["Insert › Footnote", "doc.insertFootnote()"],
      ["Insert › Endnote", "doc.insertEndnote()"],
      ["Insert › Link", "doc.insertLink()"],
      ["Insert › Comment", "doc.insertComment()"],
      ["Format › Bold", "doc.toggleBold()"],
      ["Format › Italic", "doc.toggleItalic()"],
      ["Format › Underline", "doc.toggleUnderline()"],
      ["Format › Strikethrough", "doc.toggleStrike()"],
      ["Format › Superscript", "doc.toggleSuperscript()"],
      ["Format › Subscript", "doc.toggleSubscript()"],
      ["Format › Align left", 'doc.align("left")'],
      ["Format › Align center", 'doc.align("center")'],
      ["Format › Align right", 'doc.align("right")'],
      ["Format › Justify", 'doc.align("justify")'],
      ["Format › Bulleted list", "doc.toggleBulletList()"],
      ["Format › Numbered list", "doc.toggleOrderedList()"],
      ["Format › One column", "doc.setColumns(1)"],
      ["Format › Two columns", "doc.setColumns(2)"],
      ["Format › Don't leave one line", "doc.toggleWidowControl()"],
      ["Format › Clear formatting", "doc.clearFormatting()"],
      ["Format › Update Normal text to match", "doc.updateNormalText()"],
      ["Tools › Merge from a spreadsheet", "doc.openMailMerge()"],
      ["Tools › Named styles", "doc.openNamedStyles()"],
      ["Tools › Word count", "doc.openWordCount()"],
      ["Tools › Spelling", "doc.openSpelling()"],
      ["Tools › Proofing language", "doc.openSpelling()"],
      ["Tools › Grammar", "doc.openGrammar()"],
      ["Tools › Ignored grammar", "doc.openIgnoredGrammar()"],
      ["Tools › Personal dictionary", "doc.openDictionary()"],
      ["Tools › Citations", "doc.openCitations()"],
      ["Tools › Find and replace", "doc.openFind()"],
      ["Tools › Review suggestions", "doc.openSuggestions()"],
    ]);
    await runMenu("View › Print layout");
    expect(doAction).toHaveBeenCalledWith("print");
  });

  it("says why a link cannot be inserted", async () => {
    const { ref } = recording({
      doc: { linkState: () => ({ ok: false, reason: "Select some text first." }) },
    });
    render(
      <CommandPalette kind="doc">
        <DocMenus actions={ref} doAction={vi.fn()} />
      </CommandPalette>,
    );
    fireEvent.keyDown(window, { key: "/", code: "Slash", altKey: true });
    fireEvent.change(screen.getByPlaceholderText("Search the menus"), { target: { value: "Link" } });
    const option = screen
      .getAllByRole("option")
      .find((o) => o.querySelector(".command-path")?.textContent === "Insert › Link")!;
    expect(option.getAttribute("aria-disabled")).toBe("true");
    expect(option.textContent).toContain("Select some text first.");
  });

  it("opens search and the shortcut list from Help", async () => {
    const { ref } = recording();
    render(
      <CommandPalette kind="doc">
        <DocMenus actions={ref} doAction={vi.fn()} />
      </CommandPalette>,
    );
    await runMenu("Help › Keyboard shortcuts");
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await runMenu("Help › Search the menus");
    expect(screen.getByRole("dialog", { name: "Search the menus" })).toBeTruthy();
  });

  it("lists the table commands for the current selection when the submenu opens", async () => {
    Object.defineProperty(window, "innerWidth", { value: 600, configurable: true });
    const run = vi.fn();
    const { ref } = recording({
      doc: {
        tableActions: () => [
          { label: "Insert row above", run, disabled: false },
          { label: "Header row", run, disabled: false, checked: true, separatorBefore: true },
        ],
      },
    });
    render(
      <CommandPalette kind="doc">
        <div className="file-menu">
          <DocMenus actions={ref} doAction={vi.fn()} />
        </div>
      </CommandPalette>,
    );
    const format = screen.getByRole("button", { name: "Format" });
    fireEvent.keyDown(format, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^Table/ }));
    fireEvent.click(await within(menu).findByRole("menuitem", { name: "Insert row above" }));
    expect(run).toHaveBeenCalled();
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  });
});

describe("spreadsheet menus", () => {
  const render2 = (canEdit: boolean, mode = { kind: "single" } as never, overrides = {}) => {
    const rec = recording({ sheet: { ...sheetView, ...overrides } });
    const doAction = vi.fn(async () => {});
    render(
      <CommandPalette kind="sheet">
        <div className="file-menu">
          <SheetMenus actions={rec.ref} doAction={doAction} canEdit={canEdit} mode={mode} />
        </div>
      </CommandPalette>,
    );
    return { ...rec, doAction };
  };

  it("send each command to the spreadsheet editor", async () => {
    const { calls } = render2(true);
    await expectCalls(calls, [
      ["Edit › Undo", "sheet.undo()"],
      ["Edit › Redo", "sheet.redo()"],
      ["Edit › Cut", "sheet.cut()"],
      ["Edit › Copy", "sheet.copy()"],
      ["Edit › Paste", "sheet.paste()"],
      ["Edit › Paste special › Transpose", "sheet.pasteTranspose()"],
      ["Edit › Delete values", "sheet.deleteValues()"],
      ["Insert › Image", "sheet.insertImage()"],
      ["Insert › Page break above", "sheet.insertPageBreak()"],
      ["Insert › Chart", "sheet.insertChart()"],
      ["Insert › Pivot table", "sheet.insertPivot()"],
      ["Insert › Function › Insert function", 'sheet.insertFunction("SUM")'],
      ["Insert › Link", "sheet.insertLink()"],
      ["Insert › Checkbox", "sheet.insertCheckbox()"],
      ["Insert › Dropdown", "sheet.insertDropdown()"],
      ["Insert › Cell comment", "sheet.insertComment()"],
      ["Insert › Note", "sheet.insertNote()"],
      ["Format › Currency ($)", "sheet.formatCurrency()"],
      ["Format › Percent (%)", "sheet.formatPercent()"],
      ["Format › Bold", "sheet.toggleBold()"],
      ["Format › Italic", "sheet.toggleItalic()"],
      ["Format › Strikethrough", "sheet.toggleStrike()"],
      ["Format › Align left", 'sheet.align("left")'],
      ["Format › Align center", 'sheet.align("center")'],
      ["Format › Align right", 'sheet.align("right")'],
      ["Format › Unmerge cells", "sheet.unmergeCells()"],
      ["Format › Rotate text › Tilt counterclockwise", `sheet.rotateText(${JSON.stringify(sheetTextRotation.tiltCounterclockwise)})`],
      ["Format › Rotate text › Tilt clockwise", `sheet.rotateText(${JSON.stringify(sheetTextRotation.tiltClockwise)})`],
      ["Format › Rotate text › Rotate up", `sheet.rotateText(${JSON.stringify(sheetTextRotation.up)})`],
      ["Format › Rotate text › Rotate down", `sheet.rotateText(${JSON.stringify(sheetTextRotation.down)})`],
      ["Format › Rotate text › Vertical", `sheet.rotateText(${JSON.stringify(sheetTextRotation.vertical)})`],
      ["Format › Rotate text › None", `sheet.rotateText(${JSON.stringify(sheetTextRotation.none)})`],
      ["Format › Clear formatting", "sheet.clearFormatting()"],
      ["Format › Conditional formatting", "sheet.conditionalFormatting()"],
      ["Format › Alternating colors", "sheet.alternatingColors()"],
      ["Data › Create a filter", "sheet.toggleFilter()"],
      ["Data › Pivot table", "sheet.insertPivot()"],
      ["Data › Sort range", "sheet.sortRange()"],
      ["Data › Named ranges", "sheet.namedRanges()"],
      ["Data › Group rows", "sheet.groupRows()"],
      ["Data › Group columns", "sheet.groupColumns()"],
      ["Data › Data cleanup › Trim whitespace", "sheet.trimWhitespace()"],
      ["Data › Data cleanup › Remove duplicates", "sheet.removeDuplicates()"],
      ["Data › Split text to columns", "sheet.splitTextToColumns()"],
      ["Data › Data validation", "sheet.dataValidation()"],
      ["Data › Protect sheets and ranges", "sheet.tabsProtection()"],
      ["Tools › Spelling", "sheet.openSpelling()"],
      ["Tools › Proofing language", "sheet.openLanguage()"],
      ["Tools › Your name on comments…", "sheet.commentName()"],
    ]);
  });

  it("offers filter views to a reader, and hides the comment name when signed in to a server", async () => {
    state.session = { user: { id: "ada" } };
    const { calls } = render2(false, { kind: "cluster", serverUrl: "https://drive.example" } as never);
    await expectCalls(calls, [["Data › Filter views › Create a filter view", "sheet.createFilterView()"]]);
    fireEvent.keyDown(window, { key: "/", code: "Slash", altKey: true });
    fireEvent.change(screen.getByPlaceholderText("Search the menus"), { target: { value: "Your name on comments" } });
    expect(
      screen.queryAllByRole("option").some((o) => o.textContent?.includes("Your name on comments")),
    ).toBe(false);
  });

  it("names the filter command after the current state when the Data menu opens", async () => {
    render2(false, { kind: "single" } as never, { hasFilter: () => true });
    fireEvent.keyDown(screen.getByRole("button", { name: "Data" }), { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Remove filter" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Remove filter" }).getAttribute("aria-disabled")).toBe("true");
  });
});

describe("presentation menus", () => {
  it("send each command to the presentation editor", async () => {
    const { calls, ref } = recording();
    render(
      <CommandPalette kind="slide">
        <div className="file-menu">
          <SlideMenus actions={ref} />
        </div>
      </CommandPalette>,
    );
    await expectCalls(calls, [
      ["Edit › Undo", "slide.undo()"],
      ["Edit › Redo", "slide.redo()"],
      ["Edit › Cut", "slide.cut()"],
      ["Edit › Copy", "slide.copy()"],
      ["Edit › Paste", "slide.paste()"],
      ["View › Slideshow", "present()"],
      ["View › Presenter view", "slide.presenterView()"],
      ["View › Print preview", "print()"],
      ["View › Handouts", "slide.handouts()"],
      ["View › Slide numbers", "slide.toggleSlideNumbers()"],
      ["Insert › Text box", "slide.insertTextBox()"],
      ["Insert › Image", "slide.insertImage()"],
      ["Insert › Audio", "slide.insertAudio()"],
      ["Insert › Video", "slide.insertVideo()"],
      ["Insert › Shape › Rectangle", 'slide.insertShape("rect")'],
      ["Insert › Shape › Rounded rectangle", 'slide.insertShape("roundRect")'],
      ["Insert › Shape › Ellipse", 'slide.insertShape("ellipse")'],
      ["Insert › Word art", "slide.insertWordArt()"],
      ["Insert › Animation › Fade in on click", 'slide.animate("fade-on-click")'],
      ["Insert › Animation › Appear on click", 'slide.animate("appear-on-click")'],
      ["Insert › Animation › Fly in on click", 'slide.animate("fly-on-click")'],
      ["Insert › Animation › Wipe on click", 'slide.animate("wipe-on-click")'],
      ["Insert › Animation › Zoom in on click", 'slide.animate("zoom-on-click")'],
      ["Insert › Animation › Remove animation", "slide.animate(null)"],
      ["Insert › New slide", "slide.newSlide()"],
      ["Format › Text › Bold", "slide.toggleBold()"],
      ["Format › Text › Italic", "slide.toggleItalic()"],
      ["Format › Align & indent › Align left", 'slide.align("left")'],
      ["Format › Align & indent › Center", 'slide.align("center")'],
      ["Format › Align & indent › Align right", 'slide.align("right")'],
      ["Slide › New slide", "slide.newSlide()"],
      ["Slide › Duplicate slide", "slide.duplicate()"],
      ["Slide › Delete slide", "slide.deleteSlides()"],
      ["Slide › Move up", 'slide.move("up")'],
      ["Slide › Move down", 'slide.move("down")'],
      ["Slide › Move to start", 'slide.move("start")'],
      ["Slide › Move to end", 'slide.move("end")'],
      ["Slide › Apply layout › Title slide", 'slide.applyLayout("title")'],
      ["Slide › Apply layout › Title & body", 'slide.applyLayout("title-body")'],
      ["Slide › Apply layout › Two columns", 'slide.applyLayout("two-column")'],
      ["Slide › Apply layout › Section header", 'slide.applyLayout("section")'],
      ["Slide › Apply layout › Blank slide", 'slide.applyLayout("blank")'],
      ["Slide › Change theme", "slide.openTheme()"],
      ["Slide › Transition", "slide.openTransition()"],
      ["Slide › Animation pane", "slide.openAnimationPane()"],
      ["Slide › Edit master", "slide.openMaster()"],
      ["Comments › Comment", "slide.insertComment()"],
      ["Comments › Resolved", "slide.openResolved()"],
      ["Tools › Spelling", "slide.openSpelling()"],
      ["Tools › Proofing language", "slide.openLanguage()"],
    ]);
  });

  it("explains unavailable commands and falls back to fade for older editors", async () => {
    const fade = vi.fn();
    const ref = {
      current: {
        flush: async () => {},
        export: async () => {},
        print: async () => {},
        slideActions: {
          undoReason: () => "Nothing to undo.",
          redoReason: () => undefined,
          deleteReason: () => "Keep at least one slide.",
          animationReason: (kind: string) => (kind === "wipe-on-click" ? "Select a shape first." : undefined),
          fadeOnClick: fade,
        },
      },
    } as unknown as { current: EditorActions };
    render(
      <CommandPalette kind="slide">
        <SlideMenus actions={ref} />
      </CommandPalette>,
    );
    fireEvent.keyDown(window, { key: "/", code: "Slash", altKey: true });
    const search = screen.getByPlaceholderText("Search the menus");
    const option = (path: string) =>
      screen.getAllByRole("option").find((o) => o.querySelector(".command-path")?.textContent === path)!;
    fireEvent.change(search, { target: { value: "Undo" } });
    expect(option("Edit › Undo").textContent).toContain("Nothing to undo.");
    fireEvent.change(search, { target: { value: "Delete slide" } });
    expect(option("Slide › Delete slide").textContent).toContain("Keep at least one slide.");
    fireEvent.change(search, { target: { value: "Wipe on click" } });
    expect(option("Insert › Animation › Wipe on click").getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    await runMenu("Insert › Animation › Fade in on click");
    expect(fade).toHaveBeenCalled();
    await runMenu("Insert › Animation › Appear on click");
    expect(fade).toHaveBeenCalledTimes(1);
  });
});
