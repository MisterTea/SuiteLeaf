# Agent Notes & Developer Guide

## Project Overview

SuiteLeaf is an open-source productivity suite and collaborative workspace for documents, spreadsheets, presentations, vector drawings, forms, and mail. It provides high-fidelity Microsoft Office compatibility (DOCX, XLSX, PPTX) alongside local-first and decentralized collaborative capabilities.

### Architecture & Runtime Modes
The codebase operates across three runtime modes (configured in `apps/web/src/mode.ts`):
1. **Serverless Mode:** Runs entirely in the browser (e.g., demo deployments). Persistence uses local IndexedDB via Dexie/localForage; AI runs locally in WebGPU/WebAssembly via web workers.
2. **Single-Node (Desktop) Mode:** Standalone Electron desktop application. Files are saved directly to the local filesystem with an SQLite index (`~/.config/suiteleaf/library.sqlite`); local AI inference runs via `node-llama-cpp` or upstream OpenAI-compatible endpoints.
3. **Cluster Mode:** Enterprise and team collaboration deployment. Web and desktop clients connect to a `suiteleaf-node` server binary written in Rust. Nodes replicate accounts, access controls, and documents over a private libp2p peer-to-peer swarm using SuiteDB (distributed CRDT op-log) and SuiteDrive (content-addressed block storage).

---

## Codebase Sourcemap & Directory Organization

Use this directory map to navigate directly to relevant files without scanning the filesystem:

```
SuiteLeaf/
├── apps/
│   ├── web/                     # Vite + React 19 frontend (used by browser & desktop renderer)
│   │   ├── src/editors/         # Document, spreadsheet, slide, drawing, & form editors
│   │   │   ├── doc-*            # Docs editor (Tiptap/ProseMirror, pagination, footnotes, styles)
│   │   │   ├── sheet-*          # Sheets editor (Univer core, formulas, cells, validation)
│   │   │   ├── slide-*          # Slides editor (slides, layouts, Marp sync, animations)
│   │   │   ├── chart-*          # Embedded charts (Recharts) & pivot tables (Arquero)
│   │   │   ├── drawing-*        # Canvas drawings & SVG vector tools
│   │   │   └── form-*           # Form designer and response grids
│   │   ├── src/ai/              # Web client AI assistant (WebGPU, transformers.js, streaming)
│   │   ├── src/drive/           # SuiteDrive frontend (file browser, upload queue, sharing/ACLs)
│   │   ├── src/collab/          # Real-time multi-user collaboration & cursor presence
│   │   ├── src/admin/           # Cluster admin console (tenants, roles, node status)
│   │   ├── src/fonts/           # Font loaders & metric matchers for Office font parity
│   │   ├── src/mail/            # Built-in email interface for cluster communication
│   │   ├── src/workspace/       # Tabbed multi-document management & split views
│   │   ├── src/mode.ts          # Runtime detection (serverless, single-node, cluster)
│   │   └── src/storage.ts       # Persistence abstraction (IndexedDB, Electron bridge, SuiteDrive)
│   └── desktop/                 # Electron main process & desktop integrations
│       ├── src/main.ts          # Electron lifecycle, native menus, and protocols
│       ├── src/preload.ts       # Sandboxed IPC bridge (`window.suiteleaf`)
│       ├── src/store.ts         # SQLite index (`library.sqlite`) & atomic file operations
│       ├── src/ai-host.ts       # Local LLM runner via `node-llama-cpp` (GGUF models)
│       └── src/auto-updater.ts  # In-app background update engine
├── packages/
│   └── core/                    # Shared platform-agnostic library (web, desktop, scripts)
│       ├── src/file-schema.ts   # Document formats (.sldoc, .slsheet, .slslides, .sldraw)
│       ├── src/docx-*           # Word/DOCX import, export, and style conversions
│       ├── src/excel-*          # Excel/XLSX import, export, formula decoding
│       ├── src/pptx-*           # PowerPoint/PPTX import, shapes, transitions, and export
│       ├── src/sheet-*.ts       # Formula calculation engine, dependency graph, and invalidation
│       ├── src/solver.ts        # Optimization and goal-seek algorithms
│       ├── src/capabilities/    # Parity matrix definitions against Office & Google Workspace
│       └── src/search/          # Document full-text indexer and query parser
├── crates/                      # Rust (edition 2024) backend cluster crates
│   ├── suitedb/                 # Distributed CRDT op-log database with HLC causal ordering
│   ├── suitedrive/              # Content-addressed chunked blob store (BLAKE3) & versioning
│   ├── suiteleaf-net/           # libp2p networking (Noise, Yamux, Kademlia DHT, Gossipsub)
│   └── suiteleaf-node/          # Node server binary (Axum HTTP/WS, blob serving, sidecar runner)
├── services/                    # Auxiliary backend microservices & sidecars
│   ├── auth/                    # Better-auth sidecar with SuiteDB adapter for cluster replication
│   └── ai/                      # AI sidecar for local model execution & upstream proxying
├── tests/                       # Automated test suites
│   ├── *.test.ts                # Root Vitest unit tests (calculation, schemas, conversions)
│   ├── ui/                      # JSDOM React component tests
│   ├── browser/                 # Playwright browser E2E tests (visuals, canvas, layout)
│   ├── electron/                # Playwright Electron desktop integration tests
│   ├── integration/             # Multi-service integration tests (e.g. Stalwart mail, node)
│   ├── compat/                  # Office compatibility regressions against reference files
│   └── capabilities/            # Feature matrix catalog verification
├── storyboards/                 # Complete user journeys and automated video recordings
│   ├── *.md                     # Storyboard specs (who, why, steps, success criteria, benchmarks)
│   ├── scenes/                  # Playwright recording scripts (generates .mp4 with slowMo & captions)
│   └── scenes/ai/               # Autonomous on-device AI agent workflow tests
├── scripts/                     # Build tools, parity benchmarking, secrets check, font pipelines
├── docs/                        # Deep-dive architecture specs, runbooks, and parity guides
└── deploy/                      # Dockerfiles and multi-node Docker Compose topologies
```

For more comprehensive architectural breakdowns, see [`docs/sourcemap.md`](file:///Users/jjg/github/SuiteLeaf/docs/sourcemap.md).

---

## Updating AGENTS.md

To ensure AI agents and contributors do not waste time reading unnecessary files or running inappropriate tests, keep this `AGENTS.md` file up to date whenever changes occur:

1. **When Adding or Restructuring Directories:**
   - If a new package, service, crate, or major subdirectory is introduced under `apps/`, `packages/`, `crates/`, `services/`, or `tests/`, add it to the **Codebase Sourcemap** section immediately.
   - Describe its core responsibility and key entry-point files so agents can locate it without directory scanning.
2. **When Introducing Major Features or Subsystems:**
   - If a new runtime mode, storage layer, editor engine, or service is added, update the **Project Overview** and **Architecture** sections.
3. **When Modifying Testing Workflows or Commands:**
   - If test runners, flags, coverage thresholds, or new test categories are modified, update the **Testing Strategy** section with what is tested and when to use it.
4. **General Rules for Updating:**
   - Keep entries concise, dense with actionable information, and free of ephemeral changelogs or commit histories.
   - Keep parity with [`docs/sourcemap.md`](file:///Users/jjg/github/SuiteLeaf/docs/sourcemap.md).

---

## Testing Strategy: What is Tested & When to Use Each Tier

Agents must select the appropriate test tier to avoid wasting time running heavy or irrelevant test suites.

```
+---------------------------------------------------------------------------------------+
|  Tier 1: Unit Tests (Vitest & Cargo test)                                             |
|  - Fast, in-memory, no browsers, no daemons. Run targeted files during development.   |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|  Tier 2: System & Integration Tests (Playwright Browser & Electron, Stalwart)         |
|  - Real browser/Electron engines. Tests visual layout, canvas, real typing, and IPC.  |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|  Tier 3: CI Suite (GitHub Actions / act)                                              |
|  - Full validation matrix: linters, typechecks, build artifacts, multi-OS packages.   |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|  Tier 4: Storyboard Tests (Playwright Storyboards & AI Scenes)                        |
|  - Slow, full-journey scenario recordings (MP4s) and autonomous AI tool evaluations.   |
+---------------------------------------------------------------------------------------+
```

### 1. Unit Tests (`npm test` / Vitest / `cargo test`)
- **What is tested:**
  - Pure algorithmic logic, calculation engines (formula parsing, dependency trees, cell recalculation, goal-seeking solver in `packages/core`).
  - File format serialization and conversion pipelines (DOCX, XLSX, PPTX import/export, schema validation).
  - Component rendering, DOM structures, and dialog logic using JSDOM (`tests/ui/`).
  - Rust crate logic in isolation (`crates/` unit tests via `cargo test`).
- **Commands:**
  - Run a single test file (Fastest - use this during dev): `npx vitest run tests/<file>.test.ts` or `npx vitest run tests/ui/<file>.test.tsx`
  - Run with coverage: `npm run test:coverage`
  - Run Rust crate tests: `cargo test -p suitedb` (or `--workspace`)
- **When to use:** Run targeted unit tests relevant to modified code during development. Unit test coverage must stay above 90%.
- **When NOT to use:** Do not run the full unit test suite before routine pushes or commits. Do not use unit tests to verify pixel-accurate CSS positions, scrolling behavior, canvas-rendered pixels, or real OS/browser keyboard/caret mechanics.

### 2. System Tests (Playwright Browser, Electron, & Service Integration)
- **What is tested:**
  - **Browser E2E (`tests/browser/`):** Visual layout, element overlap, scroll container behavior, real caret/selection manipulation, and anything rendered on `<canvas>` (the Univer spreadsheet grid canvas and the Slide presentation canvas).
  - **Multi-user Collaboration (`tests/browser/*collab*.spec.ts`):** Real-time collaborative document, sheet, and slide editing across multiple live browser contexts connected via WebSockets.
  - **Electron Desktop (`tests/electron/`):** Electron window management, native menus, context isolation bridge (`window.suiteleaf`), local SQLite library access, and PDF export.
  - **Service Integration (`tests/integration/`):** Multi-service interactions (e.g. `test:mail:stalwart` testing Stalwart mail server integration).
- **Commands:**
  - Run a specific browser test: `npx playwright test tests/browser/<spec>.spec.ts --project=chromium`
  - Run Electron tests: `npm run test:electron`
  - Run integration test: `npm run test:mail:stalwart`
- **When to use:** Use when modifying visual styling, layout calculation, canvas rendering, caret/selection, desktop Electron bridges, or live multi-user sync. **Always run a single target spec file** rather than the full suite.
- **When NOT to use:** Do NOT use browser/system tests to check simple string outputs, dialog text, formula mathematics, or file import/export converters if a Vitest unit test can verify it. Do not add a browser spec that only opens the app to read a string the unit test already checks.

### 3. CI (Continuous Integration / `nektos/act`)
- **What is tested:**
  - Full codebase health across all layers:
    - Secret scanning (`npm run check:secrets`).
    - Monorepo TypeScript typechecking across all apps and services (`npm run typecheck`).
    - Linter enforcement (`npm run lint`, `cargo fmt --check`, `cargo clippy`).
    - Complete Vitest test suite (`npm test`).
    - Full web and desktop production builds (`npm run build`).
    - Electron smoke test in headless Xvfb (`npm run test:electron`).
    - Vercel container deployment verification with PostgreSQL (`Dockerfile.vercel`).
    - 4-shard parallel Playwright browser test matrix.
    - Multi-OS desktop package builds (macOS `.dmg`, Linux `.AppImage`/`.deb`, Windows `.exe`).
- **Commands:**
  - Run locally using act: `act -j checks` or `act pull_request`
- **When to use:** Used by GitHub Actions to validate pull requests. Can be run locally with `act` when diagnosing CI-specific failures.

### 4. Storyboard Tests (`npm run storyboards`)
- **What is tested:**
  - End-to-end user journeys from start to finish documented in `storyboards/*.md`.
  - Produces timestamped `.mp4` video recordings in `storyboards/videos/` with captions and pointer dots (`slowMo`) for documentation and user experience review.
  - Verifies UX friction benchmarks (keystroke counts, click counts, flow comparisons) against Google Workspace and Microsoft Office.
  - **AI Storyboards (`storyboards/scenes/ai/`):** Tests autonomous on-device LLMs (e.g. FrogNano) executing complex multi-step user tasks via tool calling, recording performance metrics and transcripts in `test-results/ai-metrics/`.
- **Commands:**
  - Run a single storyboard: `npm run storyboards -- -g <slug>`
  - Run AI storyboards: `npm run storyboards -- --project=ai`
- **When to use:** Use when creating new user workflow recordings, validating UX benchmarks against Office/Google Workspace, or evaluating autonomous AI agent performance.
- **When NOT to use:** **Never use storyboards for standard functional regression testing.** Storyboard tests run with intentional delays (`slowMo`) and video encoding overhead, making them very slow.

---

## Code Refactoring Rule
- If a source code file is over 1000 lines, try to refactor it into semantically distinct, smaller files.
- **Exception:** Files that are strictly static datasets or word lists (such as dictionaries or token lists in a `.ts` file).

---

## Building & Packaging Desktop App

When asked to build the app:
1. Run `npm run build`
2. Run `npm run package:desktop` so `/Applications/SuiteLeaf.app` is replaced with the new build.
3. Report the version it installed, and whether SuiteLeaf was open and needs reopening.

---

## Fonts & Typography Parity

- SuiteLeaf uses open-source fonts that are metric- and layout-identical to Microsoft Office fonts (e.g., Calibri <--> SuiteLeaf Willow).
- If you ever observe a layout mismatch between an MS Office font and its SuiteLeaf counterpart, flag it and fix it in the SuiteLeaf font definitions (`scripts/fonts/` and `apps/web/src/fonts/`).
- **Avoid font-specific layout logic or spacing overrides:** Do not tune named-font line spacing, widths, or offsets to match individual documents. Investigate shared causes in import, paragraph layout, autofit, inheritance, and font-metric interpretation. Use font data through a general measurement path rather than family-specific rendering exceptions.
