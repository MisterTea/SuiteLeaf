import type { SuiteFile } from "./file-schema";
import { packSharedMedia, unpackSharedMedia } from "./shared-media";
import type { SourceRange } from "./sheet-schema";
import { z } from "zod";

export { packSharedMedia, unpackSharedMedia };

export { diffDocuments, type DocDiff } from "./doc-diff";
export { cloneJson, sameJson } from "./json-data";
export { slugify } from "./heading-anchors";
export { fontKerning, kernFeature, kerningThreshold } from "./kerning";
export { officeSingleSpacing, paintFontFamily, suiteLeafFont } from "./office-fonts";
export { lineMarkerEnds, readLineEnd, type LineEndType, type LineMarker } from "./pptx-line-ends";
export { dashMultipliers } from "./pptx-line-dash";
export {
  applyParagraphRestore,
  compareParagraphs,
  paragraphRestorePrompt,
  type ParagraphCompare,
  type ParagraphOffer,
} from "./doc-paragraph-restore";
export {
  diffSheets,
  type CellLook,
  type SheetCellChange,
  type SheetDiff,
  type SheetDiffSheet,
  type SheetPlainCell,
} from "./sheet-diff";
export {
  diffSlides,
  type SlideDiff,
  type SlideDiffElement,
  type SlideDiffFrame,
  type SlideTextRun,
} from "./slide-diff";
export {
  DRAWING_FORMATS,
  DRAWING_SOURCE_CHARS,
  DRAWING_STARTERS,
  drawingContentSchema,
  fileSchema,
  type DocFile,
  type DocTab,
  type DrawingContent,
  type DrawingFile,
  type DrawingFormat,
  type FormFile,
  type JsonNode,
  type Kind,
  type SheetFile,
  type SlideFile,
  type SuiteFile,
} from "./file-schema";
export {
  chartSchema,
  pivotSchema,
  rangeSchema,
  type ChartDefinition,
  type PivotDefinition,
  type SourceRange,
} from "./sheet-schema";
export {
  embeddedFontSchema,
  presentationSchema,
  slideCommentMessageSchema,
  slideCommentThreadSchema,
  slideElementSchema,
  slideSchema,
  slideThemeSchema,
  slideTransitionSchema,
  textRunSchema,
  type EmbeddedFont,
  type Presentation,
  type Slide,
  type SlideCommentMessage,
  type SlideCommentThread,
  type SlideElement,
  type SlideTheme,
  type SlideTransition,
  type TextRun,
} from "./slide-schema";
export {
  VERSION_PAUSE_MS,
  VERSION_PAUSE_KEY,
  VERSION_SNAPSHOT_CAP,
  OP_BYTE_CAP,
  applyParagraphTexts,
  blockTexts,
  changeExcerpt,
  changedRegions,
  compactSession,
  nameVersion,
  recordEdit,
  restoreToVersion,
  sealIfIdle,
  slideOp,
  summarizeChange,
  summaryPrompt,
  trimVersions,
  versionPauseMs,
  type Collaborator,
  type RegionTouch,
  type StoredEdit,
  type StoredVersion,
  type TrackedFile,
} from "./history";
export {
  DocumentRoom,
  canJoinRoom,
  connectDocs,
  editParagraph,
  paragraphTexts,
  paragraphsAsDocument,
  prosemirrorJson,
  commentThreadsFromRoom,
  reviewFromRoom,
  syncReview,
  roomAlreadyHasText,
  seedParagraphs,
  syncCommentThreads,
  syncParagraphTexts,
  type CollabJoin,
  type CollabRole,
} from "./collab";
export { linkTarget, safeLink } from "./link-target";
export { checkDocument, contentPosition, nodeAtPath, type A11yFinding, type A11yRule } from "./a11y-check";
export { checkSheetGrid, formulaErrorNotes, type FormulaErrorFinding, type SheetA11yFinding, type SheetA11yGrid } from "./sheet-a11y";
export { inspectSheetCost, volatileFormulaAddresses, type SheetCostInput, type SheetCostReport, type SheetCostStop } from "./sheet-cost";
export {
  INTERACTIVE_CELL_LIMIT,
  LARGE_CELL_LIMIT,
  capacityDecision,
  countStoredCells,
  phasesBlockedByCapacity,
  startWorkbookWork,
  type CapacityDecision,
} from "./sheet-capacity";
export { auditFormula, cellAddress, nextFormulaError, type FormulaAudit } from "./sheet-audit";
export { evaluationTrace, type EvaluationTrace } from "./sheet-trace";
export { cellsToRecalculate, recalculateDirty, structuredSource, type Invalidation, type Recalculation, type StructuredSource } from "./sheet-invalidation";
export { recalculateAcrossSheets, type CrossRecalculation, type NamedCells } from "./sheet-cross-calc";
export { excelChartElement, waterfallBarLabel, waterfallRows, waterfallSkipText, waterfallSteps, type WaterfallResult, type WaterfallStep } from "./waterfall";
export { histogramBins, histogramColumn, histogramSkipText, type HistogramBin, type HistogramResult } from "./histogram";
export { assignComboAxes, chartSummary, seriesFromHeaders, type ChartSummaryInput } from "./chart-summary";
export { queryDocument, remapQuery, reviewQuerySchema, schemaNoteText, refreshDatabaseQuery, refreshGridQuery, refreshIsDue, refreshQuery, refreshRemoteQuery, runScheduledRefresh, sourceUrlProblem, tableFromGrid, writeQueryOutput, type QueryDocument, type QueryGrid, type QueryPlacement, type QueryRow, type QueryRun, type QuerySchedule, type QueryStep } from "./sheet-query";
export { localTableBlocked, localTableValues, refreshLocalQuery, rowsFromCsv, rowsFromJson } from "./sheet-query-local";
export { goalSeek, goalSeekAsync, seekProgressText, writeGoalSeek, type GoalSeekInput, type GoalSeekResult } from "./goal-seek";
export { solve, solveAsync, writeSolver, type SolverResult, type SolverVariable } from "./solver";
export { drillGroupRows, drillPivot, groupedKey, pivotSliceFromForm, slicePivot, type PivotSlice } from "./pivot-slicer";
export { pivotSortChoice, pivotSortFromForm, type PivotSort } from "./pivot-sort";
export { deleteTableCells, deleteTableRows, editsFromRangeValues, expandStructuredFormula, extendTablesForEdits, growSources, growTable, insertTableCells, insertTableRows, shrinkTable, structuredFormulaNote, tableAfterStructure, tableColumn, tableOutline, tableRangeLabel, type SheetTable, type TableCellEdit, type TableRange } from "./sheet-table";
export { benchmarkRegression, expensiveFormulas, formulaRefs, importKeepingSaved, runCancellable, slowestPhaseNote, type BenchmarkRecord, type FormulaCost } from "./sheet-benchmark";
export {
  applyCharacterStyles,
  characterStyleList,
  applyStyleFormats,
  captionReference,
  captionWarnings,
  effectiveFormat,
  importCharacterStyles,
  importParagraphStyles,
  numberCaptions,
  paragraphStyles,
  refreshCaptions,
  refreshHeadingRefs,
  styledDocument,
  assignParagraphStyle,
  stylePatchFromMarks,
  updateNamedStyle,
  type Caption,
  type CharacterStyle,
  type StyleDef,
} from "./doc-styles";
export { documentProperties, undoDocument, type DocumentProperties } from "./doc-properties";
export { refreshContents, refreshReport } from "./doc-contents";
export { applyMaster, contrastRatio, editSlideObject, mediaCaptionNotes, mediaPictureNotes, moveReadingOrder, readingOrder, slideAccessNotes, slideAccessWrites, slideChecks, slideObjectLines, tableFieldRows, tableFieldText, titleTextColor, type SlidePiece, type TitleColorBox } from "./slide-access";
export { alignObjectToSlide, alignSelection, alignSlideObjects, distributeSlideObjects, groupSlideObjects, nudgeSlideObject, nudgeSlideSelection, orderSlideObjects, placeSlideGroup, placeSlideObject, readSlideGeometry, snapSlideBox, ungroupSlideObjects, type AlignEdge, type NudgeDirection, type SlideBox, type SlideGeometry, type SlideSnap } from "./slide-align";
export { mergeDocumentBlocks, type BlockMerge, type KeptVersions } from "./conflict-merge";
export {
  COST_CATEGORIES,
  SOFTWARE_EDITION,
  SUPPORTED_FEATURES,
  cancelHostedService,
  hostedHold,
  applyExpansion,
  declineEffect,
  expansionWarning,
  storageBudgetNotice,
  featuresOn,
  type UsageChoice,
  localEditingRequiresBilling,
  type CostCategory,
} from "./packaging";
export {
  cellHyperlink,
  cellLabel,
  linkDocument,
  linkedCell,
  removedLinkWarning,
  takeExcelHyperlink,
} from "./sheet-links";
export {
  LEGACY_EXTENSION,
  NATIVE_EXTENSIONS,
  NATIVE_FILE_LIMIT,
  createFile,
  duplicateFile,
  extensionFor,
  filename,
  isNativeName,
  kindFromName,
  mimeFor,
  nativeFilename,
  parseFile,
  parseNamedFile,
  serializeFile,
  utf8LongerThan,
} from "./native-file";
export { parsePowerPoint } from "./pptx";
export { lineFrame, slidePointScale } from "./pptx-geometry";
export { paragraphTabStops, tabAdvance, type TabStop } from "./pptx-tab-stops";
export { plainWordArt, wordArtFill, wordArtFrame, type GlyphInk } from "./pptx-word-art";
export { officeGradient, straightGradientBackground, svgFillMarkup } from "./pptx-theme";
/** Where a file lives in SuiteDrive. `versionId` is the head version this
 * copy was loaded from or last saved as, and `syncedAt` is the file's
 * `updatedAt` at that moment. */
export interface DriveLink {
  nodeUrl: string;
  itemId: string;
  versionId?: string;
  syncedAt?: string;
  name: string;
}
export const driveLinkSchema = z.object({
  nodeUrl: z.string().url(),
  itemId: z.string().min(1),
  versionId: z.string().optional(),
  syncedAt: z.string().optional(),
  name: z.string().min(1).max(255),
});
export interface FileRecord {
  file: SuiteFile;
  path?: string;
  fingerprint?: string;
  recovery?: boolean;
  drive?: DriveLink;
  /** Saved on the library entry so starring and Trash never rewrite the native file. */
  starred?: boolean;
  /** When the file was moved to Trash. Absent means it is not in Trash. */
  trashedAt?: string;
}
export {
  applyLibraryMarks,
  readLibraryMarks,
  type LibraryMarks,
} from "./library-marks";
/** Whether a SuiteDrive file has local edits that were never uploaded. */
export function hasUnsyncedEdits(record: FileRecord) {
  return !!record.drive && record.drive.syncedAt !== record.file.updatedAt;
}
export interface StorageAdapter {
  list(): Promise<FileRecord[]>;
  get(id: string): Promise<FileRecord | undefined>;
  save(record: FileRecord): Promise<FileRecord>;
  remove(id: string): Promise<void>;
  open(): Promise<FileRecord | null>;
  saveAs(record: FileRecord): Promise<FileRecord | null>;
  reload(id: string): Promise<FileRecord | undefined>;
}
export interface DesktopBridge {
  getDocumentsDirectory?(): Promise<string>;
  chooseDocumentsDirectory?(): Promise<string | null>;
  onFilesChanged?(callback: () => void): () => void;
  /**
   * Folders inside the documents folder. A folder is a "/"-separated path
   * relative to it, and "" is the documents folder itself. Each call changes
   * the folders on disk, and resolves with the folder's new path.
   */
  listFolders?(): Promise<string[]>;
  createFolder?(parent: string, name: string): Promise<string>;
  renameFolder?(folder: string, name: string): Promise<string>;
  moveFolder?(folder: string, parent: string): Promise<string>;
  /** Move a file into a folder on disk. A file not saved to disk yet is written there. */
  moveFile?(id: string, folder: string): Promise<FileRecord>;
  /** The on-device model host (Gemma via llama.cpp in the main process). */
  ai?: import("./ai").AiBridge;
  list(): Promise<FileRecord[]>;
  get(id: string): Promise<FileRecord | undefined>;
  save(record: FileRecord): Promise<FileRecord>;
  remove(id: string): Promise<void>;
  open(): Promise<FileRecord | null>;
  saveAs(record: FileRecord): Promise<FileRecord | null>;
  reload(id: string): Promise<FileRecord | undefined>;
  /** Where the person saved the export, or null if they cancelled the dialog. */
  exportFile(
    name: string,
    content: string | Uint8Array,
  ): Promise<string | null>;
  /**
   * Write the presentation as Slide1.png, Slide2.png, and so on.
   * Resolves with the folder, or null if the person cancels.
   */
  exportSlidesPng?(json: string): Promise<string | null>;
  print(title?: string): Promise<void>;
  onMenu(callback: (action: string) => void): () => void;
  setDirty(dirty: boolean): void;
  getMode?(): Promise<AppMode>;
  /** Persist the mode and reload the app in it. */
  setMode?(mode: AppMode): Promise<void>;
  /** Run a social sign-in hand-off in a separate window and resolve with
   * the one-time token it returns. */
  authWindow?(startUrl: string): Promise<string | null>;
}
/**
 * `single`: not connected to a server. In the desktop app this is single-node
 * mode (files on disk, assistant in the desktop process). The public demo is
 * serverless mode: the same `single` value, locked by `VITE_SUITELEAF_DEMO`, with
 * files in the browser and the assistant on WebGPU. A static web app is
 * `single` until it connects, and uses that same browser storage and assistant.
 * `cluster`: the app is a client of a SuiteLeaf server; people sign in and
 * files live in SuiteDrive, replicated across the cluster's servers.
 */
export type AppMode =
  { kind: "single" } | { kind: "cluster"; serverUrl: string };
export const appModeSchema: z.ZodType<AppMode> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("single") }),
  z.object({
    kind: z.literal("cluster"),
    serverUrl: z.string().regex(/^https?:\/\/[^\s/]+(\/[^\s]*)?$/),
  }),
]);
export function columnName(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function rangeLabel(r: SourceRange) {
  return `${columnName(r.startColumn)}${r.startRow + 1}:${columnName(r.endColumn)}${r.endRow + 1}`;
}
export function parseRange(a1: string, sheetId: string): SourceRange {
  const m = /^\$?([A-Z]+)\$?([1-9]\d*)(?::\$?([A-Z]+)\$?([1-9]\d*))?$/i.exec(
    a1.trim(),
  );
  if (!m) throw new Error("Use a cell range such as A1:D20.");
  const col = (s: string) =>
    [...s.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const r = {
    sheetId,
    startRow: +m[2] - 1,
    endRow: +(m[4] ?? m[2]) - 1,
    startColumn: col(m[1]),
    endColumn: col(m[3] ?? m[1]),
  };
  if (
    r.endRow < r.startRow ||
    r.endColumn < r.startColumn ||
    (r.endRow - r.startRow + 1) * (r.endColumn - r.startColumn + 1) > 200000
  )
    throw new Error("Choose an ordered range of at most 200,000 cells.");
  return r;
}

export { departureChecklist, type DepartureItem } from "./capabilities/departure";
export { presentationLineHeight, presentationSingleSpacing } from "./pptx-line-spacing";
export {
  COMPAT_CONVERTER_VERSION,
  COMPAT_EVIDENCE_CORPUS,
  type CompatibilitySeverity,
  type CompatibilityImpact,
  type AffectedLocation,
  type CompatibilityFinding,
  type CompatibilityReport,
  type ExportChoice,
  type PreservedPart,
  type PreservedPartsManifest,
  createCompatibilityReport,
  analyzeFontCompatibility,
  scanDocCompatibility,
  scanSheetCompatibility,
  scanSlideCompatibility,
  preserveUnsupportedParts,
  resolveExportChoice,
  formatCompatibilityReportMarkdown,
  formatCompatibilityReportTerminal,
  formatCompatibilityReportJson,
} from "./compat/user-report";

export * from "./offline";
export * from "./provisioning";
export * from "./search";
export type { PermissionChecker } from "./search";
export * from "./workflows";
export * from "./migration";
export * from "./operations";
export * from "./templates";
export * from "./automation";
export * from "./governance";
export * from "./integrations/communications";
export * from "./integrations/knowledge-planning";
export { latexMathML, officeMathLatex, unwrapSlideLatex } from "./slide-latex";
