# Workflows, Tutorials & Expected Behavior

This document is built up from the manuals in `docs/` — the project's own
documentation plus the external Google Workspace reference books that guide
workflow selection. As each manual is read, a section is appended below with the
workflows/tutorials it describes and the **expected behavior** (what a user or a
test should observe). It is a catalog of observable, checkable behaviors, not a
claim that SuiteLeaf reproduces every feature of the reference books or of
Google's products.

Reference books in `docs/` and `research/` are local, gitignored, and excluded
from application and installer bundles. They inform workflow *selection*; the
implementation uses independent code and original sample content.

---

## Source manuals read

| Manual | Content |
| --- | --- |
| `README.md` | Capabilities, run/local setup, save + portability, exports, limits, build/host, checks |
| `docs/workflows.md` | Reference-workflow → v1 coverage mapping; acceptance scenarios 1–5 |
| `docs/architecture.md` | File envelope, storage & save ordering, editors/analysis, desktop, Office conversion |
| `docs/office-imports.md` | DOCX/Excel import limits, failure classes, corpus validation |
| `docs/sheets-workflow-validation.md` | Budget sheet workflow vs Google Sheets; rounds and findings |
| `docs/docs-parity.md` | Short-report workflow vs Google Docs; checkpoints and fixes |
| `docs/excel-visual-parity.md` | Excel↔SuiteLeaf visual parity audit workflow and result contract |
| `docs/research/catalog.md`, `README.md` | Catalog of the reference books that inform each workflow |

**Reference books consulted (distilled in `workflows.md` / `catalog.md`)**

- *Google Workspace For Dummies*, Paul McFedries (2024), ch. 5–9
- *Ultimate Guide to Google Sheets*, Kenneshaw (local PDF), ch. 1, 5, 8
- *Teach Yourself VISUALLY Google Workspace*, Guy Hart-Davis
- *Mastering Google Sheets*, Robert G. Pascall; *Google For Beginners* (2025 UK);
  *Complete Google User Manual* (23rd ed., 2024); *Google Drive and Docs in 45 Mins*, Ivan McGhee
- *Everything Google Drive, Docs, Sheet, Forms* (Binn, Carty) — EPUB

---

# Part 1 — Capabilities & quick start
*(from `README.md`)*

## W1. Run locally (web)
**Tutorial:** `npm install` → `npm run dev` → open the local URL Vite prints.
**Expected behavior:** the app starts on the printed Vite URL; the home screen
lists file metadata and editor modules load only when a document/spreadsheet
opens. No account and no paid editor service required.

## W2. Run locally (desktop / Electron)
**Tutorial:** `npm run setup:electron` (downloads the platform binary) →
`npm run dev:desktop`.
**Expected behavior:** the Electron window opens against `suiteleaf://app/`.
New files start as **recovery drafts**; after **Save As** they autosave to the
regular file. Useful when npm install-script settings block Electron's normal
install hook.

## W3. File library management
**Tutorial:** create, rename, search, duplicate, remove, import, and export
files; use the original sample files.
**Expected behavior:** each operation updates the file metadata visible on the
home screen; searches filter the list in place; duplicate creates an independent
copy; remove deletes the entry; import/export round-trips through `.suiteleaf`.

## W4. Save, portability & recovery
**Tutorial:** **Download** a `.suiteleaf` copy → reopen on another device/origin
via **Open / import**; on desktop, **Save As** then let edits autosave.
**Expected behavior:**
- Web: browser autosaves to localForage (IndexedDB w/ fallback) on the current
  origin; **Download** produces a portable copy; a second tab cannot edit a file
  already open elsewhere (Browser Web Locks).
- Desktop: writes are serialized and replaced **atomically** (temp sibling →
  fsync → rename). If another program changes the file, SuiteLeaf keeps a
  recovery draft and offers **Reload saved** / **Save As** instead of
  overwriting. Removing a recent-file entry also removes its draft; the saved
  file stays on disk. Recovery data lives under `library/library.json`.

## W5. Exports
**Tutorial:** **File → Export** for HTML/plain-text documents or CSV/TSV
spreadsheets; **File → Print / Save as PDF**.
**Expected behavior:**
- Document exports produce HTML or plain text. Spreadsheet exports carry the
  active worksheet's **calculated values**; formula-looking text gets a
  protective apostrophe. Spreadsheet printing is limited to 10,000 cells.
- On desktop with no printer, **Print** opens a PDF save dialog and generates
  the PDF directly.

## W6. Build, host & checks
**Tutorial:** `npm run notices` → `npm run build`; serve `apps/web/dist/`
from any static HTTPS host (root or subdirectory).
**Expected behavior:** routes use URL fragments (no server-side rewrite needed);
the production service worker caches assets for offline use after first
install (dev mode does not install one); static hosting does **not** create a
shared server-side file library or user accounts.

## W7. Capacity limits & explicit errors
**Tutorial:** push imports past each limit and observe the error.
**Expected behavior (files outside limits produce *explicit* capacity errors,
never silent truncation):**
- Images: PNG/JPEG/GIF/WebP up to **5 MB**.
- Office inputs **120 MB**; native inputs **200 MB**; other imports **50 MB**.
- Office packages may expand to **1 GB**.
- Spreadsheet imports: up to **10,000,000** stored cells and **100 MB** of cell
text; **CSV ranges up to 200,000 cells**.
- HTML imports sanitize executable content and accept embedded images only.
- Delimited imports preview delimiter+rows, retain the header row, infer ordinary
  numbers/booleans, and keep formulas, leading-zero identifiers, and
  high-precision numbers as text.

---

# Part 2 — Editors & analysis
*(from `README.md`, `docs/workflows.md`, `docs/architecture.md`)*

## W8. Docs rich-text editing
**Tutorial:** write continuous text; add headings/outline; apply fonts, sizes,
colors, highlighting, alignment, lists, links, images, tables (selectable
dimensions); use find/replace; check word count; undo/redo; print.
**Expected behavior:**
- Editing is continuous-layout rich text (Tiptap/ProseMirror); the office
  toolbar, outline, find/replace, and import/export are SuiteLeaf-provided.
- The **font/size/color toolbar tracks the current selection** — moving the caret
  between differently-formatted passages updates the controls.
- **Find/replace** supports single-occurrence replace, forward & **backward**
  navigation, match counts, and case/regex/diacritic options; a replacement
  advances to the next match and **undo** reverses it.
- Word count updates live; undo/redo follows editor transactions; printing uses
  live pages with configurable furniture. DOCX/XLSX export is implemented locally; accounts, cloud
  sync, and shared editing remain **deferred**.
- See also `docs/docs-parity.md` (shared short-report workflow + 9 checkpoints).

## W9. Sheets editing (Univer)
**Tutorial:** open a multi-worksheet sheet; enter data; enter formulas/
references; format cells and number/date formats; merge cells; fill; use
clipboard, row/column operations, freeze, sort, filter, find/replace.
**Expected behavior:**
- Univer owns cell rendering, formula calculation, selection, clipboard,
  formatting, sort/filter, and its own undo/redo; SuiteLeaf persists workbook
  snapshots after mutations.
- **Freezing** locks panes; **sort/filter** reorder/restrict rows within the
  sheet; **merged cells** and **row/column operations** adjust as expected.
- Multiple worksheet tabs are retained with their IDs/definitions; formulas,
  formatting, merges, and number formats survive save/reopen.
- Reference: *Google Workspace For Dummies* ch. 8; *Ultimate Guide to Google
  Sheets* ch. 1, 5, 8; *Mastering Google Sheets*.

## W10. Charts (insert, move, resize, refresh)
**Tutorial:** select a range **with headers** → **Insert chart** → move/resize
on the grid → edit/remove via **Charts & pivots**.
**Expected behavior:**
- Column/bar, line, pie, and scatter charts render **calculated source values**
  (via Recharts, using `getRawValues()` so currency formatting doesn't turn
  numbers into strings).
- New charts are placed **below existing table rows** using actual pixel heights
  (non-overlapping); a title is inferred from series headers, the legend keeps
  **source series order**, and the category axis is labeled.
- Charts **update from calculated source values** after data changes; source
  ranges adjust after row/column insertions/deletions and are marked **invalid**
  when their source is deleted. Charts are edited/removed through **Charts &
  pivots**. Definition + placement reopen intact.

## W11. Pivots (group, filter, refresh, detach)
**Tutorial:** pick row/column/value fields + optional equality filter and an
aggregate (SUM/COUNT/AVERAGE/MIN/MAX) → read the protected worksheet →
**Charts & pivots → Refresh** after a source change → **Copy** for an editable
worksheet.
**Expected behavior:**
- Results land in a **protected** worksheet (Arquero aggregation).
- Numeric aggregates ignore nonnumeric values; **COUNT counts nonempty value
  entries**; empty grouping fields form a **blank group**; absent intersections
  are **blank cells**; an **equality filter precedes** aggregation.
- Grid source filters do **not** restrict the analysis range; refresh is
  **explicit** and results are protected against ordinary editing.
- **Copy** detaches values from the definition (an editable, standalone copy).
- Source ranges are fixed inclusive rectangles, **not** entire-column refs.

## W12. Slides
**Tutorial:** create a multi-slide presentation → reorder thumbnails → choose a
layout (Title, Title & Body, Two Column, Section, Blank) → set backgrounds →
apply rich text / shapes (rectangles, rounded rectangles, ellipses) / images /
tables / speaker notes → run a fullscreen **slide show**.
**Expected behavior:** thumbnails reorder correctly; layouts and custom
backgrounds apply; shapes/images/tables/notes render; fullscreen slide-show
mode presents slides; the presentation is a valid `.suiteleaf`.

## W13. PowerPoint import
**Tutorial:** native, offline import of `.pptx`, `.ppt`, `.ppsx`, `.pptm`,
`.potx`, `.ppsm` via disk Open or drag-and-drop.
**Expected behavior:** imported as valid `.suiteleaf` presentations, preserving
slide dimensions, shape and text styles, bullet hierarchies, tables, and
speaker notes.

## W14. Native `.suiteleaf` portability (round-trip)
**Tutorial:** build content in the web editor → **Download** → open the same
file on desktop (or vice versa).
**Expected behavior:** both platforms read the **same versioned format** and
preserve supported document content, embedded images, workbook formulas/styles,
chart placement, pivot definitions, and presentation slides. Definitions
reference worksheets by **ID**, not by editable name.

---

# Part 3 — Office import
*(from `docs/office-imports.md`, `docs/architecture.md`)*

## W15. Import a Word document (.docx)
**Tutorial:** **Open / import** (browser) or native **Open** (Electron) →
edit → **Download** / **Save As** `.suiteleaf`.
**Expected behavior:** the file becomes an editable SuiteLeaf copy; original
Office files stay unchanged. Preserved: text/Unicode, headings, lists, emphasis,
safe links, tables, supported raster images, footnote/endnote text. Word page
furniture becomes **labelled sections**; deeply-nested layout or semantic-parser
failures recover text as **paragraphs**. Exact pagination, font styling,
floating objects, equations, review history, and unsupported image formats can
differ. Body-text retention is verified; recovered text is explicitly labelled
(and may duplicate content when the source layout rearranges text).

## W16. Import a spreadsheet (.xlsx / .xlsm / .xltx / .xls / .xlsb)
**Tutorial:** same **Open / import** flow; edit; save to `.suiteleaf`.
**Expected behavior:**
- Preserved: worksheet names/order, typed values, formulas + caches,
  shared/array formulas, date system, named ranges, basic styles, merges,
  row/column dimensions and hiding, frozen panes.
- Calculation uses Univer's supported functions; **external links are not
  fetched**. Not recreated: Excel conditional formatting, validation,
  protection, hyperlink targets, pivot definitions, embedded spreadsheet images
  (pivot results stay as cells); representable **basic charts are recreated with
  simplified styling**; **macros are not executed or imported**.
- `.xls`/`.xlsb`: binary-to-XML normalization brings values, formulas, number
  formats, merges, dimensions. Unreadable worksheet metadata → **explicit error**;
  these formats have fixture regression coverage.
- Every import stores `importInfo` and shows an expandable **compatibility
  summary** that survives native saves and reopen.
- A successful import = editable content + native round-trip validity, **not**
  pixel-perfect Word/Excel equivalence.

## W17. Import failure & capacity handling
**Expected behavior (per `office-imports.md`):**
- Office inputs 120 MB; expanded package 1 GB; native editable file 200 MB;
  spreadsheet 10,000,000 stored cells and 100 MB of cell text; **worker timeout
  2 minutes**.
- Password-protected files require an **unencrypted copy** from Word/Excel.
- Damaged containers, missing required parts, unsafe/invalid XML declarations →
  explicit errors. **Limits never silently truncate the source.** Originals stay
  intact on every error path.
- Failure classes are distinct: encrypted/invalid, capacity, and unexpected —
  counted separately.

## W18. Run the office corpus validation
**Tutorial:** `npm run test:office-corpus`.
**Expected behavior:** processes every DOCX/XLSX in `datasets/inventory.jsonl`
through the **same converter as the UI**; checks original SHA-256, document text
retention, native schema validity, and save/reopen serialization; isolated
workers with immutable source snapshots. Reports go to
`datasets/validation/office-final-results/complete-results.jsonl` + a summary.
Third-party/generated content is excluded from Git and releases.

---

# Part 4 — Acceptance & parity workflows
*(from `docs/workflows.md`, `docs/docs-parity.md`,
`docs/sheets-workflow-validation.md`, `docs/excel-visual-parity.md`,
`docs/architecture.md`)*

## W19. Acceptance scenario 1 — Draft a report
(Short-report workflow, *For Dummies* ch. 5–7.)
**Steps:** draft a report → apply headings/emphasis → add a table + image →
find/replace → reopen → print/export.
**Expected behavior:** every step above succeeds; text, headings, emphasis,
table, image persist through reopen; plain-text export omits only unsanitized
markup; print preview shows the supported content.

## W20. Acceptance scenario 2 — Budget spreadsheet
(*Ultimate Guide to Google Sheets* ch. 1.)
**Data:**

| Category | Budget | Actual |
| --- | ---: | ---: |
| Housing | 1200 | 1150 |
| Food | 500 | 425 |
| Transport | 300 | 280 |
| Utilities | 200 | 175 |

**Tutorial:** enter the table → Remaining = Budget − Actual → Row 6 totals → bold
headers + dollar formatting → column chart on `A1:C5` → filter on `A1:D5`.
Change **Food actual 425 → 450**.
**Expected behavior:** totals change from **2200 / 2030 / 170** to
**2200 / 2055 / 145**; after save/reopen formulas, formatting, chart, and
filter are all retained.

## W21. Sheets workflow vs Google Sheets (parity rounds)
(from `docs/sheets-workflow-validation.md`; scenario 2; reference MP4s per round.)
**Steps:** a fresh subagent runs each round; enter the budget, build chart +
filter, edit Food actual, save/reopen; compare to Google Sheets' MP4.
**Expected behavior ("clean round"):**
- Eight visible bars render from currency-formatted data; monetary labels show
  correctly; chart title derived from headers; series order preserved; chart
  placed non-overlapping below the table.
- Recalculated totals match; filter persists and removal works; save/reopen keeps
  formulas/formatting/chart/filter; numeric pivot aggregates formatted source
  cells.
- `tests/browser/sheets-workflow.spec.ts` passes in Chromium + WebKit.
- **Scope:** fonts/colors/toolbar layouts/chart tick spacing, sort criteria,
  other chart types, and broader Sheets functionality are **out of scope**.
  Automated checks supplement the MP4 review; they do **not** establish
  feature-wide equivalence.

## W22. Docs workflow vs Google Docs (parity checkpoints)
(from `docs/docs-parity.md`; *For Dummies* ch. 5–7; reference = Google Docs.)
**Shared report:** "Quarterly Report" (H1) about *Project cedar* with an
*Actions* list (review/approve).
**Checkpoints & expected behavior:**
1. Create/name the document; enter the shared report.
2. Heading 1 on "Quarterly Report"; outline + font-size toolbar present.
3. Bold a phrase; move caret between differently-formatted passages; **toolbar
   tracks current formatting**.
4. Find `cedar`, replace **one** occurrence with `Maple`, navigate forward/
   backward, then replace the rest; **match counts update**; undo works.
5. Compare case-sensitive + accent-insensitive search on `café café`; regex mode
   `cedar \d+`; an invalid `[` expression is rejected.
6. Insert a 2×2 table; enter the same cell values in each app.
7. Insert the same local image where file-upload is supported.
8. Reopen: text/headings/emphasis/table/image persist.
9. Export plain text; open print preview; compare supported content.

**Rules:** record every completed **and** blocked checkpoint; do **not** treat an
untested step as passing. A clean round = zero observed differences among *completed
shared checkpoints*; incomplete reference runs **cannot** establish a clean
round.

## W23. Excel↔SuiteLeaf visual parity audit
(from `docs/excel-visual-parity.md`.)
**Tutorial:**
```sh
python3 scripts/excel-parity-db.py init
node scripts/excel-parity-native.py SOURCE OUTPUT/excel
node scripts/capture-suiteleaf-parity.mjs SOURCE OUTPUT/suiteleaf OUTPUT/excel/excel.json
python3 scripts/excel-parity-db.py ingest OUTPUT/result.json
python3 scripts/excel-parity-db.py verify
python3 scripts/excel-parity-db.py report
python3 scripts/run-excel-parity.py
```
**Setup/expected behavior:** SuiteLeaf must be served by Vite at
`http://127.0.0.1:5173` (or `--base-url`); Excel uses native AppleScript +
window screenshots. The runner dispatches a **fresh ephemeral subagent per
file** (≤3 concurrent), runs one file at a time, and an **unresolved disparity
stops dispatch**. Changed SuiteLeaf fingerprints invalidate earlier verdicts and
requeue them.
**Capture rules (expected behavior):**
- Inventory **all** Excel files (duplicates stay distinct); verify originals by
  SHA-256 first; use disposable copies, macros disabled, no external-link
  updates; preserve user-open workbooks and unrelated edits.
- Capture **every** worksheet including hidden/very-hidden (preserve original
  visibility in metadata).
- **Exactly one screenshot per sheet per app at 100% zoom**, starting at A1, full
  visible viewport; **no panning/scaling/extra screenshots** — clipped content is
  acceptable.
- A **pass** = visible content matches; it does **not** claim parity for
  offscreen content. `coverage_complete` = every sheet has one paired viewport
  screenshot + a visual review.
- Accept small font/spacing/color/border/placement differences **unless** they
  hide, clip, alter, or change the meaning of content. **Excel-readable /
  SuiteLeaf-rejected → fail**; unavailable reference or incomplete evidence →
  **inconclusive**. Excel recovery on disposable copies sets
  `reference_altered_by_excel: true` (stays inconclusive vs the original).
- Result JSON includes `source_sha256`, `suiteleaf_revision`, `audit_revision`,
  `excel_version`, `excel_readable`, `coverage_complete`, and per-sheet
  `reviews` (parity + reason). **Missing comparisons are never shown as passing.**

---

# Part 5 — Storage & save ordering (behaviors)
*(from `docs/architecture.md`)*

## W24. Save, conflict & recovery semantics
**Expected behavior:**
- Editor changes update an in-memory file, then a **debounced** save; explicit
  saves flush pending spreadsheet snapshots; a **save queue preserves ordering**
  and won't let a failed write poison later retries.
- **Browser Web Locks** prevent two tabs editing one file at once.
- Atomic desktop writes: persist draft → check **SHA-256 fingerprint** → write
  temp sibling → fsync → rename over original. **Conflicts or missing originals
  preserve the draft**; **Save As** writes to a user-approved new path;
  **reload** discards the draft in favor of the current disk file.
- IndexedDB stores JSON in **4 MB chunks** (metadata committed in the same
  transaction) to avoid structured-clone overhead over millions of cells.

## W25. Native import validation gate
**Expected behavior:** native imports **reject** newer versions, malformed
ranges, missing worksheets, unsafe document links, and external image references
*before* persistence. Native Open converts Office files to **recovery drafts**;
**Save As** writes `.suiteleaf` and **never** replaces the DOCX/XLSX original.
Compatibility info goes into optional `importInfo` metadata, shown in the editor.

---

*Built progressively from `docs/`. External books in `docs/` + `research/` are
gitignored reference material excluded from bundles; they inform workflow
selection only. The implementation uses independent code and original sample
content.*

---

# Part A — Google Workspace general workflows
*Mined from the reference books in `docs/` + `research-library/`. Each entry lists
the manual's workflow, its observable expected behavior, and a "SuiteLeaf v1"
note. **"v1"** = in the current static/Electron build (see `README.md` "What
works"); "partial"/"out-of-v1" = not in the current spec. Book titles are
gitignored reference material that guides workflow selection only.*

## A1. Source: *Google Workspace For Dummies* (McFedries, 2024)
Broad 12-chapter reference across every Workspace app. Ch. 1 tour, ch. 2–4 email/
calendar/contacts, ch. 5–7 Docs, ch. 8 Slides, ch. 9 Gmail advanced, ch. 10
"organizing your life", ch. 11–16 collaboration, ch. 17–19 "Part of Tens".

- **WF-A1-01 Meet the Workspace apps (50¢ tour).** Sign in; open the app
  launcher. *Expected:* an app list (Gmail, Calendar, Contacts, Docs, Sheets,
  Slides, Meet, Chat, Groups, Forms, Keep, Drive) each opens to its home view.
  *v1:* N/A (no accounts/app launcher; SuiteLeaf is Docs/Sheets/Slides + imports).
- **WF-A1-02 Tour the Gmail inbox.** Open Gmail; read the inbox layout
  (star, read/unread, labels column, message area). *Expected:* message list
  with star + label affordances; clicking a message shows its body. *v1:* out-of-v1.
- **WF-A1-03 New message (compose → Bcc/Cc → send).** Click New, fill To/Bcc/
  Cc/Subject/body, Send. *Expected:* message leaves the outbox and is delivered;
  a copy appears in Sent. *v1:* out-of-v1.
- **WF-A1-04 AI-draft a message.** Click the AI help button; choose a refinement.
  *Expected:* Gmail shows a prompt box and rewrites the draft per the chosen
  refinement. *v1:* out-of-v1 (Gemini/AI is outside SuiteLeaf).
- **WF-A1-05 Insert attachments / signature / schedule send.** Attach a file;
  create a signature; schedule a later send; undo a send within seconds.
  *Expected:* attachment chips appear; signature auto-appends; scheduled send
  holds then delivers; Undo retracts for the grace window. *v1:* out-of-v1.
- **WF-A1-06 Reading pane + attachments.** Set reading-pane position; view/
  download an attachment. *Expected:* reading pane toggles right/bottom;
  attachment toolbar hover reveals download. *v1:* out-of-v1.
- **WF-A1-07 Create a task from a message.** Right action → "Create task".
  *Expected:* a task is created and appears in Tasks. *v1:* out-of-v1.
- **WF-A1-08 Label & filter messages.** Star/label; build a filter that routes
  matching mail. *Expected:* matching messages receive the label automatically;
  starred/unstarred/important states render. *v1:* out-of-v1.
- **WF-A1-09 Set a vacation responder.** Enable out-of-office with dates +
  message. *Expected:* auto-replies send inside the window only. *v1:* out-of-v1.
- **WF-A1-10 Calendar: create/subscribe/share events; make yourself busy.**
  Create an event; share a calendar; subscribe to a shared one; mark "busy/
  unavailable". *Expected:* events list; shared calendars appear; subscribe
  syncs; "busy" shows on the day view. *v1:* out-of-v1.
- **WF-A1-11 Contacts: add/edit/group.** Add a contact; change fields; label
  groups. *Expected:* contact saves; edited fields persist; group labels
  aggregate members. *v1:* out-of-v1.
- **WF-A1-12 Docs: process text (Ch. 5) — apply default styles.** Type text;
  apply paragraph/heading styles. *Expected:* applying a style reflows the
  paragraph consistently vs manual font tweaks; styles are reusable.
  *v1:* **supported** (headings/outline, fonts/sizes/colors/highlight/align).
- **WF-A1-13 Docs default styles to avoid reinventing formatting.** Create custom
  styles; set them as default. *Expected:* new text/selection adopts the default
  style; switching selection updates the toolbar to the current formatting.
  *v1:* partial (toolbar tracks selection; "save as default style" not in spec).
- **WF-A1-14 Document layout: tables, page numbers, headers/footers.** Insert a
  table; add page numbers; add differing headers/footers. *Expected:* table with
  selectable dimensions renders; page numbers auto-number; header/footer repeat
  per page / differ for first page. *v1:* table **supported**; header/footer +
  page numbers/pagination are **deferred** (continuous layout only).
- **WF-A1-15 Slides: design an effective presentation (Ch. 10).** Create slides;
  choose theme; add text/image/shape; present. *Expected:* slides present in a
  slide show; theme restyles; shapes/images render. *v1:* **supported** (layouts,
  backgrounds, shapes, images, tables, notes, fullscreen show).
- **WF-A1-16 Gmail advanced: confidential mode; view by conversation; block/
  unblock; create filters.** *Expected:* confidential message has expiry +
  no-forward; conversation view groups replies; blocked sender can't reach you;
  filters act on new mail. *v1:* out-of-v1.
- **WF-A1-17 Keep notes + Tasks commitments (Ch. 11).** Create a note; track a
  commitment as a task. *Expected:* note saves/edits/shares; task lists render.
  *v1:* out-of-v1.
- **WF-A1-18 Forms: build, preview, send, read responses (Ch. 16).** Create a
  form; add questions; preview; share a link; view responses. *Expected:*
  respondents submit; responses aggregate into a summary/sheet. *v1:* out-of-v1.
- **WF-A1-19 Collaborating on files (Ch. 11).** Share; co-edit in real time;
  manage permissions; comment; version history. *Expected:* co-editors see
  changes live; comments thread; history lists revisions; permission levels
  (viewer/commenter/editor) enforce access. *v1:* **out-of-v1** (shared/real-time
  editing is deferred); share/version history not in current spec.
- **WF-A1-20 Meet + Chat (Ch. 13/14).** Start/join a meeting; send a chat
  message; create a chat space. *Expected:* meeting connects and can record/
  live-stream; messages + space messages appear in Chat. *v1:* out-of-v1.
- **WF-A1-21 Groups (Ch. 15).** Create a group; post/share files. *Expected:*
  members receive posts; group file space is shared. *v1:* out-of-v1.
- **WF-A1-22 "Part of Tens" tips (Ch. 17–19).** Work-from-home tips; 10 useful
  Gmail settings; 10 privacy/security enhancers. *Expected:* each tip changes an
  observable setting/behavior (e.g., enable 2-Step Verification changes sign-in).
  *v1:* N/A (security/account settings are account-side).

## A2. Source: *Teach Yourself VISUALLY Google Workspace* (Hart-Davis)
Illustrated 12-chapter "tasks" guide; granular per-app "task" units.

- **WF-A2-01 Open apps, create & save a document (Ch. "Getting started").**
  Open an app; create and save. *Expected:* file appears in Drive; autosave
  persists edits. *v1:* create/save **supported**; Drive persistence → local
  IndexedDB + `.suiteleaf`, not cloud.
- **WF-A2-02 Insert an Image in Docs/Slides.** Insert an image; resize/
  reposition. *Expected:* image renders; resize/reposition moves it on canvas.
  *v1:* **supported** (image insert up to 5 MB).
- **WF-A2-03 Insert a Table in Docs/Slides.** Insert a table. *Expected:* table
  with selectable dimensions renders; cells editable. *v1:* **supported**.
- **WF-A2-04 Insert a Drawing.** *Expected:* drawing object added to canvas.
  *v1:* partial (shapes/tables yes; "drawing" object not in spec).
- **WF-A2-05 Insert a Chart.** *Expected:* chart renders from source cells.
  *v1:* **supported** (col/bar/line/pie/scatter).
- **WF-A2-06 Insert a Link; work with comments; resize/reposition/format objects.**
  *Expected:* link navigates (safe); comment threads show; object transforms
  apply. *v1:* links **supported** (URL links only, no comment threads).
- **WF-A2-07 Docs: preferences + page size/margins (Ch. "Working in Docs").**
  *Expected:* settings change layout. *v1:* partial (no margin/page-size in
  continuous layout).
- **WF-A2-08 Docs: Enter text; editing/suggesting/viewing modes.** *Expected:*
  three modes behave (typing vs "suggest changes" vs suggest-only view).
  *v1:* editing + view supported; "suggesting" (tracked changes) out-of-v1.
- **WF-A2-09 Docs: Format with styles; customize + save default styles.**
  *Expected:* styles apply/repeat; defaults persist. *v1:* partial (styles yes,
  "save default" no).
- **WF-A2-10 Docs: document outline navigation; page numbers; headers/footers.**
  *v1:* outline **supported**; page numbers/headers/footers **deferred**.
- **WF-A2-11 Sharing/collaboration: share file/folder; manage permissions; co-
  edit; chat with collaborators; compare two docs; review comments; revert to
  earlier version; change ownership; Drive-for-Desktop backup.** *Expected:*
  each operation enforces its observable outcome (permission, live sync, diff,
  revert, ownership transfer, local mirror). *v1:* **out-of-v1** (collab).
- **WF-A2-12 Sheets: select cells/ranges; enter content; import data; insert/
  delete cells/rows/cols; insert/delete/manage sheets; insert a function;
  format; number formats; conditional formatting; alternating colors; notes;
  settings; merge; wrap/rotate.** *Expected:* selection highlights the range;
  content/labels persist; import populates grid; insert/delete shift refs;
  function computes; number format changes display only; conditional formatting
  colors by rule; merge combines; wrap/rotate affects layout. *v1:* select/enter/
  import/delete/manage-sheet/function/format/number-format/merge/freeze **supported**;
  **conditional formatting, alternating colors, notes, spreadsheet settings,
  wrap/rotate → not in v1 spec** (verify against Univer build).
- **WF-A2-13 Sheets advanced: Paste Special/transpose; sort; filter; data
  validation; protect ranges/sheet; record/run/manage a macro.** *Expected:*
  pasted data transposes; sort/filter reorder/restrict rows; validation blocks
  bad input; protected ranges/sheet refuse edits; macro records + replays +
  lists. *v1:* sort/filter **supported**; **data validation, protection,
  macros → out-of-v1**.
- **WF-A2-14 Slides: preferences (Autofit); add slide; import slides; views;
  text boxes; add audio/video; shapes; word art; transitions/animations; slide
  master; organize; slide numbers; preview/print; handouts; present.**
  *Expected:* Autofit resizes text to box; added/imported slides render; audio/
  video/plays; shapes/word art/anim/timings behave; numbering + handouts
  generate; slide show presents. *v1:* core (layouts, shapes, images, tables,
  notes, reorder, present) **supported**; **audio/video, word art, animations,
  slide master, handouts, print → out-of-v1/partial**.
- **WF-A2-15 Gmail send/receive; confidential mode; schedule; conversation view;
  block; filters; attachments.** *Expected:* per WF-A1-03…A1-16. *v1:* out-of-v1.
- **WF-A2-16 Meet/Chat/Hangouts + Account management + Calendar interface/events/
  share/subscribe + Contacts add/change/group + Keep notes + Tasks.**
  *Expected:* per WF-A1-10…A1-17. *v1:* out-of-v1.
- **WF-A2-17 Forms: build/settings/questions/files/images/videos/sections/
  conditional logic/collaborators/preview/test/send/read responses.**
  *Expected:* form builds; file/image/video questions accept responses; sections
  + branch-on-answer route respondents; responses collect. *v1:* out-of-v1.

## A3. Source: *Google For Beginners* (2025 UK, PCP Publications)
Parent/teen-facing consumer guide: phishing, social-network safety, Google
privacy check-up. Lower relevance to SuiteLeaf; useful as security-awareness
workflows.

- **WF-A3-01 Recognize phishing.** Identify fake login pages; avoid entering
  PIN/passwords. *Expected:* user flags spoofed "login" pages; no credentials
  entered. *v1:* N/A.
- **WF-A3-02 Manage social-network privacy settings.** Open a network's privacy
  center; raise settings; manage friends/blocked list. *Expected:* stricter
  privacy chosen; blocked people can no longer interact. *v1:* out-of-v1.
- **WF-A3-03 Google/Google-account privacy check-up.** Open the account page; run
  "Take the Privacy Check-Up"; adjust per-category options; manage data/
  personalisation; People & Sharing. *Expected:* check-up guides to per-category
  controls; choices persist. *v1:* N/A (account side).

## A4. Source: *Google Drive & Docs in 45 Mins* (Ivan McGhee)
28 short chapters: Drive get-started/files/share/upload/organize/sync, then
Docs basics → tables → styles → images → voice → version history → translate →
Smart Compose → linking → add-ons → ownership → text boxes/shapes → citations.

- **WF-A4-01 Drive get-started.** Sign in; open the app grid → Drive.
  *Expected:* Drive home view lists files/folders. *v1:* N/A (no cloud grid; the
  file list is SuiteLeaf's home screen).
- **WF-A4-02 Add files (create / upload / drag).** Click New; drag a file in.
  *Expected:* new file opens in a tab; uploaded/dragged file appears in Drive.
  *v1:* equivalent is create/import → `.suiteleaf`.
- **WF-A4-03 Create a file + name it (no explicit Save).** Create a doc; rename
  "untitled document". *Expected:* renaming updates the tab title + Drive entry;
  **autosave** persists on the go. *v1:* **supported** (create/rename/autosave).
- **WF-A4-04 Create from a template.** Open templates page; open a template.
  *Expected:* a new file with the template's content is created + customizable.
  *v1:* partial (native sample files act as templates; no remote template store).
- **WF-A4-05 Manage files: search / preview / sort / filter.** Type in search;
  preview without opening; sort A–Z/Z–A/last-modified; filter by type.
  *Expected:* results narrow; preview shows snapshot; sort reorders; filter is
  broader than exact search. *v1:* search/duplicate/rename/remove **supported**
  (home screen); preview-as-snapshot not in v1 spec.
- **WF-A4-06 Create a folder + add files (single/multi).** New folder; drag;
  Ctrl/Cmd-click to multi-select; drag to folder. *Expected:* folder created;
  selected files move in; multi-select toggles. *v1:* no folder concept (flat
  file library) → out-of-v1.
- **WF-A4-07 Delete (to trash) vs. delete permanently.** Remove to trash; empty
  trash. *Expected:* remove sends to trash (reversible); empty trash is final.
  *v1:* remove is a plain delete (no trash/restore in v1 spec) → partial.
- **WF-A4-08 Share a file + choose people/permissions.** Share; add addresses +
  role. *Expected:* shared users can access; role (view/comment/edit) enforced.
  *v1:* out-of-v1 (collab).
- **WF-A4-09 Install Backup & Sync for Drive (Windows 10).** Install the
  desktop client; mirror folders. *Expected:* a local folder mirrors Drive;
  moved files upload automatically. *v1:* concept maps to SuiteLeaf desktop
  recovery/atomic save, not a cloud mirror → out-of-v1.
- **WF-A4-10 Get started with Google Docs.** Open a doc; begin editing.
  *Expected:* text editor opens; edits persist via autosave. *v1:* **supported**.
- **WF-A4-11 Text basics.** Type; select; bold/italic/underline; font/size/
  color. *Expected:* formatting applies to selection only; toolbar tracks the
  current selection. *v1:* **supported**.
- **WF-A4-12 Headers and footers.** Add header/footer. *Expected:* repeats on
  every page. *v1:* deferred (continuous layout).
- **WF-A4-13 Add/reply to comments.** Add a comment; reply. *Expected:* comment
  + reply thread shows. *v1:* out-of-v1 (no comment threads).
- **WF-A4-14 Docs new shortcut (new tab).** Open a new document in a new tab.
  *Expected:* new blank doc opens. *v1:* create new file → supported.
- **WF-A4-15 Working with tables (×1/×2).** Insert a table; fill cells; resize.
  *Expected:* table renders with chosen dimensions; cell content persists;
  resize moves the grid. *v1:* **supported** (selectable table dimensions).
- **WF-A4-16 Working with styles.** Apply paragraph/heading styles. *Expected:*
  style reflows text; outline reflects headings. *v1:* **supported** (styles/
  headings/outline).
- **WF-A4-17 Working with images.** Insert an image. *Expected:* image renders
  at its size. *v1:* **supported**.
- **WF-A4-18 Voice typing.** Dictate text. *Expected:* spoken words become text.
  *v1:* out-of-v1 (no dictation).
- **WF-A4-19 Version history.** Open history; restore a version. *Expected:*
  past revisions listed; restoring reverts the doc. *v1:* out-of-v1 (no history).
- **WF-A4-20 Translating documents.** Translate. *Expected:* text is rendered
  in the target language. *v1:* out-of-v1.
- **WF-A4-21 Smart Compose (smart compose).** Suggested next words; accept with
  Tab. *Expected:* ghosted suggestion appears; Tab inserts it. *v1:* out-of-v1
  (AI).
- **WF-A4-22 Linking within a document.** Insert an internal link. *Expected:*
  clicking jumps to the target. *v1:* partial (URL links only; no in-document
  anchors in spec).
- **WF-A4-23 Installing add-ons.** Install a Docs add-on. *Expected:* add-on UI
  appears in the menu. *v1:* out-of-v1 (no add-ons).
- **WF-A4-24 Inserting images (repeat).** *Expected:* per A4-17. *v1:* **supported**
  (image size limit 5 MB).
- **WF-A4-25 Changing ownership of a doc.** Transfer ownership. *Expected:* new
  owner gains top-level permissions. *v1:* out-of-v1.
- **WF-A4-26 Text boxes and shapes.** Insert a text box/shape. *Expected:* the
  object can be positioned and holds text. *v1:* partial (no text box in Docs;
  slides have shapes).
- **WF-A4-27 Adding citations.** Insert a citation + bibliography. *Expected:*
  cite renders inline; bibliography appears at the end. *v1:* out-of-v1.
- **WF-A4-28 (Chapter 4) Upload files to Drive; (Ch 5) Organize with colors &
  icons.** *Expected:* uploads succeed; labels/colors/icons categorize items.
  *v1:* out-of-v1 (no labels/icons; import supported though).

## A5. Source: *Everything Google Drive, Docs, Sheet & Forms* (Binn, Carty, 2022)
Ch. 1 "Google Apps" tour; practical tasks per app.

- **WF-A5-01 What is Google Apps?: sign in + navigate the suite.**
  *Expected:* the app launcher lists all connected apps. *v1:* N/A.
- **WF-A5-02–05 Drive / Docs / Sheets / Forms quick tasks (create, edit,
  save, share, import/export).** *Expected:* per the corresponding WF-A1/A2/A3
  entries. *v1:* create/edit/save/import **supported**; share/export to Office
  **deferred**; forms out-of-v1.

---

# Part B — Google Sheets deep dives
## B1. Source: *Ultimate Guide to Google Sheets* (Kenneshaw)
8 chapters: 101 basics → Forms → CRM → writing → analytics dashboard → add-ons →
Apps Script → organize/back up.

- **WF-B1-01 Create a spreadsheet & fill it with data.** Choose one of 3 create
  paths (New button / File > New / blank or template). *Expected:* blank sheet
  opens; typed cells persist across sheets/tabs. *v1:* **supported**.
- **WF-B1-02 Format data for easy viewing.** Apply bold headers, number/currency
  formats, alignment, background. *Expected:* display changes; raw values
  unchanged (format is cosmetic). *v1:* **supported**.
- **WF-B1-03 Add, average, filter data with formulas.** Enter SUM/AVERAGE and a
  filter; edit a value. *Expected:* totals recalculate live; filter restricts
  visible rows. *v1:* formulas + sort/filter **supported** (see budget test).
- **WF-B1-04 Share, protect, move data.** Share; protect the sheet; move to a
  folder. *Expected:* shared users can access; protected sheet rejects edits;
  the sheet relocates. *v1:* create/move-as-copy **supported**;
  share/protect **out-of-v1**.
- **WF-B1-05 Build a Google Form; field options; sections + logic; store
  responses in a sheet; share; add-ons; MailChimp/Salesforce/Trello
  integrations.** *Expected:* form collects responses into a sheet; conditional
  logic routes; integrations sync data. *v1:* out-of-v1.
- **WF-B1-06 Build a spreadsheet CRM: add a form; contact management; qualify
  contacts via web scraping; outreach via social/email.** *Expected:* form-
  driven contact records; scraped qualifiers; outreach triggers. *v1:* out-of-v1.
- **WF-B1-07 Write faster with Sheets: editorial calendar; detailed outlines;
  import from websites/feeds; translate; auto-format text; combine cell text;
  linked text; images from URL; HTML tables for blogs; publish.**
  *Expected:* formulas/imports produce text/HTML/links as described; publish
  exposes a web view. *v1:* combine/translate-style text ops may be formula-
  supported where Univer implements them; **import-from-web, image-from-URL,
  publish → out-of-v1**.
- **WF-B1-08 Build a custom analytics dashboard: choose metrics; get data;
  build a reporting dashboard; add metrics; pull data from any app.**
  *Expected:* dashboard shows charts/KPIs from (possibly external) data;
  updates on refresh. *v1:* charts + pivots from local data **supported**;
  external-data pull **out-of-v1**.
- **WF-B1-09 Use 50 add-ons (forms, data-gathering, text tools, formatting,
  number-crunching, sharing/publishing, email/comm); build your own.**
  *Expected:* add-on actions run from its menu; custom add-on registers.
  *v1:* out-of-v1.
- **WF-B1-10 Automate with Apps Script: first script; explore power; extend
  with triggers.** *Expected:* the script runs from the editor/UI and performs
  its side effects. *v1:* out-of-v1.
- **WF-B1-11 Manage spreadsheets: reference to Getting-Started/Functions/Add-ons
  guides; find alternate apps; create templates; organize files/folders;
  back up all files.** *Expected:* templates + backups created; folders organize
  the library. *v1:* native sample files ≈ templates; no folder/backup cloud →
  out-of-v1 (local autosave + `.suiteleaf` download is the analog).

## B2. Source: *Mastering Google Sheets* (Robert G. Pascall)
8 chapters from setup to automation; the most detailed Sheets workflow source.

- **WF-B2-01 Creating + navigating** (account, home screen, tabs, navigation).
  *Expected:* home lists sheets; tab switching; cursor/selection navigation.
  *v1:* **supported**.
- **WF-B2-02 Working together / sharing.** *Expected:* shared editors sync.
  *v1:* out-of-v1.
- **WF-B2-03 First spreadsheet: adjust column/row widths; combine/ (and
  separate) cells; change cell format; enter data; copy/paste; edit.**
  *Expected:* widths change layout; merge/ unmerge restructure cells; number/
  date format changes display; copy/paste transfers values; edits persist.
  *v1:* widths(via freeze/univer)/merge/fill/clipboard/number-date format
  **supported**; separate-merged/ unmerge likely in Univer — verify.
- **WF-B2-04 Insert formulas.** Type a formula. *Expected:* the cell evaluates;
  results recalc on dependency change. *v1:* **supported**.
- **WF-B2-05 Protect spreadsheet from loss.** Back up / version history.
  *v1:* partial (autosave + `.suiteleaf` download; no server copy/history).
- **WF-B2-06 Rename a spreadsheet.** *Expected:* name updates everywhere.
  *v1:* **supported** (rename in file library).
- **WF-B2-07 Import data (4 paths): local file; from Drive; from websites;
  from outside sources.** *Expected:* source row/columns populate the grid;
  delimiters/header inferred. *v1:* **local file import** (CSV/TSV + Office,
  delimited preview + header) **supported**; **web/Drive/external → out-of-v1**.
- **WF-B2-08 Functions/formulas: arithmetic operators, mathematical, order of
  operations, cell refs; logical + comparison + combined; error handling;
  text functions (basic/advanced/formatting).** *Expected:* expressions evaluate
  per Excel/Sheets semantics; errors surface as error values. *v1:* **supported**
  (Univer formula engine; see formula-category browser tests).
- **WF-B2-09 Formatting + customizing: cells/ranges, font/align, background &
  borders, conditional formatting, create/format tables, insert/format charts,
  conditional-formatting for data-viz.** *Expected:* styling applies;
  conditional rules color by value; charts render. *v1:* cells/range/font/align/
  charts **supported**; **conditional formatting → out-of-v1** (verify).
- **WF-B2-10 Sorting/filtering/managing data: sort; filter; manage; data
  validation; tips; filters + filter views; advanced filtering; enable + use
  cases + tips for data validation.** *Expected:* sort reorders; filter/
  filter-view restricts rows; validation rejects invalid input. *v1:* sort/filter
  **supported**; **data validation → out-of-v1** (verify).
- **WF-B2-11 Organizing sheets/tabs: create/rename; rearrange/group; tab
  colors; hide/unhide; protect; tab summaries + a table-of-contents.**
  *Expected:* tabs add/rename/reorder/group/recolor/hide; protection blocks
  edits; summaries/TOC navigate. *v1:* multiple tabs **supported**;
  group/recolor/hide/protect/TOC → out-of-v1 (verify against Univer snapshot).
- **WF-B2-12 Collaboration/sharing: share; collaborative editing; notifications/
  alerts; import/export; best practices; review changes via notification rules/
  version history/cell-level change monitoring; comments + notes; publish/embed
  (web, PDF/Excel, CSV/TSV, link sharing + permissions).**
  *Expected:* real-time sync + alerts; version history; cell change monitor;
  comment/notes threads; publish/embed outputs. *v1:* **CSV/TSV export
  supported**; share/collab/notifications/version-history/comments/publish/
  embedding → **out-of-v1** (only CSV/TSV/HTML/PDF export exist in v1; DOCX/XLSX
  export + live pagination are now implemented).
- **WF-B2-13 Advanced analysis: pivot tables; VLOOKUP/HLOOKUP/SUMIF/COUNTIF/
  AVERAGEIF; charts; statistical analysis.** *Expected:* pivot aggregates by
  field; lookups/SUMIF/etc. compute; charts render; stats evaluate. *v1:*
  pivots (SUM/COUNT/AVERAGE/MIN/MAX + equality filter) **supported**;
  VLOOKUP/HLOOKUP/SUMIF family **verify** (formula engine); stats likely.
- **WF-B2-14 Automate with macros + Apps Script: record/manage/modify/
  parameterize macros; create custom functions; call external APIs; trigger
  scripts; build custom UIs.** *Expected:* recordings replay; triggered
  scripts run on events; custom UIs appear. *v1:* out-of-v1.
- **WF-B2-15 Productivity: keyboard shortcuts; add-ons/extensions; custom add-
  ons via Apps Script; time-saving techniques; troubleshooting performance/
  formula-error/collab issues.** *Expected:* shortcuts accelerate actions;
  add-ons run; performance/errors resolve. *v1:* keyboard/editing **supported**
  (Univer); add-ons/extensions → out-of-v1.

---

# Part C — Forms, Sites, Meetings, Admin
## C1. Source: *The Best Guide to Google Forms* (Stachowiak / MakeUseOf, 2017)
- **WF-C1-01 Interface tour: home sections/home nav/form-page nav (top-left,
  top-right); form features/section features/question types/bottom buttons.**
  *Expected:* UI regions behave as labelled; question types differ (text/
  choice/grid/rating/etc.). *v1:* out-of-v1.
- **WF-C1-02 Send/sharing + collecting responses.** *Expected:* share link;
  responses collected + viewable. *v1:* out-of-v1.
- **WF-C1-03 Forms add-ons / integrations.** *Expected:* actions run.
  *v1:* out-of-v1.

## C2. Source: *Google Sites — A Step-by-Step Guide* (5 pages)
- **WF-C2-01 Getting started: open sites.google.com; create a new site (+,
  legacy "New Google Sites" toggle).** *Expected:* new editable site opens.
  *v1:* out-of-v1.
- **WF-C2-02 Design: enter name; undo/redo; preview (incl. responsive); link;
  add collaborators + access level; settings (navigation/brand images/viewer
  tools/custom URLs/analytics); change image (upload or stock); header type
  (large banner/banner/title); edit title; add logo.**
  *Expected:* each control reflects its state; preview shows device variants;
  collaborators get chosen access; header type restyles. *v1:* out-of-v1.
- **WF-C2-03 Insert menu: text box; image (Drive/Google/upload); embed URL (e.g.
  a Google Calendar).** *Expected:* embedded content renders on the page.
  *v1:* out-of-v1.

## C3. Source: *Creating Equitable Hybrid Meetings* (Logitech × Joseph A. Allen)
Meeting-quality playbook, not a feature set.

- **WF-C3-01 Establish collaboration equity; best practices for remote attendees
  vs in-person attendees/organizers; "keep it simple" with technology; quick
  tips summary.** *Expected:* all participants are seen/heard/engaged regardless
  of location/device/language/experience; the checklist yields a successful
  meeting. *v1:* N/A (process guidance, not a SuiteLeaf feature).

## C4. Source: *Google Workspace Data Subject Requests (DSR) Guide* (Feb 2022)
- **WF-C4-01 Access & export (admin vs user): Admin Data Export; Vault targeted
  search/export; Reports API for usage; audit logs; user Takeout (create/
  schedule archive of personal data); admin can toggle Takeout on/off per OU/
  access group.** *Expected:* org-level export; targeted user search; usage/
  audit reports; user archive download; Takeout availability reflects admin
  policy. *v1:* out-of-v1 (admin-side; SuiteLeaf has no accounts).

---

# Part D — Google Workspace + Gemini (AI)
## D1. Source: *Prompting Guide 101: Google Workspace with Gemini* (Google, 71 pp)
Role-based prompting playbook + a prompt-writing "level up".

- **WF-D1-01 Use the Gemini app (Deep Research + Canvas).** Brainstorm → Deep
  Research → move to Canvas to iteratively refine → export to a Doc.
  *Expected:* research report generated then exported into an editable Doc.
  *v1:* out-of-v1 (AI + Gemini app not in SuiteLeaf).
- **WF-D1-02 Access Gemini via in-app help + AI-first tools (NotebookLM,
  Gemini app, Google Vids); voice-to-text.** *Expected:* features appear where
  embedded; voice-to-text transcribes. *v1:* out-of-v1.
- **WF-D1-03 Role workflows (each: prompt → expected AI output):**
  - **Administrative:** draft org communications, summarize policies, automate
    admin tasks. *Expected:* drafts/summaries match context. *v1:* out-of-v1.
  - **Communications:** create/draft messages, meeting notes, summaries.
  - **Customer service:** draft responses; organize customer info.
  - **Executives:** briefing/digest/strategy summaries.
  - **Frontline management:** planning/delegation helpers.
  - **Human resources:** onboarding/HR doc drafting.
  - **Marketing:** campaign copy/asset drafts.
  - **Project management:** status summaries, task decomposition.
  - **Sales:** personalize outreach; organize customer info; draft proposals.
  - **Level up prompt writing:** structured, iterative prompts → better output.
  *Expected:* each role's prompt yields an on-topic generated artifact.
  *v1:* out-of-v1 (SuiteLeaf has no Gemini/LLM integration).
- **WF-D1-04 Data-protection expectations (all role workbooks).** *Expected:*
  prompts + generated responses stay within the org and are **not used to train
  models**; existing security controls + data-handling processes apply
  automatically (Google AI Principles). *v1:* N/A — but **reinforces SuiteLeaf's
  design constraint**: SuiteLeaf is offline/local (no account, no cloud sync,
  no AI) so *no* user data leaves the device, matching this guarantee by
  construction. See `architecture.md`.

## D2. Source: Gemini role handbooks — Customer service / Sales / Marketing
Three ~17-page role handbooks.

- **WF-D2-01 (CS) Day-to-day use cases: draft response emails; organize
  customer information.** *Expected:* AI drafts a tailored response; customer
  data is organized/summarized. *v1:* out-of-v1.
- **WF-D2-02 (Sales) Personalize outreach; organize customer info; draft
  proposals.** *Expected:* personalized outreach + proposals generated.
  *v1:* out-of-v1.
- **WF-D2-03 (Marketing) Amplify impact: content/campaign asset generation.**
  *Expected:* generated marketing artifacts. *v1:* out-of-v1.
- **WF-D2-04 Best practices for collaborating with Gemini; data-protection
  section.** *Expected:* prompt discipline improves results; data stays private.
  *v1:* out-of-v1 (same offline guarantee as D1-04).

---

# Part E — NotebookLM
## E1. Source: *Comprehensive Guide to Google NotebookLM* (Zaid Al-Huda, 518 KB)
Screenshot-rich, per-chapter "one principle" guide from prompting to Studio.

- **WF-E1-01 Create a notebook + add sources.** *Expected:* a notebook holds
  multiple sources; each source is indexed. *v1:* out-of-v1.
- **WF-E1-02 Match source to objective; generate answers grounded in sources.**
  *Expected:* answers cite source passages (grounded, not hallucinated).
  *v1:* out-of-v1 (relevant idea to SuiteLeaf: "ground/verify output" principle).
- **WF-E1-03 Studio: custom audio/video outputs (podcasts, slides, mind maps,
  infographics).** *Expected:* generated Studio artifacts from the notebook.
  *v1:* out-of-v1.
- **WF-E1-04 Default settings → customize via instructions + prompting strategy.**
  *Expected:* per-chapter customization changes the output. *v1:* out-of-v1.

## E2. Source: *NotebookLM Mastery* (27 scenarios + prompt library + training)
- **WF-E2-01 Build a knowledge base (workflow).** Steps: (1) create a source
  inventory; (2) extract key ideas/definitions/frameworks/processes; (3) master
  theme map; (4) concept map; (5) framework map; (6) process map; (7) identify
  contradictions + missing info; (8) modular KB; (9) add checklists/templates/
  prompts/exercises; (10) source coverage + claim audit.
  *Expected:* a structured knowledge base with audited coverage. *v1:* out-of-v1
  (the **pattern** — inventory → extract → map → audit — maps onto a SuiteLeaf
  Docs/Sheets deliverable; see W19 report workflow).
- **WF-E2-02 Design a course (12 fields: title, promise, target learner, tracks,
  module/lesson structure, outcomes, exercises, assessments, final project,
  common mistakes, required templates, study schedule).** *Expected:* a
  complete course blueprint. *v1:* out-of-v1 (can be authored in SuiteLeaf Docs).
- **WF-E2-03 Write a book/long-form outline (working title → thesis → reader →
  section outline → main argument per section → supporting sources → contradictions
  → gaps).** *Expected:* a structured outline. *v1:* authorable in Docs.
- **WF-E2-04 Research/literature-review workflow (theme clusters, consensus vs
  dissent, methodologies + weaknesses, key evidence, gaps, research questions,
  outline).** *Expected:* a literature review. *v1:* authorable in Docs.
- **WF-E2-05 Generate exam/assessment items (beginner recall → intermediate
  application → expert questions that expose shallow understanding).**
  *Expected:* a tiered question set. *v1:* authorable in Docs/Sheets.
- **WF-E2-06 Turn material into a pitch/summary (3-sentence exec summary; key
  decisions; action-item table w/ owner + deadline; SOP with owner/tools/
  inputs/steps/QC/failure points/troubleshooting/escalation/checklist).**
  *Expected:* a summary + an SOP. *v1:* authorable in Docs/Sheets.
- **WF-E2-07 Prompt library (copy-paste, source-grounded).** *Expected:* each
  prompt yields a reproducible grounded output. *v1:* N/A.
  *Expected:* training course + 27 scenarios teach the workflows above.

## E3. Source: *Unleashing the Power of NotebookLM* (Wursta, 25 pp)
- **WF-E3-01 Understand NotebookLM; "NotebookLM in action"; tips & tricks.**
  *Expected:* capabilities demonstrated via examples. *v1:* out-of-v1.

---

# Part F — Apps Script / automation
## F1. Source: *Learning Google Apps Script* (RIP Tutorial / Packt, 55 pp)
- **WF-F1-01 Getting started: install/setup; types of scripts; run/debug.**
  *Expected:* a script runs from the editor; the debugger steps through.
  *v1:* out-of-v1.
- **WF-F1-02 Web Apps: build a web-app form.** *Expected:* a form UI triggers
  server-side script on submit. *v1:* out-of-v1.
- **WF-F1-03 Client calls to Apps Script.** *Expected:* external client invokes
  the script; returns data. *v1:* out-of-v1.

## F2. Source: *eBook Google Apps Script Complete* (Packt)
- **WF-F2-01 Learn Apps Script (JS-in-cloud): interact with the suite; build
  custom functionality; open the editor from Drive.** *Expected:* script code
  runs and mutates the relevant service. *v1:* out-of-v1.

## F3. Source: *Ultimate Guide to Google Sheets*, Ch. 7 (Apps Script tutorial)
- **WF-F3-01 First script in Sheets: build, explore the power, add triggers.**
  *Expected:* the script automates the sheet; a triggered script runs on events.
  *v1:* out-of-v1.

---

# Part G — Scanned / image-only references
## G1. Source: *The Complete Google User Manual*, 23rd ed. 2024 (scanned, OCR)
A consumer "digital magazine" PDF (OCR'd with limited fidelity). Feature/
privacy/tutorial sections across Google Home, Pixel, Chromebook, privacy guides,
free apps, mobile + desktop.

- **WF-G1-01 Set up / configure a device or service (per feature section).**
  *Expected:* a configuration change is applied and survives reboot. *v1:* N/A
  (consumer-device workflows; not in SuiteLeaf).
- **WF-G1-02 Run a privacy guide / tune privacy settings per feature.**
  *Expected:* the stricter privacy state is active. *v1:* N/A — but aligns with
  SuiteLeaf's offline/local-only data posture (no accounts, no sync).
- **WF-G1-03 Follow a step-by-step mobile/desktop tutorial.** *Expected:* the
  described end state is reached. *v1:* N/A.
  *Note:* full text is image-only and only partially OCR-able; treat as context,
  not a verbatim workflow source.

---

# Part H — Tying the manual workflows to SuiteLeaf v1
## H1. Cross-reference to SuiteLeaf's own docs
Entries `W1`–`W25` earlier in this file catalogue SuiteLeaf's *implementation*
behavior from `README.md`, `docs/`, `docs/architecture.md`,
`docs/office-imports.md`, `docs/sheets-workflow-validation.md`,
`docs/docs-parity.md`, `docs/excel-visual-parity.md`. A–G above catalogue the
*reference-book* workflows that motivate v1 scope. The matrix below maps book
workflows → v1 status.

## H2. v1 support matrix (consolidated)
| Capability | Book workflow refs | SuiteLeaf v1 |
| --- | --- | --- |
| Create / rename / search / duplicate / remove / import / export files | A1-01, A2-01, A4-03, B2-06 | **Yes** |
| Native `.suiteleaf` save + autosave + atomic/recovery save | A4-03, B2-05 | **Yes** (local IndexedDB; desktop atomic save + recovery) |
| Docs: rich text, headings/outline, fonts/sizes/colors/highlight/align, lists, links, images, tables, find/replace, word count, spellcheck, undo/redo, print/PDF | A1-12/14, A2-07/09/10, A4-10/16/18/19/27 | **Yes** (core); translation, Docs comments, cite → **deferred**; local pagination and text page furniture are implemented |
| Sheets: multi-sheet, formulas, number/date formats, merged cells, fill, clipboard, freeze, sort/filter, find/replace | A1-?, A2-12/13, B1/B2 | **Yes** (core) |
| Charts: col/bar/line/pie/scatter; move/resize/refresh | A2-05, A1-15, B1-08, B1-13 | **Yes** |
| Pivots: SUM/COUNT/AVERAGE/MIN/MAX + equality filter; refresh; copy | B1-08, B2-13 | **Yes** |
| Slides: layouts, backgrounds, rich text, shapes, images, tables, notes, fullscreen show; PPTX/PPT/PPTX-M/POTX/PPTM/PPSX/PPSM import | A1-15, A2-14, W12/W13 | **Yes** |
| Office import: DOCX, XLSX/XLSM/XLTX/XLS/XLSB, PPTX family → `.suiteleaf` | A1-15, W15/16/17 | **Yes** |
| Delimited import CSV/TSV (preview, header, type inference) | B2-07, B1-08 | **Yes** |
| Exports: HTML/text (docs), CSV/TSV (sheets) | B2-12 | **Yes** |
| DOCX/XLSX export | A2-?, B2-12, W4 | **Yes** (local export; see `office-imports.md` for format limits) |
| Live pagination / page furniture | A1-14, A4-12 | **Yes** (Letter/A4, landscape/margins, text headers/footers, page fields, manual breaks) |
| Accounts, cloud sync, shared/real-time editing, version history, notifications, cell change monitoring | A1-19, A2-11, B2-12 | **Out-of-v1** |
| Data validation, conditional formatting, protect ranges/sheets, tab group/color/hide, notes/local comments | A2-13, B2-10/11 | **Yes** (local editor resources and protection) |
| Alternating colors and spreadsheet settings | A2-13, B2-10/11 | **Out-of-v1** |
| Web import (URL/feeds), image-from-URL, publish/embed, add-ons/extensions, templates store, folders, trash/restore | A2-13, A4-06/08, B1-05..09, B2-14 | **Out-of-v1** |
| Gmail / Calendar / Contacts / Meet / Chat / Groups / Forms / Sites / Keep / Tasks / Gemini / NotebookLM / Apps Script / admin/DSR | A1, A3, A5, C, D, E, F, G | **Out-of-v1** (consumer/AI/role workflows not in Scope) |

## H3. What "expected behavior" should mean for each workflow
- **Reference-book workflows (A–G):** *expected behavior* = the observable
  outcome the book claims (per WF-<n> "Expected"). These are **scope drivers**,
  not promises about SuiteLeaf.
- **SuiteLeaf workflows (W1–W25):** *expected behavior* = what the current build
  actually does or what its tests assert (Chromium/WebKit browser tests,
  `office-corpus`, the Excel-visual parity audit). "Clean round" = zero observed
  differences among *completed* shared checkpoints; untested ≠ passing; a missing
  comparison is *never* a passing review.
- **Offline/local design constraint:** because SuiteLeaf has no accounts, no
  sync, and no AI, every "data-protection" expectation in D1-04/D2-04 and
  G1-02 is satisfied **by construction** — no user data leaves the device
  (see `architecture.md`).

## H4. Newly implemented to fill catalogued gaps
These features were **"out-of-v1" / not fully supported** in the matrix above and
were **added in this pass** with pure-logic modules, UI wiring, and unit tests.

- **WF-A2-12 / WF-B2-09 — "More formats" number & date catalog (Sheets).** The
  toolbar's *More formats* button was a no-op (`onClick={() => {}}`). It now
  opens a grouped dropdown (**Number / Percent / Date & time**) of ~14 named
  formats (Currency, Accounting, Percentage, Date, Time, …). Selecting one
  applies its Excel/Univer number-format *code* to the active range via
  `setNumberFormat`; the format persists through the native `.suiteleaf`
  snapshot (the workbook schema is pass-through, so Univer-native styles and
  tab state are retained) and reopens unchanged. Logic lives in
  `apps/web/src/formats.ts` (`NUMBER_FORMATS`, `numberFormatById`,
  `numberFormatsByGroup`, `applyNamedFormat`); verified by
  `tests/sheet-formats.test.ts` (catalog integrity, uniqueness, code validity,
  apply/unknown-id behavior). **Expected behavior:** choosing a format changes
  only the display (values unchanged); a code applied to a currency range shows
  like `$1,200.00`; an unknown id is a no-op.

- **WF-A4-22 — "Linking within a document" + internal heading anchors (Docs).**
  Added `apps/web/src/anchors.ts` (`slugify`, `uniqueSlug`, `isInternalAnchor`,
  `anchorHref`, `assignHeadingAnchors`). Each outline entry is now a stable,
  document-unique slug (deduped as `intro`, `intro-1`, …). A **copy link**
  button per heading copies `#<slug>` to the clipboard; clicking an internal
  `#anchor` link in the document body (handled via Tiptap `handleDOMEvents`
  `click`) scrolls to and selects the matching heading. Verified by
  `tests/doc-anchors.test.ts` (slug NFKD/accent stripping, dedupe,
  internal-anchor recognition, tree id assignment). **Expected behavior:**
  duplicate heading texts map to distinct anchors; a `#anchor` link navigates
  within the document; external/`https` links are left for the browser.

**Verification:** `npm run typecheck`, `npm run build:web`, and `npm test` all
pass (102 unit tests, incl. the two new suites); no new ESLint problems were
introduced (the 4 pre-existing lint items on `HEAD` were unchanged).

**Still out-of-v1 by design** (cloud / real-time / AI): Google-specific apps
(Gmail, Calendar, Contacts, Meet, Chat, Groups, Forms, Sites, Keep, Tasks),
Gemini/NotebookLM AI, cloud accounts and shared editing. The local editor
features listed in the implementation note below are now available.

*End of manual-derived workflow catalogue.*

### Local editor feature implementation

The prior deferrals above are superseded for sheet data validation, conditional formatting, cell notes/local comment threads, removable sheet/range protection, tab hide/show/color/grouping, Docs live pagination/page furniture, and DOCX/XLSX export. Native saves retain editor resources and tab groups. Use the Sheets Data/Format/Insert menus or **Sheet tools**, and Docs **Page setup** / **Page break** controls. Office export is available from **File**. These features do not require accounts, AI, a server, or a Univer fork. Cloud collaboration, shared accounts and AI workflows remain outside this implementation. See `docs/office-imports.md` for conversion limits.
