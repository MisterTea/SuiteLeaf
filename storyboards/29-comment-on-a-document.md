# 29 · Comment on a document

**Mode:** single-node · **App:** Docs · **Video:** [videos/29-comment-on-a-document.mp4](videos/29-comment-on-a-document.mp4) · **Script:** [scenes/29-comment-on-a-document.spec.ts](scenes/29-comment-on-a-document.spec.ts)

## Who and why

Jordan is reviewing Alex's "Quarterly Report" before it goes to the board. Jordan wants to point at specific sentences ("Is 12% right? Finance says 11.5%"), have Alex answer in the same thread, and close each point when it's settled. Alex works in Word, so the comments have to survive a trip through a .docx file and back.

## Inspired by

- WF-A2-06 and WF-A4-13 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): add and reply to comments. Both are marked out of scope for v1 ("no comment threads").
- [Docs Editors Help: Use comments, action items & emoji reactions](https://support.google.com/docs/answer/65129): select text, add a comment, reply, resolve, and reopen from comment history.
- [Docs Editors Community: "I accidentally pressed resolved… now it's hidden"](https://support.google.com/docs/thread/250483545/i-accidentally-pressed-resolved-on-a-comment-in-docs-and-now-it-s-hidden-how-can-i-retrieve-it?hl=en): resolved comments are hard to find again.
- [Live2Tech: download a Google Doc with comments](https://www.live2tech.com/how-to-download-comments-alongside-your-google-docs-a-step-by-step-guide/) and [Docs Editors Community: do resolved comments show in .docx?](https://support.google.com/docs/thread/62365473/do-resolved-comments-show-when-downloaded-in-docx-format?hl=en): resolved comments drop out of the Word download.
- ["Missing content" comments after a Google Docs round trip](https://helpdesk.uptimemadeeasy.com/learn/missing-content-comments-when-i-upload-to-google-d-5283565.aspx): Word comments uploaded to Docs and downloaded again come back unreadable.
- Storyboard [17](17-review-a-budget-with-notes-and-comments.md): Sheets already has comment threads in SuiteLeaf; Docs should feel the same.

## Scenes

1. **Open the report.** Jordan opens "Quarterly Report" on their own computer.
2. **Comment on a phrase.** Jordan selects "grew 12%" and presses Cmd/Ctrl+Alt+M. A comment card opens in the right margin level with the line, already focused. The phrase gets a yellow highlight.
3. **Write and post.** Jordan types "Is 12% right? Finance says 11.5%." and presses Cmd/Ctrl+Enter. The card shows Jordan's name, the time, and the text.
4. **Second comment by button.** Jordan selects a heading and clicks the "Add comment" button that appears in the margin beside the selection, then writes "Can we shorten this?"
5. **Close and reopen.** Jordan closes the file and opens it again. Both highlights and cards are still there.
6. **Send to Alex.** Jordan chooses File › Export DOCX. Alex opens it in Word: both comments show in Word's margin, anchored to the same words and signed "Jordan".
7. **Alex replies in Word.** Alex replies "Yes, 11.5% — fixed" to the first comment, corrects the number, and sends the .docx back.
8. **Import the reply.** Jordan opens the .docx in SuiteLeaf. The first card now shows Alex's reply under Jordan's comment, and the import summary says "2 comment threads imported".
9. **Resolve.** Jordan clicks the tick on the first thread. The highlight disappears, and the card collapses to "Resolved by Jordan".
10. **Find it again.** The Comments button in the header opens a panel with "Open" and "Resolved" tabs. Under Resolved, Jordan clicks the thread, it scrolls to "grew 11.5%", and **Reopen** brings it back.

## Google Workspace benchmark

In Google Docs, adding a comment takes 2 actions plus typing: select text, press Cmd/Ctrl+Alt+M or click the margin's comment button (1), type, click **Comment** (1). A reply is 2 clicks (the card, then Reply), and resolving is 1 (the tick). Reopening a resolved comment takes 4: the comment-history icon (1), the "All types" filter and Resolved (2), then **Re-open** (1). Sending to Word is File › Download › Microsoft Word (.docx), 3 clicks ([Docs Help](https://support.google.com/docs/answer/65129)).

Known pain points:

- Resolved comments are dropped from the .docx download, so a record of the discussion is lost unless you reopen them first ([Live2Tech](https://www.live2tech.com/how-to-download-comments-alongside-your-google-docs-a-step-by-step-guide/), [Docs Community](https://support.google.com/docs/thread/62365473/do-resolved-comments-show-when-downloaded-in-docx-format?hl=en)).
- Word comments that go through Docs can come back as "missing content" threads that can't be replied to ([help desk thread](https://helpdesk.uptimemadeeasy.com/learn/missing-content-comments-when-i-upload-to-google-d-5283565.aspx)).
- Comment anchors shift when the formatting is complex ([Live2Tech](https://www.live2tech.com/how-to-download-comments-alongside-your-google-docs-a-step-by-step-guide/)).
- Resolving by accident hides a comment, and people don't know where it went ([Docs Community](https://support.google.com/docs/thread/250483545/i-accidentally-pressed-resolved-on-a-comment-in-docs-and-now-it-s-hidden-how-can-i-retrieve-it?hl=en)).
- Read-only users can't see or export comments ([Stack Overflow](https://stackoverflow.com/questions/60682285/google-drive-api-v3-export-doc-and-preserve-comments)).

## Better than Google Workspace when

1. With text selected, Cmd/Ctrl+Alt+M opens a focused comment box, and Cmd/Ctrl+Enter posts it: 2 keystrokes plus typing, no mouse.
2. The commented text stays highlighted and linked to its thread after typing before it, inside it, and splitting its paragraph.
3. Reply, resolve, and reopen each take 1 click (or one shortcut) once the thread is open, and resolved threads are 1 click away in the Comments panel.
4. Comments, replies, authors, times, and resolved state survive save, close, and reopen, and Download SuiteLeaf file.
5. Export DOCX writes Word comments for every thread, including replies. Resolved threads are exported marked as done, not dropped. Word shows each comment on the same text with the author's name.
6. Opening a .docx with Word comments imports them as threads on the same text, with authors, dates, replies, and done state. The import summary counts them.
7. The first comment on a device asks for a display name once, and every later comment uses it. Nothing is signed with a placeholder like "Owner".
8. Deleting all the commented text keeps the thread in the panel, marked "Original text deleted", rather than losing it.

## Success looks like

- The report has two threads: one resolved, with Alex's reply from Word, and one open.
- The same threads, with replies and done state, appear in Word after another export.

## Gaps and notes

- **Docs has no comments.** `Docs.tsx` loads no comment mark or extension, there's no Insert › Comment item, and Cmd/Ctrl+Alt+M does nothing.
- **The header Comments button only works in Sheets.** It calls `sheetActions.openComments`, which is undefined for Docs and Slides, so clicking it there does nothing.
- **Word comments are dropped silently on import.** `word.ts` converts with Mammoth and doesn't read `comments.xml`. Its list of feature checks (tables, footnotes, tracked changes, and so on) doesn't include comments, so there's no warning either.
- **DOCX export writes no comments part.** `docx-export.ts` has no `comments.xml` output.
- A device display name already exists (`identity.ts`, used for Sheets comments), so Docs comments can use it from the start.
- In single-node mode comments live in the file, so nobody is notified. That's expected, and the .docx round trip is how they reach someone else.
