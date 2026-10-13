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

1. **Open the report.** Jordan opens "Quarterly Report". A mode switch at the right of the toolbar reads "Editing", next to a name field.
2. **Switch to Suggesting.** Jordan types the name Jordan and clicks **Suggesting** (Cmd/Ctrl+Alt+Shift+X does the same). The label turns green, reads "Suggesting", and stays in the toolbar and the status bar while Jordan scrolls.
3. **Suggest a few changes.** Jordan types "approximately " before "40 customers" (green and underlined), deletes "very" (struck through in red), and makes "on budget" bold (a dotted underline).
4. **Suggestion cards.** Each change has a card in the margin, with the author and time: "Jordan · Add “approximately”", "Delete “very”", "Format: bold". Each card has ✓ and ✗. Accept all and Reject all sit above the cards, so either is one click, and hovering previews the page.
5. **Still there after a reopen.** Jordan goes back to the files and opens the report again. The three cards are still Jordan's, and the file is still in Suggesting.
6. **Plain text asks.** File › Export TXT opens "Pending suggestions" and asks for the original text or the text with suggestions accepted. Nothing is chosen silently.
7. **Export to Word.** File › Export DOCX. The file contains Jordan's insertion, deletion, and bold as Word tracked changes.
8. **Manager adds one.** In Word the manager accepts the deletion and adds a tracked insertion, "(unaudited)". The file comes back.
9. **Import.** Jordan opens the returned .docx. The import summary says "3 suggestions imported", and the file opens in Suggesting. Cards show Jordan's remaining insertion and formatting change, and the manager's insertion signed "Alex's manager".
10. **Review.** Alex opens Tools › Review suggestions. The panel reads "3 suggestions". Alex accepts "approximately" and rejects the bold, one click each.
11. **Preview and accept the rest.** Alex hovers **Accept all**, the page shows "Preview: suggestions accepted" with the markup hidden, and Alex clicks it. Cmd/Ctrl+Z brings the accepted suggestion back, and Alex accepts it again.
12. **Back to editing.** Alex switches to Editing. Reopening the file later opens in Editing, because that was the last mode used. The report reads "We now serve approximately 40 customers and the project is on budget. (unaudited)".

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
- A .docx exported mid-review contains every pending suggestion as a Word tracked change, with the author and date.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Suggesting is one click or one shortcut, and the label stays visible | Met | Video 0:08–0:40: green "Suggesting" in the toolbar and the status bar. Shortcut covered by `tests/browser/suggestions.spec.ts`. |
| 2. Insertions, deletions, and formatting changes are separate suggestions, inline and on a card with author and time | Met | Video 0:18: green underline, red strike, dotted underline; cards "Jordan · 8:59 PM". Heading level covered by `tests/suggestions.test.ts`. |
| 3. One click accepts or rejects one suggestion; Accept all or Reject all is at most two clicks and previews first | Met | Video 0:34 one-click accept and reject. Video 0:38 hover shows "Preview: suggestions accepted"; Accept all is on the page. |
| 4. Undo after Accept all or Reject all restores every suggestion it affected | Met | Video 0:40 and `tests/suggestions.test.ts` ("undo restores an accept-all"). |
| 5. Suggestions, with authors and times, survive save, close, and reopen | Met | Video 0:20–0:24, reopened with the same three cards. |
| 6. Export DOCX writes `w:ins`, `w:del`, and `w:rPrChange` with author and date, and accepting all matches SuiteLeaf | Met | `tests/suggestions.test.ts` ("writes revisions and imports them with their authors"). |
| 7. Opening a .docx keeps tracked changes as suggestions with their authors, and the import summary counts them | Met | Video 0:32: "3 suggestions imported", cards for Jordan and Alex's manager. |
| 8. TXT or HTML export asks whether to use the accepted text or the original | Met | Video 0:24: "Pending suggestions" dialog, Original text or Suggestions accepted. |

## Gaps and notes

- The recording does not open Microsoft Word. The exported file is checked for `w:ins`, `w:del`, and `w:rPrChange`, and a returned file is built by accepting the deletion and adding the manager's insertion.
- Heading-level suggestions are stored, shown, and exported as `w:pPrChange`. This story uses bold; the heading case is in `tests/suggestions.test.ts`.
- A file imported with tracked changes opens in Suggesting, so the next keystroke stays a proposal.
- Suggestion cards use the right margin. Comments (storyboard [29](29-comment-on-a-document.md)) are not built here.
- There is still no Viewing mode. In single-node mode it would be a "read without accidentally typing" switch, and it is the view-only state cluster viewers need (storyboard [27](27-share-a-document-with-a-teammate.md)).
