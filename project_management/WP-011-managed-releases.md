---
id: "WP-011"
title: "Signed releases and managed updates"
type: "work_package"
status: "in_progress"
priority: "P0"
phase: 1
area: "distribution"
created: "2026-10-29"
updated: "2026-10-30"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: []
---

# Signed releases and managed updates

## Outcome and rationale

Make SuiteLeaf deployable and maintainable on managed desktops, with trustworthy updates and a recovery path when a release fails.

## Existing implementation and starting points

Inspect `apps/desktop/electron-builder.yml`, `apps/desktop/package.json`, packaging scripts, and CI. The README describes unsigned/ad-hoc packages, no configured automatic updates, and a macOS packaging step that installs into `/Applications/SuiteLeaf.app`.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Configure platform signing/notarization using protected CI secrets and document prerequisites for credentials that are not available in the repository.
- Implement signed update manifests, integrity verification, staged rollout rings, pause/defer policy, proxy support, and rollback compatible with document/schema changes.
- Provide unattended installation/uninstallation, managed settings, update-channel selection, and clear restart/reopen behavior.
- Publish SBOM/dependency notices and reproducible release provenance; keep model downloads separate from basic editor updates.
- Define minimum supported OS/runtime versions and regression matrices. Coordinate schema compatibility with backup and native-format migrations.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Tampered installers/update manifests are rejected; signed packages install on the supported platform matrix.
- An administrator can hold a fleet on a supported version and move a pilot ring forward.
- A failed rollout can be paused and recovered without corrupting files or silently discarding edits.
- Release documentation records actual version, signing status, migration constraints, and restart needs.

## Verification

- Test update parsing and policy in unit tests, installers in isolated OS environments, and rollback with old/new file fixtures.
- For an explicitly requested local app build, run `npm run build` then `npm run package:desktop`; report installed version and whether the app was open and needs reopening.
- Do not publish releases or use production signing credentials merely to test package logic.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

This package defines deployment behavior; a scheduled marketing release or app-store submission remains an explicit release action. A rollback requiring a newer incompatible schema needs a documented recovery path, not an unsafe downgrade.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): Repository inspection; see the paths above. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: In progress. `apps/desktop/src/updates.ts` checks an Ed25519 signature over a fixed-key JSON manifest. The trusted public key is supplied by the caller. A changed field is rejected. An installer whose SHA-256 is not the signed `sha256` is rejected. A paused policy installs nothing. A stable policy held on one version does not take a newer build; a pilot policy does. A release older than the document schema already in use is rejected. `tests/updates.test.ts` passed (4 tests). The desktop typecheck passed. Limits are in `docs/updates.md`.

2026-10-30, later: `planRestart` refuses to quit while an install still has unsaved edits. After those edits are saved, the plan is `restart`. A paused rollout is not remembered as a pending restart, so it does not block closing the window. The desktop close handler shows the wait reason and leaves the window open. `npx vitest run tests/updates.test.ts` passed (5 tests). The desktop typecheck passed.

2026-10-30, later: `recordReleaseOffer` records a body the caller already fetched. A signed install that needs a restart is what the close handler remembers. A bad signature clears that memory, including one that was recorded earlier. A URL on the offer is ignored. `npx vitest run tests/updates.test.ts` passed (6 tests). The desktop typecheck passed.

2026-10-31: `fetchReleaseOffer` reads one https address and records the offer. A signed pilot release is remembered as a restart. A server that does not answer leaves that memory in place. An address that is not https is not requested. The body can name an installer address; that address is not requested. When `SUITELEAF_UPDATE_URL` and `SUITELEAF_UPDATE_PUBLIC_KEY` are both set, the desktop process asks at startup and every six hours. With either missing, it asks nothing. `npx vitest run tests/updates.test.ts` passed (7 tests). The desktop typecheck reported no errors in the update files. It still reports existing errors in `pptx-theme.ts` and `pptx-chart-svg.ts`. 2026-10-31, later: a signed offer that names an https `installerUrl` is downloaded, and the bytes are kept only when their SHA-256 is the signed hash. A different file is rejected, the remembered restart is cleared, and the file is not kept. The installer address is not part of the signature. A kept file is written under the app's user-data `updates` directory and is not opened. `npx vitest run tests/updates.test.ts` passed (7 tests). The module still does not replace the installed app. Signing credentials and unattended install are still open. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-10-31, later still: `recoverPausedRollout` clears a remembered restart and deletes a kept installer named with its hash. A file named `notes.sldoc` in the same directory is not deleted. Unsaved edits stay unsaved. When the rollout is not paused, the installer and the restart stay. `npx vitest run tests/updates.test.ts` passed (8 tests). The module still does not replace the installed app.

2026-10-31, later: a release `0.0.9` whose schema is 4, while documents use schema 5, is rejected even when the fleet is held on `0.0.9`. The recovery says to keep the installed app and not replace its files, and it names schema 5 and schema 4. `npx vitest run tests/updates.test.ts` passed (8 tests). The module still does not replace the installed app. Signing credentials and unattended install are still open. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-10-31, later: `releaseRecord` for a rejected signature names version `0.9.0`, says the signature was rejected, leaves documents on schema 5, and does not restart. An accepted `0.2.0` says the signature matches, documents stay on schema 5, and the app must quit and reopen. Schema 6 says documents move from schema 5 to schema 6. A signed `0.0.9` that only opens schema 4 names both schema numbers and does not restart. `npx vitest run tests/updates.test.ts` passed (9 tests). The module still does not replace the installed app. Signing credentials and unattended install are still open. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-10-31, later: `SUITELEAF_UPDATE_PROXY` set to `http://proxy.example:8080` is the proxy for the offer and the installer download. A `file` address is refused, the refusal does not contain `secret-value`, and a restart already remembered stays remembered. A password in the proxy address is not copied into the decision. `npx vitest run tests/updates.test.ts` passed (10 tests). The test supplied its own fetchers, so it did not open a proxy connection. The desktop poll uses that proxy with undici when no fetcher is supplied. The module still does not replace the installed app. Signing credentials and unattended install are still open. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-10-31, later: a signed pilot release that needs runtime `22.12.0` is refused while the app is running `22.11.0`. The refusal names both versions and says to keep the installed app. Runtime `22.13.0` is still an install. A requirement of `soon` is refused. The desktop poll passes `process.versions.node`. `npx vitest run tests/updates.test.ts` passed (11 tests). The module still does not replace the installed app. Signing credentials and unattended install are still open. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-10-31, later: `releaseNotice` for version `0.2.0` records installer hash `abc`, a matched signature, and schema 5. `prosemirror-model` and `yjs` are listed as editor components. `garden-model` is listed afterward, and the line says it is not part of the editor update. A rejected signature for `0.9.0` says the signature was rejected and does not name a model that was not supplied. Naming `secret-value` as both an editor component and a model throws `A model download is not an editor component.` and that error does not contain `secret-value`. `npx vitest run tests/release-notice.test.ts` passed (1 test). The notice does not read `node_modules`. The module still does not replace the installed app. Signing credentials and unattended install are still open. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-10-31, later: `update-policy.json` sets the channel to `pilot`, the held version to `0.2.0`, and paused to false, over the environment values `stable`, `0.1.0`, and paused. A file that stores `apiKey` `secret-value` is refused, the message does not contain `secret-value`, and the release poll does not start. A channel of `secret-value` is refused the same way and is not repeated. With no file, the environment channel stays `stable`. The desktop reads `update-policy.json` from the user-data directory when it starts. `npx vitest run tests/managed-update.test.ts tests/updates.test.ts` passed (12 tests). The app was not started. The module still does not replace the installed app. Signing credentials and unattended install are still open. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-10-31, later: an unattended install with identity `null` is refused. An installer named `secret-value.sldoc` is refused, and that name is not in the refusal. A signed `SuiteLeaf.dmg` whose hash matches is ready, and the check does not replace the app. An unattended uninstall may name `/Applications/SuiteLeaf.app` and does not name `Beds.sldoc`. A document path is refused, and the refusal does not contain `secret-value`. `npx vitest run tests/unattended-install.test.ts` passed (1 test). No file was deleted. Signing credentials are still not in the repository. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-11-01: a signed pilot release deferred until `2026-11-02T00:00:00.000Z` is held at `2026-11-01T00:00:00.000Z`. At that defer time it is an install of `0.2.0` and still needs a restart. A defer value `secret-value` is refused with `The defer date is not a time.` and that word is not in the message. `npx vitest run tests/updates.test.ts tests/managed-update.test.ts` passed (13 tests). The module still does not replace the installed app. Signing credentials are still not in the repository. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-11-01: `SUITELEAF_UPDATE_HELD` set to `secret-value` is left out of the policy. The channel stays `stable` and paused stays false. That word is not in the policy. A held version `0.1.0` is still kept. `npx vitest run tests/managed-update.test.ts` passed (1 test). The app was not started. The module still does not replace the installed app. Signing credentials are still not in the repository. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-11-01: a ring holds a computer whose bucket is at or above the percent. Garden at its own bucket waits, and the decision does not contain `garden` or `secret-value`. The next percent installs `0.2.0`. A computer with no name is not assigned to a ring. A ring value `secret-value` is refused with `The update ring is not a percent.` and that word is not in the message. `npx vitest run tests/updates.test.ts tests/managed-update.test.ts` passed (14 tests). The desktop stores a ring id when it starts. This test did not start the app. The module still does not replace the installed app. Signing credentials are still not in the repository. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-11-01: `dependencyNotice` lists `react` at `19.0.0` and `vitest` at `4.1.11-beta.1`. A version written as `1.2.3 secret-value` is recorded as `1.2.3`. A version that is only `secret-value` is omitted, and that word is not in the notice. A `.gguf` package is omitted. The note says this is not a signature and that model files are not included. `npx vitest run tests/dependency-notice.test.ts` passed (1 test). The function does not read `node_modules` and does not replace the installed app. Signing credentials are still not in the repository. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-11-01: the packaged desktop floor is Node.js 22.12.0, macOS 13, and Windows 10. A runtime of `22.11.9` is older than Node.js 22.12.0. macOS 12 is older than macOS 13. Windows 6.1 is older than Windows 10. A version written as `secret-value` is not repeated. Linux has no recorded distribution floor. `npx vitest run tests/supported-platform.test.ts` passed (1 test). This check does not stop the app when it starts. The app was not started. Signing credentials are still not in the repository. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-11-01: an installer name `../secret-value.dmg` is refused. The reason is `The installer name is not a SuiteLeaf installer.` That name is not in the reason. An app path `../secret-value/SuiteLeaf.app` is refused. The reason is `The app path is not a SuiteLeaf app path.` The path is not named for removal. `npx vitest run tests/unattended-install.test.ts` passed (1 test). Neither check replaces or deletes a file. The app was not started. Signing credentials are still not in the repository. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-11-01: a managed defer date that is not a real day is refused. `2026-02-31T00:00:00.000Z` says `The defer date is not a time.` and that date is not in the message. `2026-11-02T00:00:00.000Z` is still kept. `npx vitest run tests/managed-update.test.ts` passed (1 test). The app was not started. Signing credentials are still not in the repository.

2026-11-01: a managed update channel `Stable` is accepted as `stable`. A channel `secret-value` still says `The managed update channel is stable or pilot.` and that word is not in the message. `npx vitest run tests/managed-update.test.ts` passed (1 test). The app was not started. Signing credentials are still not in the repository.

2026-11-01: a failed start can return to the previous release when the document schema did not move forward. `0.2.0` on schema 5 restores `0.1.0`. Schema 6 stays installed, and that reason does not name the versions. A version `secret-value` says `The installed version is not major.minor.patch.` and that word is not in the message. Nothing is replaced. `npx vitest run tests/updates.test.ts -t "restores the previous release"` passed (1 test). The app was not started. The desktop does not call this yet. Signing credentials are still not in the repository. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-11-01: the next launch reads `failed-start.json`. Schema 5 restores `0.1.0` and writes that version alone into `rollback-plan.json`. A note `secret-value` in the record is not copied. Schema 6 stays installed. A record that is not JSON says `The failed start record cannot be read.` and that text is not copied. The record is removed. Nothing is replaced. `npx vitest run tests/updates.test.ts -t "reads a failed start"` passed (1 test). The app was not started. Signing credentials are still not in the repository. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-11-01: a failed start of the same version stays installed. `0.1.0` failing back to `0.1.0` says `This release is the one already installed.` No rollback plan is written. A newer schema still stays installed, and a version that is not major.minor.patch is still refused. `npx vitest run tests/updates.test.ts -t "previous release"` passed (1 test). The app was not started. Nothing was replaced. Signing credentials are still not in the repository.

2026-11-01: the next poll holds on the version in `rollback-plan.json`. A plan for `0.1.0` holds a newer `0.3.0`. That same plan can install `0.1.0` while the running release is `0.2.0` and the schema is still 5. An operator hold of `0.4.0` stays. A plan `secret-value` is ignored and that word is not in the decision. `npx vitest run tests/updates.test.ts -t "holds the next poll"` passed (1 test). The app was not started. Nothing was replaced. Signing credentials are still not in the repository. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.

2026-11-01: an older Mac does not download a signed installer. macOS 12.7 says `This Mac is older than macOS 13.` and that version is not in the decision. A runtime of `22.11.0` does not start the update poll. Linux still has no distribution floor. The app still starts. `npx vitest run tests/updates.test.ts tests/supported-platform.test.ts` passed (18 tests). The app was not started. Nothing was replaced. Signing credentials are still not in the repository. `apps/desktop/electron-builder.yml` still sets `mac.identity` to `null`.
