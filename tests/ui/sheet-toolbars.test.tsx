// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../apps/web/src/command-palette", () => ({ MenuSearchPill: () => <span data-testid="menu-search" /> }));

const { SheetFormatToolbar, SheetToolbar } = await import("../../apps/web/src/editors/sheet-toolbars");
import type { SheetFormatCommands, SheetTextFormat } from "../../apps/web/src/editors/sheet-format-commands";

afterEach(cleanup);

function recorder() {
  const calls: unknown[][] = [];
  const commands = new Proxy({} as SheetFormatCommands, {
    get: (_target, key) => (...args: unknown[]) =>
      void calls.push([key, ...args.filter((arg) => !(arg && typeof arg === "object" && "nativeEvent" in arg))]),
  });
  return { calls, commands };
}

const format = {
  zoom: "100%",
  fontFamily: "Lato",
  fontSize: 10,
  isBold: true,
  isItalic: false,
  isStrike: false,
  textColor: "#000000",
  fillColor: "#ffffff",
} as SheetTextFormat;

function toggles() {
  const flips: string[] = [];
  const toggle = (name: string) => (update: (open: boolean) => boolean) => void flips.push(`${name}:${update(false)}`);
  return { flips, toggle };
}

it("sends each toolbar button to its command and toggles the side panels", async () => {
  const { calls, commands } = recorder();
  const { flips, toggle } = toggles();
  const log: string[] = [];
  const filters = { current: false };
  render(
    <SheetToolbar
      readOnly={false}
      insertAxis="row"
      onInsertAxis={() => log.push("insert-row")}
      ready
      api={{ current: { undo: () => log.push("undo"), redo: () => log.push("redo"), executeCommand: (id: string) => log.push(id) } }}
      book={{ current: { getActiveSheet: () => ({ getFilter: () => filters.current }) } }}
      undoCollab={{ current: () => false }}
      redoCollab={{ current: () => true }}
      printSheet={{ current: async () => Promise.reject(new Error("printer busy")) }}
      onError={(message) => log.push(`error:${message}`)}
      auditOpen={false}
      setAuditOpen={toggle("audit") as never}
      costOpen
      setCostOpen={toggle("cost") as never}
      sheetAccessOpen={false}
      setSheetAccessOpen={toggle("access") as never}
      queryOpen={false}
      setQueryOpen={toggle("query") as never}
      goalOpen={false}
      setGoalOpen={toggle("goal") as never}
      format={format}
      commands={commands}
      startPanel={(type) => log.push(`panel:${type}`)}
      toggleFilter={() => log.push("filter")}
      functions={{ autoSum: () => log.push("sum") }}
    />,
  );
  const bar = screen.getByRole("toolbar", { name: "Spreadsheet formatting" });
  const click = (name: string) => fireEvent.click(within(bar).getByRole("button", { name }));
  click("Undo (Cmd+Z)");
  click("Redo (Cmd+Y)");
  click("Print (Cmd+P)");
  expect(within(bar).queryByRole("button", { name: "Language" })).toBeNull();
  for (const name of ["Audit", "Cost", "Accessibility", "Query", "Goal Seek"]) click(name);
  click("Paint format");
  click("Format as currency");
  click("Format as percent");
  click("Decrease decimal places");
  click("Increase decimal places");
  click("Insert comment (Cmd+Option+M)");
  click("Insert chart");
  click("Create a filter");
  click("Functions");
  click("Pivot table");
  click("Insert row below");
  fireEvent.change(within(bar).getByLabelText("Zoom"), { target: { value: "150%" } });
  const formats = bar.querySelector(".more-formats-menu")!;
  fireEvent.click(within(formats as HTMLElement).getAllByRole("button")[0]);
  await new Promise((done) => setTimeout(done, 0));
  expect(flips).toEqual(["audit:true", "cost:true", "access:true", "query:true", "goal:true"]);
  expect(log).toEqual([
    "undo",
    "sheet.operation.show-comment-modal",
    "panel:chart",
    "filter",
    "sum",
    "panel:pivot",
    "insert-row",
    "error:printer busy",
  ]);
  expect(calls.map(([name]) => name)).toEqual([
    "formatCurrency",
    "formatPercent",
    "subtractDecimal",
    "addDecimal",
    "handleZoom",
    "applyNamedFormatNow",
  ]);
  expect(calls[4]).toEqual(["handleZoom", "150%"]);
});

it("marks an active filter and disables editing tools for a viewer", () => {
  const { commands } = recorder();
  const noop = () => {};
  render(
    <SheetToolbar
      readOnly
      insertAxis="column"
      ready={false}
      api={{ current: null }}
      book={{ current: { getActiveSheet: () => ({ getFilter: () => ({}) }) } }}
      undoCollab={{ current: () => false }}
      redoCollab={{ current: () => false }}
      printSheet={{ current: async () => {} }}
      onError={noop}
      auditOpen
      setAuditOpen={noop as never}
      costOpen={false}
      setCostOpen={noop as never}
      sheetAccessOpen
      setSheetAccessOpen={noop as never}
      queryOpen
      setQueryOpen={noop as never}
      goalOpen
      setGoalOpen={noop as never}
      format={format}
      commands={commands}
      startPanel={noop}
      toggleFilter={noop}
      functions={{ autoSum: noop }}
    />,
  );
  const filter = screen.getByRole("button", { name: "Remove filter" });
  expect(filter.getAttribute("aria-pressed")).toBe("true");
  expect(filter).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Insert column right" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Undo (Cmd+Z)" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Insert chart" })).toHaveProperty("disabled", true);
});

it("sends text formatting to its commands and keeps a font that is not in the list", () => {
  const { calls, commands } = recorder();
  const links: string[] = [];
  render(<SheetFormatToolbar readOnly={false} format={format} commands={commands} links={{ current: { open: () => links.push("open") } }} />);
  const bar = screen.getByRole("toolbar", { name: "Text formatting" });
  const family = within(bar).getByLabelText("Font family") as HTMLSelectElement;
  expect([...family.options].map((option) => option.value)[0]).toBe("Lato");
  fireEvent.change(family, { target: { value: "Georgia" } });
  fireEvent.click(within(bar).getByRole("button", { name: "Decrease font size" }));
  fireEvent.click(within(bar).getByRole("button", { name: "Increase font size" }));
  fireEvent.change(within(bar).getByLabelText("Font size"), { target: { value: "abc" } });
  fireEvent.change(within(bar).getByLabelText("Font size"), { target: { value: "14" } });
  for (const name of [
    "Bold (Cmd+B)",
    "Italic (Cmd+I)",
    "Strikethrough (Alt+Shift+5)",
    "Borders",
    "Merge cells",
    "Horizontal align",
    "Vertical align",
    "Text wrapping",
    "Insert link (Cmd+K)",
  ])
    fireEvent.click(within(bar).getByRole("button", { name }));
  fireEvent.click(within(bar).getByRole("button", { name: "Text color" }));
  fireEvent.change(screen.getByRole("dialog", { name: "Text color" }).querySelector("input")!, { target: { value: "255" } });
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Text color" }).querySelector("input")!, { key: "Enter" });
  fireEvent.click(within(bar).getByRole("button", { name: "Fill color" }));
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Fill color" }).querySelector("input")!, { key: "Enter" });
  expect(calls).toEqual([
    ["handleFontFamily", "Georgia"],
    ["handleFontSize", 9],
    ["handleFontSize", 11],
    ["handleFontSize", 10],
    ["handleFontSize", 14],
    ["toggleBold"],
    ["toggleItalic"],
    ["toggleStrike"],
    ["applyBorders"],
    ["mergeCells"],
    ["cycleHorizontalAlign"],
    ["cycleVerticalAlign"],
    ["toggleWrap"],
    ["handleTextColor", "#ff0000"],
    ["handleFillColor", "#ffffff"],
  ]);
  expect(links).toEqual(["open"]);
});
