# SuiteLeaf

An open source workspace for documents and spreadsheets, written in React and TypeScript. Run the same editors as a static website or an Electron desktop application. Apache-2.0 licensed, with permissive production dependencies and no required account or paid editor service.

SuiteLeaf runs in one of two modes:

- **Single-node mode (default).** Like LibreOffice or desktop Office: you read and write files on your own computer. There are no accounts, no shared storage, and nothing to sign in to. The desktop app saves to files on disk. The web app, including the [online demo](https://mistertea.github.io/SuiteLeaf/), saves in this browser's storage.
- **Cluster mode.** Like Microsoft 365 or Google Workspace: people sign in, and files live in SuiteDrive, a shared drive for all users. A cluster is one or more self-hosted SuiteLeaf servers that keep a fully synced copy of every account and file. The web and desktop apps are clients that connect to one server.

The web app is in cluster mode when a SuiteLeaf server serves it. The desktop app and a statically hosted web app start in single-node mode, and **Connect to a server** switches them to cluster mode. The online demo is always in single-node mode.

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
- **Office import:** load `.docx` and Excel `.xlsx`, `.xls`, `.xlsm`, `.xlsb`, and `.xltx` through **Open / import** in the browser or native desktop file dialog. Conversion runs in a worker, produces an editable SuiteLeaf copy, and retains compatibility notes with the file. Binary Excel formatting and features can differ; macros are not executed or imported. Original Office files remain unchanged.
- **Docs:** continuous rich-text editing; headings and outline; fonts, sizes, colors, highlighting, alignment, lists, links, images, tables with selectable dimensions, find/replace with single replacement, backward navigation and search options, word count, spellcheck, undo/redo, and printing. Live pages support Letter/A4 paper, landscape, margins, repeated text headers/footers, a different first page, page numbers, a text watermark, zoom, and manual page breaks through **Page setup**. **File → Export DOCX** writes an editable Word document. The outline gives each heading a stable, deduplicated anchor slug and a **copy link** button; clicking an internal `#anchor` link scrolls to its heading (see `apps/web/src/anchors.ts`).
- **Sheets:** multiple worksheets; formulas and references; formatting; number/date formats; a **More formats** catalog (Currency, Accounting, Percentage, Date, Time, … — `apps/web/src/formats.ts`) applied to the active range; merged cells; fill, clipboard, row/column operations, freezing, sorting, filtering, and find/replace, through Univer’s open source editor. **Sheet tools** adds data validation (including dropdowns and checkboxes), conditional formatting, local cell notes and comment threads, and tab hide/show/color/group controls. Local sheet/range protection prevents accidental edits and can be removed from the same panel. **File → Export XLSX** exports every worksheet with formulas, cached values, styles, drawings, and supported rule resources.
- **Charts:** embedded column/bar, line, pie, and scatter charts. Select a range with headers, then **Insert chart**. Move and resize on the grid; edit or remove from **Data → Charts & pivots**. Charts update from calculated source values.
- **Pivots:** select row/column/value fields, an optional equality filter, and SUM/COUNT/AVERAGE/MIN/MAX. Results appear in a protected worksheet. Use **Data → Charts & pivots → Refresh** after changing source data, or **Copy** to create an editable worksheet.
- **Slides:** multi-slide presentations with thumbnail reordering, slide layouts (Title, Title & Body, Two Column, Section, Blank), customizable slide backgrounds, rich text formatting, shapes (rectangles, rounded rectangles, ellipses), image insertion, tables, speaker notes, and a fullscreen slide show presentation mode.
- **Accounts (cluster mode):** sign in with email or username and password, Google, GitHub, or Nextcloud. Accounts and sessions replicate to every server in the cluster.
- **SuiteDrive (cluster mode):** browse folders and create, open, and save documents, spreadsheets, and presentations from any server. Files and version history replicate to every server. Edits autosave to SuiteDrive, and a conflicting edit from another device offers **Reload from SuiteDrive** or **Save as copy**. Folders and files can be shared with users or organizations.
- **PowerPoint import:** native, offline import of `.pptx`, `.ppt`, `.ppsx`, `.pptm`, `.potx`, and `.ppsm` files from disk or drag-and-drop, preserving slide dimensions, shape and text styles, bullet hierarchies, tables, and speaker notes into valid `.suiteleaf` presentations.

Native SuiteLeaf files are JSON with a distinct extension per kind: `.sldoc` for documents, `.slsheet` for spreadsheets, `.slslides` for presentations, and `.sldraw` for drawings (older `.suiteleaf` files still open). See [file format](docs/file-format.md). They preserve supported document content, embedded images, workbook formulas/styles, chart placement, pivot definitions, and presentation slides. Both platforms read the same versioned format. Page settings, rule resources, comments/notes, protection and tab groups also survive native saves. DOCX/XLSX exports run locally on both platforms. Real-time shared editing remains deferred; comments are local to the file.

## Saving and portability

In single-node mode, the website autosaves locally in the browser using localForage (IndexedDB with fallback) on the current browser/device and origin. **Download** saves a portable `.sldoc`, `.slsheet`, `.slslides`, or `.sldraw` copy; **Open / import** restores it. A second tab cannot edit a file already open in another tab. Browser data is local: download copies before clearing site data or moving between devices.
An online demo is hosted via GitHub Pages at https://mistertea.github.io/SuiteLeaf/. It is built with `VITE_SUITELEAF_DEMO=1`, which locks it to single-node mode with browser storage.

Electron starts new files as recovery drafts. After **Save As**, changes autosave to that regular file. File writes are serialized and replaced atomically. If another program changes the file, SuiteLeaf keeps a recovery draft and offers **Reload saved** or **Save As** instead of overwriting the external change. Removing a desktop recent-file entry also removes its recovery draft; the saved file stays on disk. The local registry and recovery drafts live in `~/.config/suiteleaf/library.sqlite`; settings live beside it in `settings.json`. Existing JSON registry data and settings are migrated automatically, preserving the originals. The SQLite database stays local when the document directory is a cloud-synced folder.

In desktop single-node mode, **Settings → Document directory → Choose folder** selects the folder shown in the library and used by **Save As**. It defaults to `~/Documents/SuiteLeaf`. SuiteLeaf scans its subfolders and watches for files and folders added, changed, renamed, or removed. **All files** shows that folder's folders: open one from its row or the path above the list, and use **New folder**, a folder's **Rename** and **Move**, or a file's **Move to folder** (or drag files and folders onto a folder or the path). Each of these changes the folders on disk. A new or imported file made while a folder is open is written into that folder. Folders made, renamed, moved, or deleted in Finder or File Explorer show up within moments. Choose a locally synced Google Drive or Dropbox folder to let that service sync saved documents. Changing the directory leaves existing files in place; use **Save As** to move a working copy into the selected folder. Recovery drafts remain in the library.

Use **File → Export** for HTML/plain text documents or CSV/TSV spreadsheets. Delimited imports preview their delimiter and rows, retain the header row, infer ordinary numbers and booleans, and preserve formulas, leading-zero identifiers, and high-precision numbers as text. CSV/TSV exports contain the active worksheet’s calculated values; formula-looking text receives a protective apostrophe. HTML imports sanitize executable content and accept embedded images only. Image uploads support PNG/JPEG/GIF/WebP up to 5 MB; Office inputs are limited to 120 MB; native inputs to 200 MB; other imports to 50 MB; CSV ranges to 200,000 cells. Office packages may expand to 1 GB, and spreadsheet imports allow up to 10 million stored cells and 100 MB of cell text. Files outside these limits produce explicit capacity errors.

**File → Print / Save as PDF** prints documents or a table of the active worksheet with its visible charts. Presentations print the complete deck, with one full-size slide per page, including slide backgrounds, master artwork, slide numbers, and all animation content. The selected slide stays unchanged. Spreadsheet printing is limited to 10,000 cells. Browser or operating-system print dialogs provide PDF output. On desktop, when no printer is available, the command opens a PDF save dialog and generates the PDF directly.

## Cluster mode: SuiteLeaf servers

A server (also called a node) is the `suiteleaf-node` Rust binary plus a better-auth sidecar. It serves the web app in cluster mode, the SuiteDrive API, and sign-in, and it replicates its database ([SuiteDB](docs/suitedb.md)) and files to the other servers over libp2p. Every server stores a complete copy of all accounts and files, so only run servers on machines you trust. See [architecture](docs/architecture.md#nodes-suitedb-auth-and-suitedrive).

Run a node locally with Rust (stable) installed:

```sh
npm run build:web && npm run build:auth
cargo run -p suiteleaf-node -- init --data-dir node-a
export SUITELEAF_AUTH_SECRET=$(openssl rand -hex 32)   # identical on every node
cargo run -p suiteleaf-node -- run --data-dir node-a --web-root apps/web/dist
```

Open http://127.0.0.1:8787 and create an account. To add a second node to the same cluster, give it a copy of the first node's `swarm.key` and the address the first node prints in its `SUITELEAF_NODE_READY` line:

```sh
cargo run -p suiteleaf-node -- init --data-dir node-b --swarm-key node-a/swarm.key
cargo run -p suiteleaf-node -- run --data-dir node-b --http 127.0.0.1:8788 \
  --listen /ip4/127.0.0.1/tcp/4002 --web-root apps/web/dist \
  --bootstrap /ip4/127.0.0.1/tcp/4001/p2p/<node-a peer id>
```

[`deploy/`](deploy) has a Dockerfile and a three-node `docker compose` cluster (`cd deploy && ./init-cluster.sh && docker compose up --build`). Options can also go in a TOML file passed with `--config`:

| Setting | Meaning |
| --- | --- |
| `data_dir` | Holds `identity.key`, `swarm.key`, `suitedb.sqlite`, and `blobs/`. |
| `http_addr` | The HTTP listener for the web app and APIs. |
| `public_url` | The URL browsers use for this node. OAuth callbacks are built from it. |
| `listen` | libp2p listen addresses. |
| `bootstrap` | Peers to keep connected, as `/ip4/…/tcp/…/p2p/<peer id>`. |
| `allowlist` | Peer IDs allowed to connect and author changes. Empty means anyone with the swarm key. |
| `mdns` | Discover peers on the local network. |
| `web_root` | A built web app to serve. |
| `cors_origins` | Other origins that may call the API, such as `suiteleaf://app` or a separately hosted web build. |
| `[auth]` | The sidecar `command`, an external sidecar `url`, a shared `secret`, and extra sidecar `env`. |

To enable social sign-in, set these in the node's environment and register `<public_url>/api/auth/callback/<provider>` (`google`, `github`, or `nextcloud`) as the redirect URI with each provider.

- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
- `NEXTCLOUD_URL`, `NEXTCLOUD_CLIENT_ID`, and `NEXTCLOUD_CLIENT_SECRET`

To use the desktop app as a client, choose **Server → Connect to a SuiteLeaf server…** and enter the server's address. **Server → Disconnect** returns it to single-node mode; files on the computer are untouched, and SuiteDrive files stay on the server. A web build hosted elsewhere can connect the same way if the server lists its origin in `cors_origins`.

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

Outputs appear in `apps/desktop/release/`: macOS DMG/ZIP, Windows NSIS, and Linux AppImage/DEB. CI has an operating-system matrix for all three. On macOS the app is signed ad hoc, and a local package also replaces `/Applications/SuiteLeaf.app` with the new build; set `SUITELEAF_SKIP_INSTALL=1` to leave it alone (CI never installs). Notarization with a Developer ID, Windows signing, automatic updates, and publishing are not configured. Run `npm run build:desktop` again before packaging source changes.

The desktop executable includes a directory importer:

```sh
# Linux (installed executable, or substitute the AppImage path)
suiteleaf import /path/to/source

# macOS
/Applications/SuiteLeaf.app/Contents/MacOS/SuiteLeaf import /path/to/source

# Choose a different output folder
suiteleaf import /path/to/source --output /path/to/SuiteLeaf

# Usage and supported formats
suiteleaf import --help
```

On Windows, run `SuiteLeaf.exe import C:\path\to\source` from the installation directory. In a source checkout, build the desktop app and run `npx electron apps/desktop/out/main/index.js import /path/to/source`.

The importer runs without opening a window and scans subfolders for Office, OpenDocument, RTF, native SuiteLeaf, Markdown, HTML, text, CSV, TSV, SVG, Mermaid (`.mmd`, `.mermaid`), and Graphviz (`.gv`) files. Output defaults to the **Document directory** in Settings (`~/Documents/SuiteLeaf` initially). Subfolder structure is preserved; source files stay untouched, and naming collisions receive numbered suffixes. Markdown imports produce MARP presentations with available local pictures embedded. SVG, Mermaid, and Graphviz imports produce drawings that keep the source exactly as written. CSV/TSV imports use the same automatic type and header detection as the app. Hidden files, symlinks, and unsupported formats are skipped. Importing again creates additional copies.

Saved output appears in the desktop library through its directory watcher or the next startup scan. An explicit `--output` folder appears there when it is the selected document directory. The command reports totals and individual failures, continuing with remaining files. Exit status is **0** on success, **1** when individual files fail, and **2** for invalid arguments or an inaccessible source directory.

## Development and checks

```sh
npm run typecheck
npm run lint
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo build -p suiteleaf-node && npm run build:auth
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

The repository uses npm workspaces and a Cargo workspace:

- `apps/web` is the shared React UI.
- `apps/desktop` is the Electron main/preload wrapper.
- `packages/core` contains the file schema and platform contracts.
- `services/auth` is the better-auth sidecar.
- `crates/` holds the node: `suiteleaf-net`, `suitedb`, `suitedrive`, and `suiteleaf-node`.

`npm test` includes better-auth's adapter test suite, run against a real node. `tests/browser/suitedrive.spec.ts` starts two nodes and checks saving, cross-node opening, and conflict handling in the browser. Both need `cargo build -p suiteleaf-node` and `npm run build:auth` first. Heavy editors load independently. See [architecture](docs/architecture.md) and [reference workflow coverage](docs/workflows.md).

## Dependencies and references

Office imports use Mammoth (BSD-2-Clause), SheetJS Community 0.20.3 from its official distribution (Apache-2.0), JSZip, fast-xml-parser, and htmlparser2. Word pagination/floating objects and some Excel features differ; see [Office compatibility and corpus validation](docs/office-imports.md). Docs uses Tiptap/ProseMirror. Sheets uses Univer’s Apache-2.0 packages; charts use Recharts and pivots use Arquero. Nodes use rust-libp2p, SQLite through rusqlite, axum, and BLAKE3. Accounts use better-auth. Radix supplies menus, localForage supplies browser client storage, Papa Parse handles delimited files, DOMPurify sanitizes HTML, and Zod validates native files. DOMPurify’s Apache-2.0 license option is selected. See [third-party notices](THIRD_PARTY_NOTICES.md).

The books in `docs/` guide workflow selection and test scenarios. They remain local reference files, are gitignored, and are excluded from application and installer bundles. SuiteLeaf includes original branding, sample content, and code.
