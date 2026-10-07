# Architecture

SuiteLeaf v1 has no backend. A React renderer is shared by Vite’s static build and electron-vite’s renderer build. Hash routing supports arbitrary static hosts and the desktop `suiteleaf://app/` protocol. The home screen loads file metadata; editor modules are loaded only when a document or spreadsheet opens.

## Portable files

`packages/core` defines the version-1 `.suiteleaf` JSON envelope: `format`, `version`, `id`, `kind`, `title`, `createdAt`, `updatedAt`, and `content`. Docs content is Tiptap JSON with embedded image data. Sheets content includes a Univer workbook snapshot, chart definitions, and pivot definitions. Editor snapshots retain their native styles, formula expressions/results, plugin resources, and worksheet IDs. Definitions reference worksheets by ID rather than their editable names.

Zod validates the envelope and essential workbook/cell structure. Native imports reject newer versions, malformed ranges, missing worksheets, unsafe document links, and external image references before persistence. Version 1 is the initial schema; future incompatible changes must introduce an explicit migration. JSON exports are portable data, not executable editor extensions.

## Storage and save ordering

`StorageAdapter` provides `list`, `get`, `save`, `remove`, `open`, `saveAs`, and `reload`. Browser storage uses Dexie/IndexedDB with indexed metadata and bounded native JSON chunks. Atomic migrations preserve existing version-1 files; large JSON is split into 4 MB IndexedDB chunks with metadata committed in the same transaction. Storing JSON avoids expensive browser structured-clone traversal over millions of cell objects. Electron’s typed `DesktopBridge` adds native exports, printing, menu events, and dirty-state notifications. The renderer cannot authorize arbitrary filesystem paths: native dialogs and the main-process recent-file catalog determine writable locations.

Editor changes update an in-memory file, followed by a debounced save. Explicit saves flush pending spreadsheet snapshots. A save queue preserves ordering and prevents failed writes from poisoning subsequent retries. Saved status corresponds to completed persistence and the latest edit revision. Browser Web Locks prevent concurrent editing of a single file in separate tabs.

The desktop catalog also serves as recovery storage. Before replacing a file, the main process persists its draft, checks the file’s SHA-256 fingerprint, writes a temporary sibling file, fsyncs it, and renames it over the original. Conflicts and missing originals preserve the draft. Save As writes to a user-approved new path; reload deliberately discards the draft in favor of the current disk file.

## Editors and analysis

Tiptap implements document editing and ProseMirror history; SuiteLeaf supplies the office toolbar, outline, find/replace, and format imports/exports. Documents use continuous layout and native print pagination.

Univer owns cell rendering, formula calculation, selection, clipboard, formatting, sorting/filtering, and its normal undo/redo history. SuiteLeaf persists workbook snapshots after mutations. Its custom chart components use the open source floating-DOM API, with Recharts rendering calculated source values. Source ranges adjust after row/column insertions and deletions; deleted sources are marked invalid. Sources use fixed inclusive rectangles rather than entire-column references.

Pivots use Arquero aggregation with named field selections. Numeric aggregates ignore nonnumeric values; COUNT counts nonempty value entries. Empty grouping fields form a blank group, and absent intersections are blank cells. An equality filter precedes aggregation. Source filters in the grid do not restrict the analysis range. Pivot results refresh explicitly and are protected against ordinary editing; an editable copy detaches its values from the definition.

## Desktop and distribution

Electron runs a sandboxed renderer with Node integration disabled and context isolation enabled. The main process validates IPC provenance and native file content. A scoped protocol serves bundled assets, navigation is restricted, and only clipboard permissions needed by the trusted editor are allowed. The content policy permits local assets, inline styles required by editors, and JavaScript evaluation required by spreadsheet/data engines; imported document content is sanitized and cannot supply scripts.

Production dependency notices accompany web assets and desktop packages. Books and research materials are excluded. Static hosting does not provide user accounts or cross-device synchronization. Signing, notarization, deployment, and automatic updates remain separate release tasks.

## Office conversion

`@suiteleaf/core/office` is the shared DOCX/XLSX conversion boundary. It checks package signatures, encryption, required parts, XML and expansion limits before producing a version-1 native file. Browser imports run in a dedicated module worker; Electron imports run in a Node worker. Native Open converts Office files into recovery drafts; Save As writes `.suiteleaf` and never replaces the DOCX/XLSX original. Compatibility information is stored in optional `importInfo` metadata and displayed in the editor.

Mammoth handles Word semantics, while a whitelist HTML-to-Tiptap adapter strips executable markup and unsafe links. Original body paragraphs are audited against the resulting text; missing paragraphs are recovered into a labelled section. Deeply nested layout can fall back to editable paragraphs. Header/footer text is appended as labelled sections. Supported raster images are embedded; unsupported image formats are labelled and reported.

SheetJS supplies cell types, Unicode, shared/array formulas and caches. OOXML styles and worksheet metadata provide fonts, fills, borders, alignment, number formats, dimensions, merges, hidden sheets, frozen panes, the date system and named ranges. Dense parsing and releasing source cell structures keep large imports within bounded memory. ZIP headers are normalized through JSZip and a Pako adapter replaces the spreadsheet library’s inflater to avoid hangs on valid archive layouts. Spreadsheet cell validation checks the graph in place rather than deep-cloning millions of cells during every native save. Basic charts are recreated when their cell ranges are representable; unsupported Excel features are recorded rather than claimed as preserved.

Corpus verification uses the identical converter and native validator in isolated processes, with immutable source snapshots and per-file original hash checks. Successful conversion/native round trip is distinct from visual or calculation parity with Word/Excel. Corrupt/encrypted rejection, capacity rejection and unexpected failure have separate result categories.
