# 17 · Review a budget with notes and comments

**Mode:** single-node · **App:** Sheets · **Video:** [videos/17-review-a-budget-with-notes-and-comments.mp4](videos/17-review-a-budget-with-notes-and-comments.mp4) · **Script:** [scenes/sheets.spec.ts](scenes/sheets.spec.ts)

## Who and why

Alex is reviewing the studio budget before handing it to Jordan, who owns the Research line. Alex wants to leave two kinds of annotation: a quiet explanation of why Engineering's actual is so high, and a question that Jordan should answer.

## Inspired by

- WF-B2-12 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md) (comments and notes) and the README: "Sheet tools adds … local cell notes and comment threads"; comments are local to the file.
- [Comment vs note in Google Sheets](https://how-to-sheets.com/getting-started/comment-vs-note-in-google-sheets): notes are static context shown on hover; comments are threads with replies and resolution.
- [Google Docs Editors Help: Use comments, action items & emoji reactions](https://support.google.com/docs/answer/65129): add a comment, reply, resolve, and see all comments in a panel.

## Scenes

1. **Open the budget.** Alex opens the "Sample budget" (Quarterly studio budget).
2. **Add a note.** With C3 (Engineering, Actual) selected, Alex chooses Sheet tools › "Add or edit cell note" and types "Includes the contractor invoice from September."
3. **Read it back.** Alex jumps to G12 with the name box. The note closes, and C3 keeps a small corner marker. Hovering C3 pops up the note; moving away hides it.
4. **Sign comments.** Alex chooses Sheet tools › "Your name on comments…", types "Alex" and clicks Save. The name is kept on this computer. Until a name is set, your own comments show "You". When you're signed in to a SuiteLeaf server, your account name is used and this item is hidden.
5. **Ask a question.** With D3 (Engineering, Remaining) selected, Alex clicks the toolbar's "Insert comment" button. The draft is already signed "Alex". Alex types "Jordan, Engineering is $1,200 under budget. Can Research use $600 of it for the user study?" and clicks Comment.
6. **Comments panel.** The speech-bubble button at the top right opens "Comment Management". It lists the thread under "D3 · Sheet1", signed "Alex", with the time.
7. **Share.** Alex downloads the file for Jordan. The note and the signed thread are saved inside it.
8. **Jordan replies.** On their own computer (off camera), Jordan opens the copy. The question still reads "Alex". Jordan replies "Yes, Research will take the $600. Thanks!" and sends the file back.
9. **Read the reply.** Alex opens Jordan's copy. In the Comments panel, Jordan's reply sits under Alex's question, and each is signed by its writer. Clicking the thread highlights D3 in orange and opens a "Reply or add others with @" box. The tick resolves the thread and the bin deletes it.

## Success looks like

- C3 has a hover note and D3 has a comment thread, and both are in the downloaded native file.
- The Comments panel lists the thread with its cell reference.
- Every comment shows who wrote it, including on another computer. The writer's name is saved with the comment (`authorName`).
- The note popup closes whenever the selection moves to another cell, including from the name box.

## Gaps and notes

- In single-node mode, a name has to be set once per computer (Sheet tools › "Your name on comments…"). Comments written before that are signed "You" on your own computer and "Anonymous" on other people's.
- Changing your name re-labels the comments you wrote on this computer, the same as renaming an account. Copies you've already sent keep the name they were saved with.
- @-mentions have no one to notify, so the question names Jordan in its text.
- Notes and comments are reachable from three places with different labels: Sheet tools ("Add or edit cell note", "Add cell comment"), Insert › Cell comment, and the grid's right-click menu ("Add Note", "Add Comment").
- Comments are local to the file: nobody is notified, and replies only appear when someone opens that copy. Re-opening a returned file makes a "… copy" next to your original rather than merging the replies into it.
- Clicking a thread in the panel highlights its cell but doesn't move the selection there. It also opens a second copy of the thread, with its own reply box, beside the cell.
