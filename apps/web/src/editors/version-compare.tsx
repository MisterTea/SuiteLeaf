import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import {
  diffDocuments,
  diffSheets,
  diffSlides,
  type CellLook,
  type DocFile,
  type JsonNode,
  type SheetCellChange,
  type SheetDiff,
  type SheetDiffSheet,
  type SlideDiff,
  type SlideDiffElement,
  type SlideDiffFrame,
  type SuiteFile,
} from "@suiteleaf/core";
import {
  changeSentence,
  type ChangeUnit,
} from "./version-history-model";

/** Stable id for the first tab, whose body is `content` and whose name is `tabTitle`. */
export const FIRST_DOC_TAB = "first";

export type DocCompareTab = {
  id: string;
  title: string;
  status: "same" | "changed" | "added" | "removed";
  content: JsonNode;
  changedParagraphs: number;
  /** Set on the first tab while comparing with the current version. */
  offers?: ({ key: string; prompt: string } | null)[] | null;
};

export type HistoryPreview =
  | {
      kind: "doc";
      /** First-tab diff. A one-tab document uses only this. */
      content: JsonNode;
      label: string;
      /** Set while comparing a document with the current version, so one paragraph can be restored. */
      offers?: ({ key: string; prompt: string } | null)[] | null;
      /** Present when the document has more than one tab, so the preview can switch. */
      tabs?: DocCompareTab[];
    }
  | { kind: "sheet"; diff: SheetDiff; label: string }
  | { kind: "slide"; diff: SlideDiff; label: string };

const DOC_CURRENT =
  "Comparing with the current version · read-only. Green underline was added later. Red strikethrough was removed.";
const DOC_PREVIOUS =
  "Changes in this version · read-only. Green underline was added here. Red strikethrough was removed.";
const EARLIEST =
  "This is the earliest version, so there is nothing before it to compare. Read-only.";

function labelFor(
  count: number,
  unit: ChangeUnit,
  mode: "current" | "previous" | "earliest",
) {
  if (mode === "earliest") return EARLIEST;
  if (unit === "paragraph") return mode === "previous" ? DOC_PREVIOUS : DOC_CURRENT;
  const sentence = changeSentence(count, unit);
  if (mode === "previous")
    return `${sentence} in this version · read-only. Green was added here. Red was removed.`;
  const format =
    unit === "cell" ? " Format-only changes are marked." : " Deleted slides stay in the filmstrip.";
  return `${sentence} · comparing with the current version · read-only. Green was added later. Red was removed.${format}`;
}

function summaryFor(
  count: number,
  unit: ChangeUnit,
  mode: "current" | "previous" | "earliest",
) {
  if (unit === "paragraph") return "";
  if (mode === "earliest") return "Nothing earlier to compare";
  const sentence = changeSentence(count, unit);
  return mode === "previous" ? `${sentence} in this version` : sentence;
}

const emptyDoc: JsonNode = { type: "doc", content: [] };

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** Names the tabs whose paragraphs changed. One tab: "1 paragraph changes on Minutes". */
export function documentChangeSummary(tabs: DocCompareTab[]): string {
  const textual = tabs.filter((tab) => tab.changedParagraphs > 0);
  const structural = tabs.filter(
    (tab) =>
      tab.changedParagraphs === 0 &&
      (tab.status === "added" || tab.status === "removed"),
  );
  const parts: string[] = [];
  if (textual.length === 1) {
    parts.push(`${changeSentence(textual[0].changedParagraphs)} on ${textual[0].title}`);
  } else if (textual.length > 1) {
    const total = textual.reduce((sum, tab) => sum + tab.changedParagraphs, 0);
    parts.push(`${changeSentence(total)} on ${joinNames(textual.map((tab) => tab.title))}`);
  }
  for (const tab of structural) {
    parts.push(tab.status === "added" ? `${tab.title} was added` : `${tab.title} was removed`);
  }
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]}, and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function docSides(file: DocFile) {
  return [
    {
      id: FIRST_DOC_TAB,
      title: file.tabTitle?.trim() || "Document",
      content: file.content,
    },
    ...(file.tabs ?? []).map((tab) => ({
      id: tab.id,
      title: tab.title,
      content: tab.content,
    })),
  ];
}

function markedTab(
  id: string,
  title: string,
  status: DocCompareTab["status"],
  before: JsonNode,
  after: JsonNode,
): DocCompareTab {
  const diff = diffDocuments(before, after);
  const changed = status === "same" && diff.changedParagraphs > 0 ? "changed" : status;
  return {
    id,
    title,
    status: changed,
    content: diff.content,
    changedParagraphs: diff.changedParagraphs,
  };
}

/**
 * Pair every tab. The first tab is always `content`. Later tabs match by id:
 * only in the newer file is added, only in the older file is removed.
 */
function alignDocTabs(
  before: DocFile,
  after: DocFile,
  mode: "current" | "previous" | "earliest",
): DocCompareTab[] {
  const older = docSides(before);
  const newer = docSides(after);
  if (mode === "earliest") {
    return older.map((tab) => ({
      id: tab.id,
      title: tab.title,
      status: "same" as const,
      content: tab.content,
      changedParagraphs: 0,
    }));
  }
  const olderById = new Map(older.slice(1).map((tab) => [tab.id, tab]));
  const tabs: DocCompareTab[] = [
    markedTab(FIRST_DOC_TAB, newer[0].title, "same", older[0].content, newer[0].content),
  ];
  const seen = new Set<string>();
  for (const tab of newer.slice(1)) {
    seen.add(tab.id);
    const prev = olderById.get(tab.id);
    tabs.push(
      prev
        ? markedTab(tab.id, tab.title, "same", prev.content, tab.content)
        : markedTab(tab.id, tab.title, "added", emptyDoc, tab.content),
    );
  }
  for (const tab of older.slice(1)) {
    if (seen.has(tab.id)) continue;
    tabs.push(markedTab(tab.id, tab.title, "removed", tab.content, emptyDoc));
  }
  return tabs;
}

/** Build the read-only preview for one pair of snapshots. Kinds must match. */
export function historyPreviewFor(
  before: SuiteFile,
  after: SuiteFile,
  mode: "current" | "previous" | "earliest",
): { preview: HistoryPreview; summary: string; count: number; unit: ChangeUnit } | null {
  if (before.kind !== after.kind) return null;
  if (before.kind === "doc" && after.kind === "doc") {
    const tabs = alignDocTabs(before, after, mode);
    const count = mode === "earliest" ? 0 : tabs.reduce((sum, tab) => sum + tab.changedParagraphs, 0);
    const multi = tabs.length > 1;
    return {
      preview: {
        kind: "doc",
        content: tabs[0]?.content ?? before.content,
        label: labelFor(count, "paragraph", mode),
        tabs: multi ? tabs : undefined,
      },
      summary: multi && mode !== "earliest" ? documentChangeSummary(tabs) : "",
      count,
      unit: "paragraph",
    };
  }
  if (before.kind === "sheet" && after.kind === "sheet") {
    const newer = mode === "earliest" ? before : after;
    const diff = diffSheets(before.content.workbook, newer.content.workbook);
    return {
      preview: { kind: "sheet", diff, label: labelFor(diff.changedCells, "cell", mode) },
      summary: summaryFor(diff.changedCells, "cell", mode),
      count: diff.changedCells,
      unit: "cell",
    };
  }
  if (before.kind === "slide" && after.kind === "slide") {
    const newer = mode === "earliest" ? before : after;
    const diff = diffSlides(before.content, newer.content);
    return {
      preview: { kind: "slide", diff, label: labelFor(diff.changedSlides, "slide", mode) },
      summary: summaryFor(diff.changedSlides, "slide", mode),
      count: diff.changedSlides,
      unit: "slide",
    };
  }
  return null;
}

function stopEditing(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") return;
  const scroll = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab", "Escape", "PageUp", "PageDown", "Home", "End"];
  if (!scroll.includes(event.key)) event.preventDefault();
}

function ReadOnlySurface({
  className,
  label,
  children,
}: {
  className: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`version-preview ${className}`}
      aria-label="Version preview"
      aria-readonly="true"
      tabIndex={0}
      onKeyDown={stopEditing}
      onBeforeInput={(event) => event.preventDefault()}
      onPaste={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
      <p className="version-preview-banner">{label}</p>
      {children}
    </div>
  );
}

function columnName(index: number) {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function lookStyle(look: CellLook): CSSProperties {
  return {
    fontWeight: look.bold ? 700 : 400,
    fontStyle: look.italic ? "italic" : "normal",
    textDecoration:
      [look.underline ? "underline" : "", look.strike ? "line-through" : ""]
        .filter(Boolean)
        .join(" ") || undefined,
  };
}

function cellLabel(change: SheetCellChange) {
  const where = `${columnName(change.column)}${change.row + 1}`;
  if (change.kind === "format")
    return `${where} format ${change.notes.join(", ") || "changed"}`;
  const from = change.beforeText || "empty";
  const to = change.afterText || "empty";
  const format = change.notes.length ? `, ${change.notes.join(", ")}` : "";
  return `${where} was ${from}, now ${to}${format}`;
}

function SheetGrid({ sheet }: { sheet: SheetDiffSheet }) {
  const changes = new Map(sheet.changes.map((change) => [`${change.row},${change.column}`, change]));
  const plain = new Map(sheet.plain.map((cell) => [`${cell.row},${cell.column}`, cell.look]));
  return (
    <div className="sheet-compare-wrap">
      <table className="sheet-compare" aria-label="Spreadsheet compare">
        <thead>
          <tr>
            <th className="row-num" />
            {Array.from({ length: sheet.columns }, (_, column) => (
              <th key={column}>{columnName(column)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: sheet.rows }, (_, row) => (
            <tr key={row}>
              <th className="row-num">{row + 1}</th>
              {Array.from({ length: sheet.columns }, (_, column) => {
                const change = changes.get(`${row},${column}`);
                const look = change?.after ?? plain.get(`${row},${column}`);
                const kind = change?.kind ?? "same";
                return (
                  <td
                    key={column}
                    data-change={kind}
                    data-row={row}
                    data-col={column}
                    className={kind === "same" ? undefined : `changed-${kind}`}
                    aria-label={change ? cellLabel(change) : undefined}
                    style={kind === "format" || kind === "both" ? undefined : look?.fill ? { background: look.fill } : undefined}
                  >
                    {change && change.kind !== "format" ? (
                      <>
                        {change.beforeText ? (
                          <span className="sheet-compare-old" style={lookStyle(change.before)}>
                            <s>{change.beforeText}</s>
                          </span>
                        ) : null}
                        {change.afterText ? (
                          <span className="sheet-compare-new" style={lookStyle(change.after)}>
                            <u>{change.afterText}</u>
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="sheet-compare-value" style={look ? lookStyle(look) : undefined}>
                        {look?.text || (change ? "" : "")}
                      </span>
                    )}
                    {change?.notes.map((note) => (
                      <span key={note} className="sheet-compare-badge">
                        {note}
                      </span>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SheetVersionPreview({ diff, label }: { diff: SheetDiff; label: string }) {
  const first = diff.sheets.find((sheet) => sheet.status !== "same")?.id ?? diff.sheets[0]?.id ?? "";
  const [picked, setPicked] = useState(first);
  const sheet = diff.sheets.find((item) => item.id === picked) ?? diff.sheets[0];
  return (
    <ReadOnlySurface className="sheet-version-preview" label={label}>
      <ul className="compare-legend">
        <li><u>Added</u></li>
        <li><s>Removed</s></li>
        <li><span className="sheet-compare-badge">Format</span></li>
      </ul>
      {sheet ? <SheetGrid sheet={sheet} /> : <p className="compare-empty">This spreadsheet has no cells to compare.</p>}
      {diff.sheets.length > 1 ? (
        <div className="sheet-compare-tabs" role="tablist" aria-label="Worksheets">
          {diff.sheets.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === sheet?.id}
              onClick={() => setPicked(item.id)}
            >
              {item.name}
              {item.status === "removed" ? " · deleted" : item.status === "added" ? " · added" : ""}
            </button>
          ))}
        </div>
      ) : sheet ? (
        <p className="sheet-compare-tab">{sheet.name}</p>
      ) : null}
    </ReadOnlySurface>
  );
}

function percent(value: number, total: number) {
  return `${(value / total) * 100}%`;
}

function SlideElementView({
  el,
  width,
  height,
  removedSlide,
}: {
  el: SlideDiffElement;
  width: number;
  height: number;
  removedSlide: boolean;
}) {
  const box: CSSProperties = {
    left: percent(el.x, width),
    top: percent(el.y, height),
    width: percent(el.width, width),
    height: percent(el.height, height),
  };
  if (el.type === "shape") {
    return (
      <div
        key={el.id}
        className="slide-compare-shape"
        style={{
          ...box,
          background: el.fill || "transparent",
          borderRadius: el.shapeType === "ellipse" ? "50%" : el.shapeType === "roundRect" ? "12px" : 0,
        }}
      />
    );
  }
  if (el.type === "image" && el.src && /^(data:image\/|https?:)/i.test(el.src)) {
    return <img className="slide-compare-image" alt={el.alt || ""} src={el.src} style={box} />;
  }
  if (el.type === "table" && el.rows) {
    return (
      <table className="slide-compare-table" style={box}>
        <tbody>
          {el.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (el.type !== "text" || (!el.runs.length && !el.notes.length)) return null;
  const font = el.fontSize ? `${(el.fontSize / width) * 100}cqw` : `${(20 / width) * 100}cqw`;
  return (
    <div
      className={`slide-compare-text${el.status === "removed" ? " is-removed" : ""}`}
      style={{
        ...box,
        fontSize: font,
        fontWeight: el.bold ? 700 : 500,
        fontStyle: el.italic ? "italic" : "normal",
        color: removedSlide ? "#c5221f" : el.color || "#1e293b",
        textAlign: (el.align as CSSProperties["textAlign"]) || "left",
      }}
    >
      {el.runs.map((run, index) => {
        const broken = index > 0 && el.runs[index - 1].mark === "del" && run.mark === "add";
        const body =
          run.mark === "del" ? (
            <s key={index}>{run.text}</s>
          ) : run.mark === "add" ? (
            <u key={index}>{run.text}</u>
          ) : (
            <span key={index}>{run.text}</span>
          );
        return broken ? (
          <span key={index}>
            <br />
            {body}
          </span>
        ) : (
          body
        );
      })}
      {el.notes.map((note) => (
        <span key={note} className="sheet-compare-badge">
          {note}
        </span>
      ))}
    </div>
  );
}

function SlideFrame({
  slide,
  width,
  height,
}: {
  slide: SlideDiffFrame;
  width: number;
  height: number;
}) {
  const removed = slide.status === "removed";
  return (
    <div
      className={`slide-compare-frame is-${slide.status}`}
      style={{ background: removed ? "#fff" : slide.background, aspectRatio: `${width} / ${height}` }}
    >
      {removed ? <div className="slide-compare-wash" /> : null}
      {slide.elements.map((el) => (
        <SlideElementView
          key={el.id}
          el={el}
          width={width}
          height={height}
          removedSlide={removed}
        />
      ))}
      {slide.status === "removed" ? <span className="slide-compare-flag">Deleted</span> : null}
      {slide.status === "added" ? <span className="slide-compare-flag add">Added</span> : null}
    </div>
  );
}

export function SlideVersionPreview({ diff, label }: { diff: SlideDiff; label: string }) {
  const first = diff.slides.find((slide) => slide.status !== "same")?.id ?? diff.slides[0]?.id ?? "";
  const [picked, setPicked] = useState<string | null>(null);
  const slide =
    diff.slides.find((item) => item.id === picked) ??
    diff.slides.find((item) => item.id === first) ??
    diff.slides[0];
  return (
    <ReadOnlySurface className="slide-version-preview" label={label}>
      <ul className="compare-legend">
        <li><u>Added</u></li>
        <li><s>Removed</s></li>
      </ul>
      <div className="slide-compare">
        <div className="slide-compare-strip" aria-label="Slides">
          {diff.slides.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`slide-thumb${item.id === slide?.id ? " selected" : ""} is-${item.status}`}
              aria-pressed={item.id === slide?.id}
              aria-label={
                item.status === "removed"
                  ? `${item.title}, deleted slide`
                  : item.status === "added"
                    ? `${item.title}, added slide`
                    : item.status === "changed"
                      ? `${item.title}, changed slide`
                      : item.title
              }
              onClick={() => setPicked(item.id)}
            >
              <span className="slide-thumb-canvas" style={{ background: item.status === "removed" ? "#fff5f5" : item.background }}>
                <span className="slide-thumb-title">{item.title}</span>
              </span>
              {item.status === "removed" ? <span className="slide-thumb-flag">Deleted</span> : null}
              {item.status === "added" ? <span className="slide-thumb-flag add">Added</span> : null}
              {item.status === "changed" ? <span className="slide-thumb-flag chg">Changed</span> : null}
            </button>
          ))}
        </div>
        <div className="slide-compare-stage">
          {slide ? (
            <SlideFrame slide={slide} width={diff.width} height={diff.height} />
          ) : (
            <p className="compare-empty">This presentation has no slides to compare.</p>
          )}
        </div>
      </div>
    </ReadOnlySurface>
  );
}
