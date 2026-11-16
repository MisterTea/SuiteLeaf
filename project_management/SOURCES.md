# Source register

Microsoft sources retrieved through web search on 2026-11-15. These are current first-party feature descriptions, not independently exercised Office builds. URLs may redirect as Microsoft reorganizes support. Recheck platform and licensing statements before release. No Microsoft material is copied into the repository as a reference dataset.

## Microsoft benchmark

### S1: Word web versus desktop

[Word web versus desktop](https://support.microsoft.com/en-us/word/word-features-comparison-word-for-the-web-vs-desktop). Word feature/platform distinctions; not evidence of SuiteLeaf support.

### S2: PowerPoint features across platforms

[PowerPoint features across platforms](https://support.microsoft.com/en-us/powerpoint/compare-powerpoint-features-on-different-platforms). Media, collaboration and platform distinctions; the table is not exhaustive.

### S3: Power Query in Excel for the web

[Power Query in Excel for the web](https://support.microsoft.com/en-us/excel/use-power-query-in-excel-for-the-web). Web query authoring/refresh and subscription qualifications. Do not incorrectly classify all Power Query as desktop-only.

### S4: Power Query data sources by Excel version

[Power Query data sources by Excel version](https://support.microsoft.com/en-us/excel/power-query-data-sources-in-excel-versions). Connector, authentication and refresh limitations vary by platform.

### S5: Power Pivot overview

[Power Pivot overview](https://support.microsoft.com/en-us/excel/power-pivot-overview-and-learning). Relational models and calculations are distinct from basic pivot summaries.

### S6: Record a PowerPoint presentation

[Record a PowerPoint presentation](https://support.microsoft.com/en-us/powerpoint/record-your-presentation). Recording and presenter workflow benchmark.

### S7: Turn a presentation into video

[Turn a presentation into video](https://support.microsoft.com/en-us/powerpoint/turn-your-presentation-into-a-video). Portable video deliverable, distinct from simply displaying a deck.

### S8: Office version history

[Office version history](https://support.microsoft.com/en-gb/office/collab-files/view-previous-versions-of-office-files?nochrome=true). Cloud storage dependency for the described version-history feature.

### S9: Office Scripts versus VBA

[Office Scripts versus VBA](https://learn.microsoft.com/en-us/office/dev/scripts/resources/vba-differences). Separate automation technologies; platform and security models differ.

### S10: Office applications service description

[Office applications service description](https://learn.microsoft.com/en-us/office365/servicedescriptions/office-applications-service-description/office-applications-service-description). Product/edition/platform scope; do not conflate application licensing and hosted services.

### S11: Office Accessibility Checker

[Office Accessibility Checker](https://support.microsoft.com/en-gb/accessibility/office-accessibility/make-your-content-accessible-to-everyone-with-the-accessibility-checker?nochrome=true). Checker availability; not a substitute for assistive-technology workflow testing.

### S12: Microsoft Copilot privacy and security

[Microsoft Copilot privacy and security](https://learn.microsoft.com/microsoft-365-copilot/microsoft-365-copilot-privacy?view=o365-worldwide). Permission-scoped organizational data as an assistant benchmark; not SuiteLeaf compliance evidence.

## SuiteLeaf baseline

Read [README](../README.md), [capability documentation](../docs/capabilities.md), [catalog](../packages/core/src/capabilities/catalog.ts), [capability rows](../packages/core/src/capabilities/catalog-data.ts), [additional partial capabilities](../packages/core/src/capabilities/catalog-completed.ts) and [catalog source checks](../tests/capabilities/catalog-sources.test.ts). Feature-specific evidence is linked in COMPARISON.md and each package.

The assessment includes documentation and source entry points for Office import/export, pagination, queries, pivots, slides, review, mail, backups, updates, identity, accessibility, automation and integration modules. It is not a line-by-line audit of every implementation. File presence establishes an investigation starting point, not runtime correctness.

## Important evidence limitations

- The catalog's November 4 test/coverage results are historical; no current full-suite coverage result was measured for this planning task.
- `docs/office-compat.md` explicitly says Office automation is macOS-only, page/slide counts are the layout probe, comments are not read by either reference and some fixture objects are absent. A fallback LibreOffice run is not an Office pass.
- Old package completion labels conflicted with partial catalog states. All package contents are replaced with new acceptance work; the old labels are not imported as completion evidence.
- The worktree already contained unrelated edits in AI, collaboration, drive, slides and workspace files. Those were left intact. Evidence about these areas must be tied to the eventual tested revision.
- No proprietary Office reference files, production accounts or user documents were imported or changed. Exact Office builds, real identity/mail test providers and external-display devices remain execution prerequisites for the relevant packages.
- No new rendering or font mismatch was observed. Font fidelity work is a verification requirement, not a fabricated defect report.
