# Delivery roadmap

This roadmap prioritizes finishing and proving user workflows. It does not schedule a rewrite. The four waves below are new planning groups, not a claim that the historical catalog phase gates passed.

## Priorities

- **P0:** trust in saved data, interoperability, collaboration, recovery and accessibility. Accessibility begins in wave 1, although its cross-editor acceptance gate closes in wave 3.
- **P1:** professional desktop workflows and a supportable team pilot.
- **P2:** broader workspace differentiation and advanced ecosystem scope. P2 does not mean necessary features can be omitted from an unrestricted Office-parity claim.

## Wave 1: safe files and a measurable baseline

Packages: WP-001–006 and WP-010–016. Begin the WP-029 accessibility audit immediately. Start with WP-001 and WP-012 fixture/reference setup, then run save/recovery and the three format pipelines. Fix high-severity content loss and wrong calculation before visual polish. Document collaboration is the shared foundation for sheet and slide integration.

Exit: all supported fixtures have zero silent content loss; calculation differences are explained or fixed; crash/reconnect preserves acknowledged changes; an independent clean-cluster restore succeeds; release/update paths have measured recovery. Office reference unavailability blocks the Office fidelity claim, not all development. A LibreOffice result is labeled as such.

## Wave 2: usable and operable team pilot

Packages: WP-007–009, WP-026–028, WP-033–036. Start permissions early because later services depend on them. Discovery and scaffolding can run before dependencies finish; final acceptance cannot. WP-027 waits for the review semantics in WP-018, and WP-036 waits for the relevant format work. Therefore waves overlap rather than being strict sequential sprints.

Exit: a pilot imports a mixed folder, shares it, finds permitted content, reviews a document, revokes access, offboards an employee and exports all file bytes. Operators recover from a failed node and diagnose errors with redacted evidence. AI cannot bypass the same permissions. Identity-provider checks need a configured test tenant.

## Wave 3: professional authoring and delivery

Packages: WP-017–025 and WP-029–030. Prioritize the report, financial workbook and presentation below. Ship slices after their own acceptance; do not wait for all advanced analytics to finish before shipping a stable editor improvement.

Exit workflows:

1. **Word:** import and revise a 100-page report containing sections, tables, figures, references and tracked changes; update fields; reopen in Word and print without unexplained content or layout loss.
2. **Excel:** import a budget, recalculate supported formulas, refresh a joined source, pivot and chart the result, audit an error and print selected pages; reopen in Excel with equivalent results.
3. **PowerPoint:** edit a 30-slide branded deck, change its master, collaborate, present with private notes on another display, and export both editable PPTX and narrated video.
4. **Inclusive operation:** complete the primary workflows with keyboard/assistive technology; complete the declared phone/tablet subset with no hidden controls or lifecycle data loss.
5. **Forms:** if included in the release claim, concurrent response submission, privacy and authorized export pass on the deployed cluster.

## Wave 4: automation and the broader suite

Packages: WP-031–032 and WP-037–038. Define macro, Outlook/Exchange, OneNote, Access, Teams/Planner and diagramming boundaries early; implement selected integrations after the core contracts stabilize. Each XL package must be divided into bounded releases with its own supported-feature list.

Exit: safe automation and policy enforcement are demonstrated; selected mail/calendar/notebook/task workflows interoperate; every deferred ecosystem feature has an explicit exclusion and migration route. An integration is not marketed as a native application replacement. A limited script engine is not VBA or COM compatibility.

## Sizing and staffing

Effort is a rough engineering estimate for completing the stated scope, not elapsed calendar time: S = 1–2 engineer-weeks; M = 3–5; L = 6–10; XL = 12–24 or more. Estimates include implementation and validation but exclude procurement and waiting for external tenants/devices. Confidence is low until WP-001/WP-012 discovery; XL packages may require separate product decisions and much longer programs. Do not total these as a delivery commitment.

Suggested responsibility: an interoperability/rendering owner for WP-012–019/023; a spreadsheet owner for WP-003/015/020–022; a workspace/platform owner for persistence, collaboration and enterprise services; a cross-cutting quality/accessibility owner. This describes staffing needs, not assignments or spawned agents. No delivery date is promised without actual capacity.

## First iteration

1. Reconcile source/catalog/README claims; establish exact supported Office builds, platforms and formats.
2. Capture a minimal representative DOCX/XLSX/PPTX reference set and current failure inventory. Extend to the 90-fixture corpus before claiming the full gate.
3. Prove save/crash recovery across browser-local, desktop and cluster modes; triage existing uncommitted changes before integrating new fixes.
4. Rank format failures by data loss, wrong results, unusable layout and authoring limitations. Select one accepted vertical slice per editor.
5. Audit keyboard and canvas accessibility in those same slices, and assign owners/estimates based on observed failures.

## Measurement rules

Numeric targets in packages are proposed acceptance goals, not measured SuiteLeaf performance. Freeze hardware, fixture scope and tolerances before evaluation; changes to targets require a recorded reason. Count unsupported, blocked and untested cases separately. Require zero unresolved data-loss, permission-bypass or wrong-supported-calculation defects in the release subset. Record visual tolerances per fixture; never hide pagination, clipping or font-metric defects in an average score.
