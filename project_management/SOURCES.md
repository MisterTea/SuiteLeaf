---
id: "PM-SOURCES"
title: "Research sources and evidence limits"
type: "research"
status: "reference"
created: "2026-10-29"
updated: "2026-10-29"
blocked: false
blocked_on: []
---

# Research sources and evidence limits

These sources informed the initial source-based comparison and work packages. They were consulted during the October 29, 2026 planning session. Official sources establish product capabilities; community reports identify useful problems to investigate. A complaint is not proof of prevalence, a security defect, or current vendor behavior. Verify live details before implementation or public comparisons. No source supplies a reliable estimate of SuiteLeaf effort or schedule.

The local implementation baseline is the repository working tree, including existing uncommitted changes, rather than a tagged or certified release. Each work package identifies code entry points. No new runtime certification is claimed by this planning portfolio.

## S01 — Google Workspace product scope

- Type: Official product overview.
- Source: [Google Workspace product scope](https://workspace.google.com/).
- Use and caveat: Establishes that Workspace includes communications and administration beyond Docs/Sheets/Slides; edition-specific capabilities still need checking.

## S02 — Microsoft 365 plan and service scope

- Type: Official documentation.
- Source: [Microsoft 365 plan and service scope](https://learn.microsoft.com/en-us/office365/servicedescriptions/office-365-platform-service-description/office-365-plan-options).
- Use and caveat: Separates service bundles and plan availability; do not assume every plan includes every capability.

## S03 — Excel for the web service description

- Type: Official documentation.
- Source: [Excel for the web service description](https://learn.microsoft.com/en-us/office365/servicedescriptions/office-online-service-description/excel-online).
- Use and caveat: Distinguishes browser Excel from desktop analysis/VBA capabilities. A baseline for declaring a supported subset.

## S04 — Administrator struggling with OneDrive sync

- Type: Reddit report.
- Source: [Administrator struggling with OneDrive sync](https://www.reddit.com/r/sysadmin/comments/1nkcn1t).
- Use and caveat: Qualitative report of stuck processing/downloading and prolonged troubleshooting, not a measured failure rate.

## S05 — User leaving OneDrive after sync problems

- Type: Reddit report.
- Source: [User leaving OneDrive after sync problems](https://www.reddit.com/r/onedrive/comments/1jfviac).
- Use and caveat: Illustrates confidence and recovery costs of opaque synchronization; individual experience.

## S06 — OneDrive and SharePoint restrictions

- Type: Official documentation.
- Source: [OneDrive and SharePoint restrictions](https://support.microsoft.com/en-us/onedrive/restrictions-and-limitations-in-onedrive-and-sharepoint).
- Use and caveat: Documents sync restrictions and capacity considerations. Limits and preview programs change; recheck before comparison.

## S07 — Available-offline slide deck failing to reopen offline

- Type: Reddit report.
- Source: [Available-offline slide deck failing to reopen offline](https://www.reddit.com/r/GoogleSlides/comments/1e456cr/make_available_offline_slide_deck_also_docs_and/).
- Use and caveat: Illustrates the distinction between marking a file offline and proving it can reopen with dependencies.

## S08 — Google Docs/Sheets/Slides offline support

- Type: Official documentation.
- Source: [Google Docs/Sheets/Slides offline support](https://support.google.com/docs/answer/6388102).
- Use and caveat: Confirms Google supports offline use with requirements; do not claim offline editing is absent.

## S09 — Shared Drive permission confusion

- Type: Reddit report.
- Source: [Shared Drive permission confusion](https://www.reddit.com/r/googleworkspace/comments/1hum62p).
- Use and caveat: Illustrates difficulty understanding access inheritance; not proof of a vendor security defect.

## S10 — Pima Community College Drive permission changes

- Type: Institutional IT guidance.
- Source: [Pima Community College Drive permission changes](https://service.pima.edu/TDClient/1920/Portal/KB/PrintArticle?ID=169819&SIDs=12062).
- Use and caveat: Documents operational impact of permission inheritance changes in that institution in 2025.

## S11 — How access works in Google shared drives

- Type: Official documentation.
- Source: [How access works in Google shared drives](https://support.google.com/a/users/answer/12380484).
- Use and caveat: Includes limited-access folder behavior. Do not use outdated claims that restricted folders are universally unsupported.

## S12 — Workspace offboarding workflow frustration

- Type: Reddit report.
- Source: [Workspace offboarding workflow frustration](https://www.reddit.com/r/googleworkspace/comments/1es1zl0).
- Use and caveat: Qualitative motivation for a single ownership/access lifecycle workflow.

## S13 — Data transfer when deleting a Workspace user

- Type: Google developer community discussion.
- Source: [Data transfer when deleting a Workspace user](https://discuss.google.dev/t/data-transfer-upon-user-account-deletion/364693).
- Use and caveat: 2026 community discussion about changed multi-step offboarding. Community replies are not authoritative product contracts.

## S14 — Google Vault FAQ

- Type: Official documentation.
- Source: [Google Vault FAQ](https://knowledge.workspace.google.com/vault/getting-started/google-vault-faq).
- Use and caveat: Explains retention/discovery, account deletion effects, and backup distinctions. Recheck exact policies for applicable editions.

## S15 — Formatting changes between Word and Google Docs

- Type: Microsoft community Q&A.
- Source: [Formatting changes between Word and Google Docs](https://learn.microsoft.com/en-us/answers/questions/5339252/formatting-changes-between-ms-word-and-googledocs).
- Use and caveat: User-facing evidence of interoperability concerns, not a comprehensive conversion benchmark.

## S16 — Google Docs to Word conversion fidelity

- Type: Microsoft community discussion.
- Source: [Google Docs to Word conversion fidelity](https://techcommunity.microsoft.com/discussions/word/converting-google-docs-to-microsoft-word-possible-formatting-changes/4144969/replies/4145042).
- Use and caveat: Motivates explicit conversion limits and round-trip testing; support responses are not guarantees.

## S17 — Word cross-references

- Type: Official documentation.
- Source: [Word cross-references](https://support.microsoft.com/en-us/word/create-a-cross-reference).
- Use and caveat: Professional document field/reference behavior used as a feature baseline.

## S18 — Power Query in Excel

- Type: Official documentation.
- Source: [Power Query in Excel](https://support.microsoft.com/en-us/excel/about-power-query-in-excel).
- Use and caveat: Data-ingestion/transformation baseline. Supported capabilities differ across platforms.

## S19 — Accessible PowerPoint presentations

- Type: Official documentation.
- Source: [Accessible PowerPoint presentations](https://support.microsoft.com/en-us/accessibility/powerpoint/make-your-powerpoint-presentations-accessible-to-people-with-disabilities).
- Use and caveat: Baseline for reading order, alt text, accessibility checks, captions, and supported export concerns.

## S20 — Word indexes

- Type: Official documentation.
- Source: [Word indexes](https://support.microsoft.com/en-us/word/create-and-update-an-index).
- Use and caveat: Baseline for marked entries and generated long-document indexes.

## S21 — Compare and merge document versions

- Type: Official documentation.
- Source: [Compare and merge document versions](https://support.microsoft.com/en-us/word/compare-and-merge-two-versions-of-a-document).
- Use and caveat: Review/combination baseline; compare product/platform versions during implementation.

## S22 — Slow Google Sheets discussion

- Type: Reddit report.
- Source: [Slow Google Sheets discussion](https://www.reddit.com/r/googlesheets/comments/1okg9r7/my_google_sheets_is_running_ridiculously_slow/).
- Use and caveat: Illustrates perceived slowness; establishes neither a universal cause nor a comparative benchmark.

## S23 — Diagnosing spreadsheet performance

- Type: Community Q&A.
- Source: [Diagnosing spreadsheet performance](https://webapps.stackexchange.com/questions/136635/how-do-i-find-out-what-is-slowing-down-google-sheets).
- Use and caveat: Motivates a profiler that identifies measured causes instead of generic advice. Historical qualitative evidence.

## S24 — Google Forms answer-based branching

- Type: Official documentation.
- Source: [Google Forms answer-based branching](https://support.google.com/docs/answer/141062).
- Use and caveat: Confirms branching capability and its supported question-type constraints.

## S25 — Permission management in team workspaces

- Type: Primary research.
- Source: [Permission management in team workspaces](https://arxiv.org/abs/2506.17317).
- Use and caveat: Threat-model context for add-on and workspace permission boundaries; not a finding about SuiteLeaf.

## S26 — Google Workspace support experience discussion

- Type: Reddit report.
- Source: [Google Workspace support experience discussion](https://www.reddit.com/r/gsuite/comments/1loy93g/absolutely_shitty_support_from_google_workspace/).
- Use and caveat: Contains negative reports and positive counterexamples; motivates diagnostics/escalation without claiming universal poor support.

## S27 — Unwanted AI and subscription increase

- Type: Reddit report.
- Source: [Unwanted AI and subscription increase](https://www.reddit.com/r/gsuite/comments/1kbsixy).
- Use and caveat: Qualitative objection to bundled AI/cost changes. User-posted prices are not current verified quotes.

## S28 — Google AI bundled into Workspace

- Type: Official announcement.
- Source: [Google AI bundled into Workspace](https://workspace.google.com/blog/product-announcements/empowering-businesses-with-ai).
- Use and caveat: Announcement of AI bundling and associated plan/pricing changes; use as historical context, not a current price list.

## S29 — Disabling Copilot across Microsoft 365 apps

- Type: Microsoft community Q&A.
- Source: [Disabling Copilot across Microsoft 365 apps](https://learn.microsoft.com/en-us/answers/questions/2181664/how-do-i-get-rid-of-or-disable-copilot-in-all-micr).
- Use and caveat: Illustrates user control/discoverability frustration. Do not infer all AI features are unremovable on every platform.

## S30 — Microsoft 365 licensing confusion

- Type: Reddit report.
- Source: [Microsoft 365 licensing confusion](https://www.reddit.com/r/sysadmin/comments/1m8fjnn).
- Use and caveat: Illustrates confusing service dependencies and naming; qualitative purchasing/admin concern.

