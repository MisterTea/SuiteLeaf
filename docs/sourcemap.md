# Codebase Source Map & Repository Organization

This document provides a comprehensive map of how code is organized across the SuiteLeaf repository. It is intended to help developers and AI agents navigate the codebase, understand architectural boundaries, and locate specific functionality quickly.

---

## Architecture Overview

SuiteLeaf is an open-source workspace for documents, spreadsheets, and presentations. It combines a unified React/TypeScript editor layer with an Electron desktop shell, a distributed Rust cluster backend, and auxiliary Node.js sidecars.

The workspace operates in three distinct modes (configured at runtime in [`apps/web/src/mode.ts`](../apps/web/src/mode.ts)):
1. **Serverless Mode:** Runs entirely in the browser (e.g., the GitHub Pages demo with `VITE_SUITELEAF_DEMO=1`). Storage uses local IndexedDB via Dexie/localForage; the AI assistant runs locally in WebGPU via web workers.
2. **Single-Node Mode:** Desktop application running standalone. Files are read/written directly to disk with a local SQLite index (`~/.config/suiteleaf/library.sqlite`); AI runs locally via llama.cpp or an OpenAI-compatible endpoint.
3. **Cluster Mode:** Enterprise/collaborative deployment. Web or desktop clients connect to one or more `suiteleaf-node` servers that replicate accounts and files over a private libp2p peer-to-peer swarm using SuiteDB and SuiteDrive.

---

## Monorepo Structure

SuiteLeaf is structured as a dual-workspace monorepo:
- **npm Workspaces:** Defined in [`package.json`](../package.json) covering `apps/*`, `packages/*`, and `services/*`.
- **Cargo Workspaces:** Defined in [`Cargo.toml`](../Cargo.toml) covering Rust crates under `crates/*`.

```
SuiteLeaf/
├── apps/               # Executable end-user applications
│   ├── desktop/        # Electron desktop wrapper & native integrations
│   └── web/            # Vite + React frontend for web & desktop renderer
├── packages/           # Shared libraries
│   └── core/           # Data schemas, file conversions, calculation engines
├── crates/             # Rust cluster backend services & storage engines
│   ├── suitedb/        # Distributed op-log CRDT database over SQLite
│   ├── suitedrive/     # Content-addressed blob store & file management
│   ├── suiteleaf-net/  # Private libp2p P2P networking layer
│   └── suiteleaf-node/ # Cluster node server binary (Axum HTTP + libp2p)
├── services/           # Backend microservices & sidecars
│   ├── ai/             # Local LLM runner & upstream AI proxy
│   └── auth/           # Better-auth sidecar with SuiteDB adapter
├── docs/               # Technical specs, architecture docs, and runbooks
├── tests/              # Vitest unit/integration tests and Playwright E2E specs
├── scripts/            # Build tools, font generation, parity testing, benchmarks
├── deploy/             # Docker, Docker Compose, and deployment configurations
└── datasets/           # Validation datasets, word lists, and test corpora
```

---

## Detailed Directory Breakdown

### 1. Frontend Web Application (`apps/web`)

The web application is built with Vite, React 19, and TypeScript. It serves as both the standalone browser application and the UI renderer inside Electron.

- **`apps/web/src/editors/`**: The core document and spreadsheet editing engines:
  - **Docs:** Built on Tiptap/ProseMirror. Rich-text formatting, pagination, headers/footers, footnotes, citations, watermarks, equations, table management, find/replace (`doc-*`, `Docs.tsx`).
  - **Sheets:** Built on Univer's spreadsheet core. Multi-worksheet support, formula bar, cell formatting, conditional formatting, data validation, sorting, filtering, range protection, and cell notes (`sheet-*`, `Sheets.tsx`).
  - **Charts & Pivots:** Custom embedded charts (Recharts) and pivot tables (Arquero engine) integrated into spreadsheet ranges (`chart-*`, `combo-chart.tsx`, `waterfall-chart.tsx`, `analysis.ts`).
  - **Slides:** Slide decks, layout masters, Marp Markdown sync, speaker notes, animations, transitions, and presentation screen (`slide-*`, `Slides.tsx`).
  - **Drawings:** Canvas drawing tools and SVG export (`drawing-*`, `svg-*`).
  - **Forms:** Survey/form designer and response grid (`form-*`).
- **`apps/web/src/ai/`**: Web client AI assistant implementation:
  - In-browser model execution (WebGPU / transformers.js, wllama WebAssembly).
  - Streaming completions, chat interface, prompt generation, tool calling, and document edit suggestions.
- **`apps/web/src/drive/`**: SuiteDrive frontend:
  - File browser, folder tree, file upload queues, version history, file sharing/ACL dialogs, and trash management.
- **`apps/web/src/collab/`**: Real-time collaborative editing:
  - Presence indicators, collaborative cursor tracking, live room synchronization, and conflict resolution.
- **`apps/web/src/admin/`**: Cluster administration console:
  - User and organization management, role-based access controls (RBAC), node status, audit logs, and resource limits.
- **`apps/web/src/fonts/`**: Font subsystem:
  - SuiteLeaf custom font definitions and web font loaders ensuring layout-identical metrics to Microsoft Office fonts (e.g. SuiteLeaf Willow matching Calibri).
- **`apps/web/src/mail/`**: Built-in email interface for cluster mode communication and verification.
- **`apps/web/src/home/`**: Home dashboard, template gallery, and recent document lists.
- **`apps/web/src/styles/`**: Global theme styling, CSS design tokens, and editor UI stylesheets.
- **`apps/web/src/workspace/`**: Tabbed multi-document management, split views, and view locking.
- **Key Top-Level Web Files:**
  - `App.tsx`: Main routing and layout wrapper.
  - `main.tsx`: React DOM mount point.
  - `mode.ts`: Runtime detection of serverless, single-node, or cluster modes.
  - `storage.ts`: Persistence abstraction selecting IndexedDB, Electron bridge, or SuiteDrive.
  - `node-client.ts`: HTTP/WebSocket API client communicating with `suiteleaf-node`.
  - `command-palette.tsx`: Keyboard-driven command launcher (`Ctrl/Cmd + K`).

---

### 2. Desktop Application (`apps/desktop`)

The desktop app packages SuiteLeaf using Electron and `electron-vite`.

- **`apps/desktop/src/main.ts`**: Electron main process entry point:
  - Window lifecycle, native menu bars, dock integrations, and protocol registration (`suiteleaf://app/`).
  - Context isolation and secure IPC communication between main and renderer.
- **`apps/desktop/src/preload.ts`**: Sandboxed preload script exposing typed `window.suiteleaf` DesktopBridge APIs to the renderer.
- **`apps/desktop/src/store.ts`**: Local desktop storage manager:
  - SQLite database (`~/.config/suiteleaf/library.sqlite`) indexing documents, recent files, and recovery drafts.
  - Atomic file writes (write temporary sibling file -> fsync -> atomic rename).
  - Filesystem watching for external modifications.
- **`apps/desktop/src/ai-host.ts` & `src/ai.ts`**: Local LLM host using `node-llama-cpp` to run GGUF models (e.g. FrogNano) directly on the host machine.
- **`apps/desktop/src/auto-updater.ts` & `src/updates.ts`**: In-app background update checks and installation using `electron-updater`.
- **`apps/desktop/src/pdf-export-host.ts`**: Native headless print-to-PDF generation.
- **`apps/desktop/src/convert-cli.ts` & `src/import-cli.ts`**: Command-line interfaces for batch importing and converting Office files.

---

### 3. Shared Core Package (`packages/core`)

Platform-independent domain logic, schema definitions, calculation engines, and file format converters used by both `apps/web` and `apps/desktop`.

- **File Schemas (`packages/core/src/file-schema.ts`, `sheet-schema.ts`, `slide-schema.ts`):**
  - Defines the versioned JSON envelope for SuiteLeaf files:
    - `.sldoc`: Document format (Tiptap ProseMirror document tree + metadata).
    - `.slsheet`: Spreadsheet format (Univer workbook snapshot + charts + pivots).
    - `.slslides`: Presentation format (slides, elements, theme, transitions).
    - `.sldraw`: Vector drawing format.
  - Validated with Zod schemas.
- **Office Conversion Pipelines:**
  - **Word / DOCX:** `docx-export.ts`, `docx-blocks.ts`, `docx-runs.ts`, `docx-section.ts`, `word.ts`, `word-html.ts`, `word-styles.ts`. Integrates Mammoth and docx libraries with paragraph layout validation.
  - **Excel / XLSX:** `excel.ts`, `excel-binary.ts`, `excel-styles.ts`, `excel-charts.ts`, `xlsx-export.ts`, `xlsx-drawings.ts`. Integrates SheetJS with custom style/formula decoders.
  - **PowerPoint / PPTX:** `pptx.ts`, `pptx-export.ts`, `pptx-shapes.ts`, `pptx-theme.ts`, `pptx-notes.ts`.
  - **Vector Graphics:** `emf-vector.ts`, `emf-plus.ts`, `wmf-vector.ts` for rendering legacy Windows metafiles inside web canvases.
- **Spreadsheet Calculation & Analysis:**
  - `sheet-cross-calc.ts`: Multi-sheet cross-calculation engine.
  - `sheet-invalidation.ts`: Dependency tracking and selective cell recalculation.
  - `sheet-audit.ts`: Formula auditing and circular dependency detection.
  - `solver.ts` & `goal-seek.ts`: Optimization and goal-seeking solver algorithms.
- **Specialized Submodules (`packages/core/src/`):**
  - `capabilities/`: Feature matrix catalog verifying format and functional parity.
  - `compat/`: Office compatibility tracking heuristics.
  - `governance/`: Data retention, residency, and compliance policies.
  - `offline/`: Offline cache synchronization and retry queues.
  - `operations/`: Operational telemetry, health checks, and metrics.
  - `provisioning/`: User and tenant provisioning logic.
  - `search/`: Full-text document indexer and query parser.
  - `workflows/`: Automation pipelines and document workflow definitions.

---

### 4. Cluster Backend Crates (`crates/`)

The backend is written in Rust (edition 2024) and structured as a Cargo workspace. It powers cluster mode.

- **`crates/suitedb/` (Replicated Database):**
  - High-performance, distributed log-based database.
  - Hybrid Logical Clocks (HLC) for causal ordering across nodes without centralized clocks.
  - Signed operation log (`op.rs`) ensuring tamper-proof mutations.
  - Materialization engine compiling op-logs into local SQLite (`sqlite_materialize.rs`) or PostgreSQL (`postgres_store.rs`).
- **`crates/suitedrive/` (Content-Addressed Storage):**
  - File content chunking into 1 MiB BLAKE3-hashed blocks (`blobs.rs`).
  - Version history chains, immutable snapshot recovery, and garbage collection.
  - Hierarchical Access Control Lists (ACLs) for users and organizations (`access.rs`, `sharing.rs`).
  - Search indexes, backup chains, and form response databases.
- **`crates/suiteleaf-net/` (Peer-to-Peer Networking):**
  - libp2p swarm configuration with private pre-shared swarm keys (`swarm.key`).
  - Transport secured by Noise protocol and multiplexed via Yamux over TCP.
  - Peer discovery using Kademlia DHT and local mDNS.
  - Gossipsub pubsub protocol for instant op-log replication across cluster peers.
  - Custom request-response protocols for targeted database sync and blob exchange.
- **`crates/suiteleaf-node/` (Node Server Binary):**
  - The main server executable combining `suitedb`, `suitedrive`, and `suiteleaf-net`.
  - HTTP and WebSocket API built with Axum (`http.rs`):
    - `/api/drive`: SuiteDrive file operations and blob streaming.
    - `/api/node`: Node health, cluster membership, and peering.
    - `/api/auth`: Reverse proxy forwarding authentication requests to the better-auth sidecar.
    - Serves the static web app distribution (`apps/web/dist`).
  - Supervises sidecar processes (better-auth and optional local AI runner).

---

### 5. Auxiliary Services (`services/`)

Microservices orchestrated by `suiteleaf-node` or deployed alongside it:

- **`services/auth/` (Authentication Sidecar):**
  - TypeScript Node.js service using `better-auth`.
  - Implements a custom SuiteDB adapter (`src/adapter.ts`), sending all auth persistence over loopback HTTP to the host node. This guarantees accounts, sessions, and credentials automatically replicate across all cluster nodes.
  - Supports email/password authentication and OAuth providers (Google, GitHub, Nextcloud).
- **`services/ai/` (AI Assistant Microservice):**
  - Node.js service providing completions and embeddings.
  - Manages local model execution or proxies requests to upstream OpenAI-compatible endpoints (`SUITELEAF_AI_UPSTREAM`).

---

### 6. Fonts & Typography (`scripts/fonts/` & `apps/web/src/fonts/`)

SuiteLeaf maintains metric-identical and layout-identical open-source fonts corresponding to standard Microsoft Office fonts (e.g. Calibri, Arial, Times New Roman):
- `scripts/fonts/suiteleaf_build.py`: Python build pipeline generating font files with matching bounding boxes and advance widths.
- `scripts/fonts/suiteleaf_families.py`: Font family definitions and metric mapping.
- `scripts/fonts/suiteleaf_verify.py`: Validation scripts checking metrics against reference font binaries.

---

### 7. Tests & Validation (`tests/`)

SuiteLeaf enforces a strict test-driven quality standard (>90% unit test coverage):

- **`tests/*.test.ts`**: Root Vitest test suite covering unit behaviors:
  - Calculation engine (`sheet-*.test.ts`, `solver.test.ts`).
  - Office import/export converters (`docx-*.test.ts`, `excel-*.test.ts`, `pptx-*.test.ts`).
  - Document formatting and pagination (`document-*.test.ts`, `word-*.test.ts`).
  - AI tools, prompts, and permissions (`ai-*.test.ts`).
- **`tests/browser/`**: Playwright browser tests for visual layout, scroll behavior, caret positioning, and canvas rendering that Vitest/JSDOM cannot test.
- **`tests/ui/`**: JSDOM-based React component tests.
- **`tests/capabilities/`**: Verification tests enforcing feature matrices in `packages/core/src/capabilities/`.
- **`tests/compat/`**: Office compatibility regressions against reference file formats.
- **`tests/electron/`**: Electron application integration tests.
- **`tests/fixtures/`**: Reference test files (`.docx`, `.xlsx`, `.pptx`, `.sldoc`).

---

### 8. Scripts & Deployment Tools (`scripts/`, `deploy/`)

- **`scripts/`**:
  - `verify-office-imports.mjs`: Tests import pipelines against large Office test corpora.
  - `office-compat.mts`: Generates Office compatibility reports.
  - `capture-parity.py` & `capture-suiteleaf-parity.mjs`: Automated screen comparison between Microsoft Office and SuiteLeaf.
  - `check-secrets.mjs`: Pre-commit / CI scanner for accidentally committed secrets.
- **`deploy/`**:
  - Docker configurations (`Dockerfile`, `Dockerfile.vercel`).
  - `docker-compose.yml`: Multi-node cluster orchestration for testing or self-hosting.
  - `init-cluster.sh`: Script generating cluster swarm keys and initial credentials.

---

## Guide for Common Development Tasks

| Task | Primary Directories & Files |
| --- | --- |
| **Fixing a document formatting or pagination bug** | `packages/core/src/document-*.ts`, `apps/web/src/editors/doc-*.ts` |
| **Adding or fixing a spreadsheet formula / function** | `packages/core/src/sheet-*.ts`, `apps/web/src/editors/sheet-*.ts` |
| **Modifying PowerPoint or Slide rendering** | `packages/core/src/pptx*.ts`, `apps/web/src/editors/slide-*.ts` |
| **Updating Office (DOCX/XLSX/PPTX) import/export** | `packages/core/src/docx-*`, `excel-*`, `pptx-*`, `apps/web/src/office-import.ts` |
| **Improving font layout or metrics** | `scripts/fonts/`, `packages/core/src/office-fonts.ts`, `apps/web/src/fonts/` |
| **Updating Desktop/Electron storage or window behavior** | `apps/desktop/src/main.ts`, `store.ts`, `preload.ts` |
| **Adjusting AI assistant prompts, tools, or models** | `apps/web/src/ai/`, `services/ai/src/`, `packages/core/src/ai.ts` |
| **Modifying cluster replication or node storage** | `crates/suitedb/src/`, `crates/suitedrive/src/`, `crates/suiteleaf-node/src/` |
| **Adding or adjusting authentication providers** | `services/auth/src/options.ts`, `adapter.ts`, `server.ts` |
