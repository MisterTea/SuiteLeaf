# SuiteLeaf

An open source workspace for documents and spreadsheets, written in React and TypeScript. Run the same editors as a static website or an Electron desktop application. Apache-2.0 licensed, with permissive production dependencies and no required account or paid editor service.

## Run locally

Use Node.js 22.12+ (Node 24 recommended) and npm.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. For the desktop app:

```sh
npm run setup:electron
npm run dev:desktop
```

`setup:electron` downloads the platform-specific Electron binary. It is useful when npm’s install-script settings prevent Electron’s normal installation hook.

## What works

- **Files:** create, rename, search, duplicate, remove, import, export, and original sample files.
- **Office import:** load `.docx` and `.xlsx` through **Open / import** in the browser or native desktop file dialog. Conversion runs in a worker, produces an editable SuiteLeaf copy, and retains compatibility notes with the file. Original Office files remain unchanged.
- **Docs:** continuous rich-text editing; headings and outline; fonts, sizes, colors, highlighting, alignment, lists, links, images, tables with selectable dimensions, find/replace with single replacement, backward navigation and search options, word count, spellcheck, undo/redo, and printing.
- **Sheets:** multiple worksheets; formulas and references; formatting; number/date formats; merged cells; fill, clipboard, row/column operations, freezing, sorting, filtering, and find/replace, through Univer’s open source editor.
- **Charts:** embedded column/bar, line, pie, and scatter charts. Select a range with headers, then **Insert chart**. Move and resize on the grid; edit or remove using **Charts & pivots**. Charts update from calculated source values.
- **Pivots:** select row/column/value fields, an optional equality filter, and SUM/COUNT/AVERAGE/MIN/MAX. Results appear in a protected worksheet. Use **Charts & pivots → Refresh** after changing source data, or **Copy** to create an editable worksheet.
- **Slides:** multi-slide presentations with thumbnail reordering, slide layouts (Title, Title & Body, Two Column, Section, Blank), customizable slide backgrounds, rich text formatting, shapes (rectangles, rounded rectangles, ellipses), image insertion, tables, speaker notes, and a fullscreen slide show presentation mode.
- **PowerPoint import:** native, offline import of `.pptx`, `.ppt`, `.ppsx`, `.pptm`, `.potx`, and `.ppsm` files from disk or drag-and-drop, preserving slide dimensions, shape and text styles, bullet hierarchies, tables, and speaker notes into valid `.suiteleaf` presentations.

Native `.suiteleaf` files preserve supported document content, embedded images, workbook formulas/styles, chart placement, pivot definitions, and presentation slides. Both platforms read the same versioned format. DOCX/XLSX export, live document pagination, accounts, cloud sync, and shared editing are deferred.

## Saving and portability

The website autosaves locally in the browser using localForage (IndexedDB with fallback) on the current browser/device and origin. **Download** saves a portable `.suiteleaf` copy; **Open / import** restores it. A second tab cannot edit a file already open in another tab. Browser data is local: download copies before clearing site data or moving between devices.
An online demo is hosted via GitHub Pages at https://mistertea.github.io/SuiteLeaf/ .

Electron starts new files as recovery drafts. After **Save As**, changes autosave to that regular file. File writes are serialized and replaced atomically. If another program changes the file, SuiteLeaf keeps a recovery draft and offers **Reload saved** or **Save As** instead of overwriting the external change. Removing a desktop recent-file entry also removes its recovery draft; the saved file stays on disk. Recovery data lives in the application’s user-data directory under `library/library.json`.

Use **File → Export** for HTML/plain text documents or CSV/TSV spreadsheets. Delimited imports preview their delimiter and rows, retain the header row, infer ordinary numbers and booleans, and preserve formulas, leading-zero identifiers, and high-precision numbers as text. CSV/TSV exports contain the active worksheet’s calculated values; formula-looking text receives a protective apostrophe. HTML imports sanitize executable content and accept embedded images only. Image uploads support PNG/JPEG/GIF/WebP up to 5 MB; Office inputs are limited to 120 MB; native inputs to 200 MB; other imports to 50 MB; CSV ranges to 200,000 cells. Office packages may expand to 1 GB, and spreadsheet imports allow up to 10 million stored cells and 100 MB of cell text. Files outside these limits produce explicit capacity errors.

**File → Print / Save as PDF** prints documents or a table of the active worksheet with its visible charts. Spreadsheet printing is limited to 10,000 cells. Browser or operating-system print dialogs provide PDF output. On desktop, when no printer is available, the command opens a PDF save dialog and generates the PDF directly.

## Build and host

```sh
npm run notices
npm run build
```

Serve `apps/web/dist/` from any static HTTPS host, at the domain root or a subdirectory. Routes use URL fragments, so a server-side route rewrite is unnecessary. The production service worker caches application assets for offline use after its first successful installation. Development mode does not install a service worker. Hosting the website does not create a shared server-side file library.

Desktop bundles are generated in `apps/desktop/out/`. Build unsigned installers on their native operating systems:

```sh
npm run package:desktop
```

Outputs appear in `apps/desktop/release/`: macOS DMG/ZIP, Windows NSIS, and Linux AppImage/DEB. CI has an operating-system matrix for all three. macOS signing/notarization, Windows signing, automatic updates, and publishing are not configured. Run `npm run build:desktop` again before packaging source changes.

## Development and checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium firefox webkit
npm run test:e2e
npm run test:electron
npm run test:office-corpus
```

macOS runs Chromium and WebKit by default. Firefox is included on Linux/Windows and can be enabled on macOS with `SUITELEAF_TEST_FIREFOX=1`; the current macOS Firefox launcher has an [upstream profile-access issue](https://github.com/microsoft/playwright/issues/42768). Offline tests stop a real server because WebKit’s offline emulation has an [upstream service-worker issue](https://github.com/microsoft/playwright/issues/42775).

`test:office-corpus` requires the local downloaded `datasets/` and imports every inventoried DOCX/XLSX into the real shared converter, validates the native round trip and original hash, and writes per-file JSONL plus a summary. The runner isolates conversions, enforces timeouts, and freezes converter sources for reproducibility. Local corpus browser tests skip when their third-party fixtures are absent; generated fixtures always run in CI.

Linux Electron tests need a graphical display; CI uses `xvfb-run --auto-servernum npm run test:electron`. Playwright tests use isolated browser storage and temporary desktop data, covering editing, formulas, charts/pivots, import sanitization, offline reload, concurrent-tab protection, native saves, conflicts, and recovery. `npm run format` formats application sources and tests.

The repository uses npm workspaces: `apps/web` is the shared React UI, `apps/desktop` is the Electron main/preload wrapper, and `packages/core` contains the file schema and platform contracts. Heavy editors load independently. See [architecture](docs/architecture.md) and [reference workflow coverage](docs/workflows.md).

## Dependencies and references

Office imports use Mammoth (BSD-2-Clause), SheetJS Community 0.20.3 from its official distribution (Apache-2.0), JSZip, fast-xml-parser, and htmlparser2. Word pagination/floating objects and some Excel features differ; see [Office compatibility and corpus validation](docs/office-imports.md). Docs uses Tiptap/ProseMirror. Sheets uses Univer’s Apache-2.0 packages; charts use Recharts and pivots use Arquero. Radix supplies menus, localForage supplies browser client storage, Papa Parse handles delimited files, DOMPurify sanitizes HTML, and Zod validates native files. DOMPurify’s Apache-2.0 license option is selected. See [third-party notices](THIRD_PARTY_NOTICES.md).

The books in `docs/` guide workflow selection and test scenarios. They remain local reference files, are gitignored, and are excluded from application and installer bundles. SuiteLeaf includes original branding, sample content, and code.
