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

## AI version

**Script:** [scenes/ai/17-review-a-budget-with-notes-and-comments-ai.spec.ts](scenes/ai/17-review-a-budget-with-notes-and-comments-ai.spec.ts) · **Video:** [videos/17-review-a-budget-with-notes-and-comments-ai.mp4](videos/17-review-a-budget-with-notes-and-comments-ai.mp4) (web) · [videos/electron/17-review-a-budget-with-notes-and-comments-ai.mp4](videos/electron/17-review-a-budget-with-notes-and-comments-ai.mp4) (desktop)

Alex opens the "Sample budget" as in the original. Then Alex opens the assistant and types one request:

> Add a note to Engineering's actual saying it includes the contractor invoice from September. Then leave Jordan a comment on Engineering's remaining: it's $1,200 under budget, can Research use $600 of it for the user study? Sign it as Alex, then download the file so I can send it to Jordan.

The spec checks the original's end state in the file Gemma downloaded (on the desktop, the file its Save As wrote). C3 must have a note mentioning the contractor invoice and September. D3 must have a comment thread that mentions Research and $600, saved with `authorName` "Alex". Then the person hovers C3 to read the note back, and opens the Comments panel, which lists the thread on D3, signed "Alex". Jordan's part is still done by a person, off camera, as in the original. Jordan opens the downloaded copy on another computer, where it still reads "Alex", replies, and saves it. On the web, Jordan uses a second browser profile; on the desktop, a second copy of the app with its own data folder and the name "Jordan". Alex opens the returned copy. On the web, SuiteLeaf asks whether to replace the budget or keep both, and Alex keeps both. The desktop app opens it as "… copy" without asking. The reply sits under the question, and each is signed by its writer.

Signing the comment is part of the request rather than a separate step for Alex. `add_comment` takes an optional `signed_as`, which sets the same per-computer name as Sheet tools › "Your name on comments…". So "Sign it as Alex" works in one call, and later comments on that computer are signed too. When someone is signed in to a server, the account name is used and the tool says so.

**Tools Gemma used:** `add_note` (C3), `add_comment` (D3, `signed_as: "Alex"`) and `download_file`, every time and in that order. A run takes 3 tool calls and about 10–30 seconds. In the recordings, the purple pointer goes to C3 and the note pops up beside it, just as Sheet tools › "Add or edit cell note" opens it. Then the pointer moves to D3, where the new thread opens with Alex's name and the question. Last, it goes to Download (Save As on the desktop).

**How Gemma did:** after the last tool change, the web storyboard passed 3 of 3 times, and the request itself also went right in a fourth run that failed later for a script reason. The desktop (llama.cpp) storyboard passed 2 of 2 times, and its request also went right in a third run that failed in the script. It always found the right cells from "Engineering's actual" and "Engineering's remaining", and it kept the note close to the user's words. What it did before the fixes, and small habits:

- With no way to sign a comment, it put the name into the text ("… for the user study? -Alex"), so the saved comment had no author.
- With `signed_as` described only on the parameter, it ignored "Sign it as Alex" once. That run also printed an invented tool response as text ("response:add_comment{…}"). After `add_comment`'s own description said when to pass a name, it used `signed_as` in every run.
- It never begins the comment with "Jordan,", although the request says it's for Jordan. The question reads "It's $1,200 under budget, can Research use $600 of it for the user study?". Since nobody is notified (see below), Jordan only finds it by opening the file.

Changes made while recording it (in `apps/web/src/ai/tools/sheets.ts` and `apps/web/src/editors/Sheets.tsx`, with a tool test in `tests/browser/ai-tools.spec.ts`):

- `add_comment` has `signed_as`, wired to the per-computer comment name. A trailing "-Alex" in the text is dropped when the same name is given. The result says where the comment went, who signed it (or that it is unsigned and will read "Anonymous" to others) and its text.
- Comments added by the agent had no paragraph data, so their cards showed the author and time but no text. They now show their text.
- `add_note` used to pin the note open (`show: true`). The note covered D3 and stayed pinned in the saved file. Now it opens the note like the menu does, and the note closes when the selection moves. The result names the row and column ("C3 (Engineering, Actual)").
- `read_notes_and_comments` used to return comments with empty text. It now lists each comment's text, who signed it, and its replies.
- The original script now answers the "already in this browser" dialog that re-opening a downloaded file shows on the web (Keep both). Without that, the original storyboard timed out.

## Gaps and notes

- In single-node mode, a name has to be set once per computer (Sheet tools › "Your name on comments…"). Comments written before that are signed "You" on your own computer and "Anonymous" on other people's.
- Changing your name re-labels the comments you wrote on this computer, the same as renaming an account. Copies you've already sent keep the name they were saved with.
- @-mentions have no one to notify, so the question names Jordan in its text.
- Notes and comments are reachable from three places with different labels: Sheet tools ("Add or edit cell note", "Add cell comment"), Insert › Cell comment, and the grid's right-click menu ("Add Note", "Add Comment").
- Comments are local to the file: nobody is notified, and replies only appear when someone opens that copy. Re-opening a returned file doesn't merge the replies into your original. On the web, SuiteLeaf asks whether to replace your copy or keep both (making a "… copy"). The desktop app makes the "… copy" without asking.
- Clicking a thread in the panel highlights its cell but doesn't move the selection there. It also opens a second copy of the thread, with its own reply box, beside the cell.
