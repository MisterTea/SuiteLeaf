# 30 · Suggest changes and accept them

**Mode:** single-node · **App:** Docs · **Video:** [videos/30-suggest-changes-and-accept-them.mp4](videos/30-suggest-changes-and-accept-them.mp4) · **Script:** [scenes/30-suggest-changes-and-accept-them.spec.ts](scenes/30-suggest-changes-and-accept-them.spec.ts)

## Who and why

Jordan is editing Alex's "Quarterly Report", but it's Alex's report, so Jordan wants every change to be a proposal that Alex can accept or turn down. Alex's manager reviews in Word with Track Changes, so the suggestions have to arrive in Word as tracked changes and come back the same way.

## Inspired by

- WF-A2-08 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): editing, suggesting, and viewing modes ("suggesting (tracked changes) out-of-v1").
- [Live2Tech: switch between Editing and Suggesting](https://www.live2tech.com/how-to-switch-between-editing-mode-and-suggesting-mode-in-google-docs/): the mode button, the shortcuts, and "Preview accept all" in the review panel.
- [Popular Science: switching modes "is a chore"](https://www.popsci.com/diy/google-docs-editing-shortcut/), and [Spell: why you keep landing in Suggesting mode](https://spellapp.com/resources/how-to-get-out-of-suggesting-mode-in-google-docs): people lose track of which mode they're in.
- [WPS: Google Docs suggested edits missing in Word](https://www.wps.com/office-quick-solution/document-file-issues/how-to-fix-google-docs-suggested-edits-missing-in-a-word-file/) and [UMA Technology: tracked changes when saving a Google Doc to Word](https://umatechnology.org/problem-with-tracked-changes-when-saving-a-google-doc-to-word/): formatting suggestions and markup don't transfer reliably.
- [Stack Overflow: export a Google Doc with suggested changes to plain text](https://stackoverflow.com/questions/38415390/export-google-doc-with-suggested-changes-to-plain-text): plain-text export silently uses the original text. The workaround is to make a copy, accept all, then download.

## Scenes

1. **Open the report.** Jordan opens "Quarterly Report". A mode menu at the right of the toolbar reads "Editing".
2. **Switch to Suggesting.** Jordan picks **Suggesting** from the menu (Cmd/Ctrl+Alt+Shift+X does the same). The label turns green, reads "Suggesting", and stays visible while Jordan scrolls.
3. **Suggest a few changes.** Jordan types "approximately " before "40 customers" (green and underlined), deletes "very" (struck through in red), and makes "on budget" bold (a dotted underline).
4. **Suggestion cards.** Each change has a card in the margin: "Jordan · Add "approximately "", "Delete "very"", "Format: bold". Each card has ✓ and ✗.
5. **Export to Word.** File › Export DOCX. In Word, with All Markup, the three changes appear as tracked changes by Jordan: an insertion, a deletion, and a formatting change.
6. **Manager adds one.** In Word the manager accepts the deletion and adds a tracked insertion, "(unaudited)". The file comes back.
7. **Import.** Jordan opens the returned .docx. The import summary says "2 suggestions imported". Cards show Jordan's remaining insertion and formatting change, and the manager's insertion signed with the manager's name.
8. **Review.** Alex opens Tools › Review suggestions. The panel reads "3 suggestions". Alex accepts "approximately" and rejects the bold.
9. **Preview and accept the rest.** Alex hovers **Accept all**, the page shows the result with markup hidden, and Alex clicks it. Cmd/Ctrl+Z brings the accepted suggestion back as a suggestion, and Alex accepts it again.
10. **Back to editing.** Alex switches to Editing. Reopening the file later opens in Editing, because that was the last mode used.

## Google Workspace benchmark

In Google Docs, switching modes takes 2 clicks (the mode button, then Suggesting) or Ctrl+Alt+Shift+X. Each suggestion card has accept and reject buttons (1 click each). Accepting everything takes 3 clicks: Tools › Review suggested edits (2), then Accept all (1). There's a preview of the result. The Word round trip is File › Download › Microsoft Word (.docx), 3 clicks, and Word must be set to "All Markup" to see the changes ([WPS](https://www.wps.com/office-quick-solution/document-file-issues/how-to-fix-google-docs-suggested-edits-missing-in-a-word-file/)).

Known pain points:

- People forget which mode they're in, or arrive in Suggesting from a shared setting, and don't understand why their edits are proposals ([Spell](https://spellapp.com/resources/how-to-get-out-of-suggesting-mode-in-google-docs), [Popular Science](https://www.popsci.com/diy/google-docs-editing-shortcut/)).
- Formatting changes and overlapping comments and suggestions don't survive the trip to Word reliably ([UMA Technology](https://umatechnology.org/problem-with-tracked-changes-when-saving-a-google-doc-to-word/)).
- Plain-text and other non-Word exports silently drop pending suggestions, and the workaround takes 6 steps ([Stack Overflow](https://stackoverflow.com/questions/38415390/export-google-doc-with-suggested-changes-to-plain-text)).

## Better than Google Workspace when

1. Switching to Suggesting takes 1 click on the mode menu or one shortcut, and while suggesting is on, every frame of the recording shows a "Suggesting" label in the editor.
2. Insertions, deletions, and formatting changes (bold, italic, underline, heading level) each become a separate suggestion, shown inline and in a margin card with author and time.
3. Accepting or rejecting one suggestion takes 1 click, and Accept all or Reject all takes at most 2 clicks from the editor, with a preview of the result before confirming.
4. Cmd/Ctrl+Z after Accept all or Reject all restores every suggestion it affected.
5. Suggestions, with authors and times, survive save, close, and reopen.
6. Export DOCX writes insertions, deletions, and formatting changes as Word tracked changes (`w:ins`, `w:del`, `w:rPrChange`) with author and date. Accepting all in Word gives the same text and formatting as accepting all in SuiteLeaf.
7. Opening a .docx with tracked changes keeps them as suggestions with their original authors instead of accepting them, and the import summary counts them.
8. Exporting to TXT or HTML while suggestions are pending asks whether to export with suggestions accepted or the original text, rather than choosing silently.

## Success looks like

- The report contains the accepted wording, no pending suggestions, and no formatting the reviewers rejected.
- A .docx exported mid-review opened in Word with every pending suggestion as a tracked change.

## Gaps and notes

- **No suggesting mode.** There's no mode menu, no tracked-change marks in the Tiptap schema, and no review panel. Tiptap has no built-in track changes, so this needs an extension that records insertions, deletions, and formatting changes as marks with author and time.
- **Word import accepts tracked changes.** `word.ts` detects `<w:ins>`/`<w:del>` and warns "Tracked changes are imported as accepted text; review history is not retained."
- **DOCX export writes no revisions.** `docx-export.ts` has no `w:ins`, `w:del`, or `w:rPrChange` output.
- Suggestion cards share the margin with comments, which also don't exist yet in Docs (storyboard [29](29-comment-on-a-document.md)). Building the margin once for both would avoid two layouts.
- There's no Viewing mode either. In single-node mode it's mainly useful as a "read without accidentally typing" switch, and it would also be the view-only state that cluster viewers need (storyboard [27](27-share-a-document-with-a-teammate.md)).
