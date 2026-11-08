import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  BarChart3,
  TableProperties,
  Filter,
  Undo2,
  Redo2,
  Printer,
  ListChecks,
  Target,
  Timer,
  PaintRoller,
  Minus,
  Plus,
  Bold,
  Italic,
  Strikethrough,
  PaintBucket,
  Grid,
  Split,
  AlignLeft,
  AlignVerticalSpaceAround,
  WrapText,
  Link,
  MessageSquarePlus,
  ChevronDown,
} from "lucide-react";
import { ColorTool } from "./color-picker";
import { FontControls } from "./font-controls";
import { numberFormatsByGroup } from "../formats";
import { Tool } from "../ui";
import { MenuSearchPill } from "../command-palette";
import type { SheetLinkHandle } from "./sheet-links";
import type { SheetFormatCommands, SheetTextFormat } from "./sheet-format-commands";

type Toggle = Dispatch<SetStateAction<boolean>>;

const SHEET_FONTS = ["Arial", "Roboto", "Calibri", "Times New Roman", "Courier New", "Georgia"];

export function SheetToolbar({
  insertAxis,
  onInsertAxis,
  readOnly,
  ready,
  api,
  book,
  undoCollab,
  redoCollab,
  printSheet,
  onError,
  auditOpen,
  setAuditOpen,
  costOpen,
  setCostOpen,
  sheetAccessOpen,
  setSheetAccessOpen,
  queryOpen,
  setQueryOpen,
  goalOpen,
  setGoalOpen,
  format,
  commands,
  startPanel,
  toggleFilter,
  functions,
}: {
  insertAxis?: "row" | "column";
  onInsertAxis?: () => void;
  readOnly: boolean;
  ready: boolean;
  api: RefObject<any>;
  book: RefObject<any>;
  undoCollab: RefObject<() => boolean>;
  redoCollab: RefObject<() => boolean>;
  printSheet: RefObject<() => Promise<void>>;
  onError: (s: string) => void;
  auditOpen: boolean;
  setAuditOpen: Toggle;
  costOpen: boolean;
  setCostOpen: Toggle;
  sheetAccessOpen: boolean;
  setSheetAccessOpen: Toggle;
  queryOpen: boolean;
  setQueryOpen: Toggle;
  goalOpen: boolean;
  setGoalOpen: Toggle;
  format: SheetTextFormat;
  commands: SheetFormatCommands;
  startPanel: (type: "chart" | "pivot", id?: string) => void;
  toggleFilter: () => void;
  functions: { autoSum: () => void };
}) {
  const { zoom } = format;
  const { handleZoom, formatCurrency, formatPercent, subtractDecimal, addDecimal, applyNamedFormatNow } =
    commands;
  return (
  <div
    className="sheets-toolbar"
    role="toolbar"
    aria-label="Spreadsheet formatting"
  >
    <MenuSearchPill />
    {insertAxis ? (
      <Tool label={insertAxis === "row" ? "Insert row below" : "Insert column right"} disabled={readOnly || !ready} onClick={() => onInsertAxis?.()}>
        <Plus size={16} />
      </Tool>
    ) : null}

    <Tool
      label="Undo (Cmd+Z)"
      disabled={readOnly}
      onClick={() => {
        if (!undoCollab.current()) void api.current?.undo();
      }}
    >
      <Undo2 size={16} />
    </Tool>
    <Tool
      label="Redo (Cmd+Y)"
      disabled={readOnly}
      onClick={() => {
        if (!redoCollab.current()) void api.current?.redo();
      }}
    >
      <Redo2 size={16} />
    </Tool>
    <Tool
      label="Print (Cmd+P)"
      onClick={() => {
        void printSheet.current().catch((e: unknown) =>
          onError(e instanceof Error ? e.message : String(e)),
        );
      }}
    >
      <Printer size={16} />
    </Tool>
    <Tool
      label="Audit"
      active={auditOpen}
      onClick={() => setAuditOpen((open) => !open)}
    >
      <span>Audit</span>
    </Tool>
    <Tool
      label="Cost"
      active={costOpen}
      onClick={() => setCostOpen((open) => !open)}
    >
      <Timer size={16} />
    </Tool>
    <Tool
      label="Accessibility"
      active={sheetAccessOpen}
      onClick={() => setSheetAccessOpen((open) => !open)}
    >
      <ListChecks size={16} />
    </Tool>
    <Tool
      label="Query"
      active={queryOpen}
      onClick={() => setQueryOpen((open) => !open)}
    >
      <Filter size={16} />
    </Tool>
    <Tool
      label="Goal Seek"
      active={goalOpen}
      onClick={() => setGoalOpen((open) => !open)}
    >
      <Target size={16} />
    </Tool>
    <Tool label="Paint format" disabled={readOnly} onClick={() => {}}>
      <PaintRoller size={16} />
    </Tool>

    <select
      className="toolbar-select zoom-select"
      aria-label="Zoom"
      value={zoom}
      onChange={(e) => handleZoom(e.target.value)}
    >
      <option value="50%">50%</option>
      <option value="75%">75%</option>
      <option value="90%">90%</option>
      <option value="100%">100%</option>
      <option value="125%">125%</option>
      <option value="150%">150%</option>
      <option value="200%">200%</option>
    </select>

    <span className="toolbar-divider" />

    <Tool label="Format as currency" disabled={readOnly} onClick={formatCurrency}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>$</span>
    </Tool>
    <Tool label="Format as percent" disabled={readOnly} onClick={formatPercent}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>%</span>
    </Tool>
    <Tool label="Decrease decimal places" disabled={readOnly} onClick={subtractDecimal}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>.0←</span>
    </Tool>
    <Tool label="Increase decimal places" disabled={readOnly} onClick={addDecimal}>
      <span style={{ fontSize: 12, fontWeight: 600 }}>.00→</span>
    </Tool>
    <details className="more-formats">
      <summary
        className="tool more-formats-btn"
        title="More formats"
        aria-label="More formats"
        aria-disabled={readOnly}
      >
        <span style={{ fontSize: 12, fontWeight: 600 }}>123</span>
        <ChevronDown size={11} />
      </summary>
      <div className="more-formats-menu analysis-list">
        {Object.entries(numberFormatsByGroup()).map(
          ([group, items]: [string, any[]]) => (
            <div key={group}>
              <div className={`more-formats-group ${group}`}>{group}</div>
              {items.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="more-formats-item"
                  title={f.code}
                  onClick={() => applyNamedFormatNow(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          ),
        )}
      </div>
    </details>

    <span className="toolbar-divider" />

    <Tool
      label="Insert comment (Cmd+Option+M)"
      disabled={readOnly}
      onClick={() =>
        void api.current?.executeCommand(
          "sheet.operation.show-comment-modal",
        )
      }
    >
      <MessageSquarePlus size={16} />
    </Tool>

    <button
      type="button"
      className="tool chart-btn"
      title="Insert chart"
      aria-label="Insert chart"
      disabled={!ready || readOnly}
      onClick={() => startPanel("chart")}
    >
      <BarChart3 size={16} />
    </button>

    <button
      type="button"
      className={`tool filter-btn ${book.current?.getActiveSheet()?.getFilter() ? "active" : ""}`}
      title={
        book.current?.getActiveSheet()?.getFilter()
          ? "Remove filter"
          : "Create a filter"
      }
      aria-label={
        book.current?.getActiveSheet()?.getFilter()
          ? "Remove filter"
          : "Create a filter"
      }
      aria-pressed={!!book.current?.getActiveSheet()?.getFilter()}
      disabled={!ready || readOnly}
      onClick={toggleFilter}
    >
      <Filter size={16} />
    </button>

    <button
      type="button"
      className="tool functions-btn"
      title="Functions"
      aria-label="Functions"
      disabled={readOnly}
      onClick={() => functions.autoSum()}
    >
      <span
        style={{
          fontFamily: "serif",
          fontStyle: "italic",
          fontWeight: "bold",
          fontSize: 14,
        }}
      >
        ∑
      </span>
      <ChevronDown size={10} />
    </button>

    <button
      type="button"
      className="tool pivot-btn"
      title="Pivot table"
      aria-label="Pivot table"
      disabled={!ready || readOnly}
      onClick={() => startPanel("pivot")}
    >
      <TableProperties size={16} />
    </button>
  </div>
  );
}

export function SheetFormatToolbar({
  readOnly,
  format,
  commands,
  links,
}: {
  readOnly: boolean;
  format: SheetTextFormat;
  commands: SheetFormatCommands;
  links: RefObject<SheetLinkHandle | null>;
}) {
  const { fontFamily, fontSize, isBold, isItalic, isStrike, textColor, fillColor } = format;
  const {
    handleFontFamily,
    handleFontSize,
    toggleBold,
    toggleItalic,
    toggleStrike,
    handleTextColor,
    handleFillColor,
    applyBorders,
    mergeCells,
    cycleHorizontalAlign,
    cycleVerticalAlign,
    toggleWrap,
  } = commands;
  return (
  <div
    className="sheets-toolbar sheets-format-toolbar"
    role="toolbar"
    aria-label="Text formatting"
  >
    <FontControls disabled={readOnly}>
    <select
      className="toolbar-select font-family-select"
      aria-label="Font family"
      disabled={readOnly}
      value={fontFamily}
      onChange={(e) => handleFontFamily(e.target.value)}
    >
      {!SHEET_FONTS.includes(fontFamily) ? <option value={fontFamily}>{fontFamily}</option> : null}
      {SHEET_FONTS.map((font) => (
        <option key={font} value={font}>
          {font}
        </option>
      ))}
    </select>

    <span className="toolbar-divider" />

    <div className="font-size-stepper">
      <button
        type="button"
        className="stepper-btn"
        title="Decrease font size"
        aria-label="Decrease font size"
        disabled={readOnly}
        onClick={() => handleFontSize(Math.max(6, fontSize - 1))}
      >
        <Minus size={12} />
      </button>
      <input
        className="font-size-input"
        aria-label="Font size"
        disabled={readOnly}
        value={fontSize}
        onChange={(e) => handleFontSize(Number(e.target.value) || 10)}
      />
      <button
        type="button"
        className="stepper-btn"
        title="Increase font size"
        aria-label="Increase font size"
        disabled={readOnly}
        onClick={() => handleFontSize(Math.min(72, fontSize + 1))}
      >
        <Plus size={12} />
      </button>
    </div>
    </FontControls>

    <span className="toolbar-divider" />

    <Tool label="Bold (Cmd+B)" disabled={readOnly} active={isBold} onClick={toggleBold}>
      <Bold size={16} />
    </Tool>
    <Tool label="Italic (Cmd+I)" disabled={readOnly} active={isItalic} onClick={toggleItalic}>
      <Italic size={16} />
    </Tool>
    <Tool
      label="Strikethrough (Alt+Shift+5)"
      disabled={readOnly}
      active={isStrike}
      onClick={toggleStrike}
    >
      <Strikethrough size={16} />
    </Tool>
    <ColorTool
      label="Text color"
      value={textColor}
      disabled={readOnly}
      onCommit={handleTextColor}
    >
      <span className="text-color-letter">A</span>
    </ColorTool>
    <ColorTool
      label="Fill color"
      value={fillColor}
      disabled={readOnly}
      onCommit={handleFillColor}
    >
      <PaintBucket size={16} />
    </ColorTool>

    <button
      type="button"
      className="tool borders-btn"
      title="Borders"
      aria-label="Borders"
      disabled={readOnly}
      onClick={applyBorders}
    >
      <Grid size={16} />
      <ChevronDown size={10} />
    </button>

    <button
      type="button"
      className="tool merge-btn"
      title="Merge cells"
      aria-label="Merge cells"
      disabled={readOnly}
      onClick={mergeCells}
    >
      <Split size={16} />
      <ChevronDown size={10} />
    </button>

    <span className="toolbar-divider" />

    <button
      type="button"
      className="tool align-btn"
      title="Horizontal align"
      aria-label="Horizontal align"
      disabled={readOnly}
      onClick={cycleHorizontalAlign}
    >
      <AlignLeft size={16} />
      <ChevronDown size={10} />
    </button>

    <button
      type="button"
      className="tool valign-btn"
      title="Vertical align"
      aria-label="Vertical align"
      disabled={readOnly}
      onClick={cycleVerticalAlign}
    >
      <AlignVerticalSpaceAround size={16} />
      <ChevronDown size={10} />
    </button>

    <button
      type="button"
      className="tool wrap-btn"
      title="Text wrapping"
      aria-label="Text wrapping"
      disabled={readOnly}
      onClick={toggleWrap}
    >
      <WrapText size={16} />
      <ChevronDown size={10} />
    </button>

    <span className="toolbar-divider" />

    <Tool
      label="Insert link (Cmd+K)"
      disabled={readOnly}
      onClick={() => links.current?.open()}
    >
      <Link size={16} />
    </Tool>
  </div>
  );
}
