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
2. **Comment on a phrase.** Jordan selects "grew 12%" and presses Cmd/Ctrl+Alt+M. A comment card opens in the right margin, the comment box focused, and the phrase turns yellow.
3. **Name, then post.** Jordan types "Is 12% right? Finance says 11.5%." and presses Cmd/Ctrl+Enter. The first comment on this computer asks for a name. Jordan types "Jordan" and presses Cmd/Ctrl+Enter again. The card shows Jordan, the time, and the question. Later comments skip the name.
4. **The highlight stays put.** Typing before the phrase leaves the highlight on "grew 12%". Typing inside it extends the highlight. Splitting the paragraph keeps both pieces highlighted. Undo puts the sentence back.
5. **Second comment by button.** Jordan selects "Outlook for the rest of the year" and clicks **Add comment** in the margin. No name is asked. Jordan writes "Can we shorten this?" and posts with Cmd/Ctrl+Enter.
6. **Close and reopen.** Jordan goes back to the files and opens the report again. Both highlights and cards are still there.
7. **Send to Alex.** Jordan chooses File › Export DOCX. The file carries both threads, on the same words, signed Jordan.
8. **Alex replies in Word.** Alex replies "Yes, 11.5% — fixed", corrects the figure, and sends the file back. The recording shows that hand-off with a caption; SuiteLeaf then opens the file Alex sent.
9. **Import the reply.** The banner reads "2 comment threads imported". The first card shows Alex's reply under Jordan's question, on "grew 11.5%".
10. **Resolve.** Jordan clicks the tick. The highlight disappears and the card collapses to "Resolved by Jordan". Exporting again keeps that thread in the Word file, marked done.
11. **Find it again.** The Comments button opens a panel with Open and Resolved tabs. Under Resolved, Jordan clicks the thread and **Reopen** brings the highlight and the reply back.

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

- Both threads are on the report: the growth thread shows Jordan's question and Alex's reply on "grew 11.5%", and the outlook thread is still open.
- Resolving collapsed that thread to "Resolved by Jordan" and cleared the highlight; Reopen put it back.
- A second DOCX export still contains the reply and marks the resolved thread done.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Cmd/Ctrl+Alt+M focuses the comment box; Cmd/Ctrl+Enter posts it | Met | Video 0:08–0:14. With a saved name, `document comments post from the keyboard and stay linked to the text` asserts the box is focused and posts with no click. The first comment on a computer adds the name step in criterion 7. |
| 2. Highlight stays linked through edits before, inside, and splitting the paragraph | Met | Video 0:15 (typed inside "12%") and 0:19 (paragraph split, both pieces highlighted). Same browser test. |
| 3. Reply, resolve, and reopen are one click once the thread is open; resolved threads are one click away in the panel | Met | Reply is the button on the open card. Video 0:38 resolve tick, 0:42 Resolved tab, 0:46 Reopen. |
| 4. Threads survive save, close, reopen, and Download | Met | Video 0:28 close and reopen. Browser test downloads the SuiteLeaf file and checks the author, quote, and orphan flag. |
| 5. DOCX export writes every thread, including replies; resolved threads are marked done, not dropped | Met | Video 0:32 export, and the second export after resolve. `tests/doc-comments.test.ts` checks authors, anchors, replies, and `w15:done="1"` with no reply required. |
| 6. Opening a DOCX imports threads on the same text, with authors, dates, replies, done state, and a count | Met | Video 0:36 banner "2 comment threads imported", Alex's reply on "grew 11.5%". Same vitest. |
| 7. The first comment asks for a display name once; nothing is signed "Owner" | Met | Video 0:10 name field, then the second comment skips it. Cards say Jordan and Alex. |
| 8. Deleting the commented text keeps the thread, marked "Original text deleted" | Met | Browser test deletes the anchor and checks the panel, the downloaded file, and reopen. Not in the story video, so the ending stays the two live threads. |

## Gaps and notes

- The recording does not launch Microsoft Word. Alex's reply is written into the exported package (a reply comment, the thread link, and "grew 11.5%") and opened again. That package is what Word reads; the vitest checks the same comments, authors, and done flags.
- In single-node mode comments live in the file, so nobody is notified. The .docx round trip is how they reach someone else.
- A selection that is already entirely inside a comment focuses that thread instead of stacking a second anchor on the same words.
- When two tall cards would run off the bottom of the window, the page scrolls so both stay in view, which can leave a short resolved chip a little above its line.
- Suggesting mode, sharing, spelling, and tables of contents or footnotes are other storyboards and are not built here.
