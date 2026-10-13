# 49 · Mention someone in a comment

**Mode:** single-node · **App:** Docs · **Video:** [videos/49-mention-someone-in-a-comment.mp4](videos/49-mention-someone-in-a-comment.mp4) · **Script:** [scenes/49-mention-someone-in-a-comment.spec.ts](scenes/49-mention-someone-in-a-comment.spec.ts)

## Who and why

Jordan is commenting on Alex's "Quarterly Report" (storyboard 29). One note is for Alex in particular: "Is 12% right?" Jordan wants to write @Alex on that comment so that, when Alex opens the file, the page is already at that thread. Nobody should get an email. On this computer the name Alex is just the name stored locally. On the club's server the same @ can match an account, still with no mail.

## Inspired by

- WF-A4-13 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): comment threads. Mentions are how a thread is aimed at one person.
- Storyboard [29](29-comment-on-a-document.md): comments, replies, the local display name, and a DOCX round trip. Nothing in a comment is a mention.
- [Use comments & action items](https://support.google.com/docs/answer/65129): type @ and a name, and that person is emailed.
- [Manage your notifications](https://support.google.com/docs/answer/91588): each file has its own email setting for "Comments for you", which is the @mention mail.
- [Docs Editors Community: a resolved comment is hard to find](https://support.google.com/docs/thread/250483545/i-accidentally-pressed-resolved-on-a-comment-in-docs-and-now-it-s-hidden-how-can-i-retrieve-it): even a comment you were sent can be off screen.

## Scenes

1. **Jordan's name is already set.** This computer already stores Jordan and Alex. Jordan starts "Quarterly Report". Nobody is emailed.
2. **Mention Alex.** Jordan selects "grew 12%" and adds a comment, already signed Jordan. Typing "@Al" suggests Alex, marked "On this computer", and also offers the typed letters as a name with no account. Enter inserts Alex as a blue name, not as ordinary letters. Jordan finishes "please check this" and posts with Cmd/Ctrl+Enter. The card shows the name apart from the sentence. There is no notify checkbox.
3. **A second comment, not for Alex.** Jordan comments on "Outlook for the rest of the year": "Can we make this shorter?" No mention.
4. **The Word file keeps the name.** File, Export DOCX. The Word comment on "grew 12%" includes Alex's name. Nothing offers to email Alex.
5. **Jordan is not scrolled.** Jordan closes the file and opens it again. The page stays at the top. Scrolling down, Alex is still a mention on the card, and the card is not marked For you.
6. **Alex opens it.** The recording sets the stored name to Alex and opens the same file. The view moves to the "grew 12%" comment, and that card is marked For you. The outlook comment is not the one in view.
7. **The Word copy does the same.** Alex opens the exported file. The banner counts the imported threads. The mention is Alex again, the card is For you, and the page lands on that comment. Nothing was emailed.

Cluster mode, not in this recording: signed in, @ and at least two characters suggest accounts, each with a name and an email, from the same directory Share uses. Choosing one stores the account id and the email beside the sentence. Opening the file as that account scrolls to the comment and marks it For you. A name with no account can still be mentioned and is shown on the card. Sharing the file is not required. No email is sent.

## Google Workspace benchmark

In a Google comment, @ plus a name or address inserts the person, and they receive an email ([Docs Help](https://support.google.com/docs/answer/65129)). Turning that off is a per-file notification setting, "Comments for you" or None ([Docs Help](https://support.google.com/docs/answer/91588)). Opening the document from the email is what is supposed to show the comment. If the email is missed, the comment is wherever it sits in a long doc.

Known pain points:

- A mention is an email, so the only way to aim a comment at someone also fills their inbox.
- The mail setting is easy to set to None and then forget, or to leave on and drown in mail.
- A long document does not move to that comment just because you are the person named, unless you arrive from the email.

## Better than Google Workspace when

1. In a comment, @ and at least 2 characters suggest matching names. On this computer the suggestions are names already stored here, and Enter inserts the one you pick. On a server the suggestions are accounts, each with name and email.
2. The posted card shows the mention as a name, and the saved file stores that mention separately from the rest of the sentence.
3. Opening the file as the named person scrolls that comment into view and marks the card. Opening as someone else leaves the document at the top.
4. No email is sent, and the mention UI has no notify checkbox.
5. The mention survives close and reopen. Export DOCX includes the mentioned name in the Word comment, and importing that file still scrolls for that person.
6. A name with no account can be mentioned and is shown on the card. Sharing the file is not required for the mention itself.
7. The first-comment name prompt from storyboard 29 still runs, and the local name it saves is the name single-node matching uses.

## Success looks like

- Jordan's comment on "grew 12%" mentions Alex. Alex's open lands on that card and marks it For you. Jordan's open stays at the top.
- The same landing happens from the Word file. No email was sent.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. @ and at least two characters suggest names. On this computer they are names stored here, and Enter inserts the one you pick. On a server they are accounts, each with a name and an email. | Met | Video ~0:22, suggestion "Alex · On this computer", then Enter inserts the chip. Server rows: `suggests server accounts with name and email, and still offers a name with no account` in `tests/doc-comments.test.ts`. Not filmed; this recording is single-node. |
| 2. The posted card shows the mention as a name, and the saved file stores it apart from the sentence. | Met | Video ~0:28, blue "Alex" then "please check this". `keeps a mention out of the sentence and round-trips the name through Word` checks the file text does not contain Alex and `mentions` is `[{ name: "Alex", at: 0 }]`. |
| 3. Opening as the named person scrolls that comment into view and marks the card. Opening as someone else leaves the document at the top. | Met | Video ~0:43 Jordan, title at the top, card not For you. Video ~0:52 Alex, green For you border, comment in view, outlook not in view. `an @mention is stored apart from the sentence and opens on that person`. |
| 4. No email is sent, and the mention UI has no notify checkbox. | Met | Video ~0:24, the hint says nobody is emailed and the card has no checkbox. The scene asserts no mailto, smtp, or notify request. |
| 5. The mention survives close and reopen. Export DOCX includes the name, and importing that file still scrolls for that person. | Met | Video ~0:43 the chip is still Alex after reopen. Video ~0:56 imported DOCX, "2 comment threads imported", For you, same landing. The vitest round-trips `@Alex please check this`. |
| 6. A name with no account can be mentioned and is shown on the card. Sharing is not required. | Met | Video ~0:22, the second row is "Al · No account" while Alex is highlighted. `the first comment name is what @ matches, and a name with no account can be mentioned` posts Lee with no account id and no email. |
| 7. The first-comment name prompt still runs, and the local name it saves is what single-node matching uses. | Met | Video ~0:22, the box says "Commenting as Jordan" and does not ask again. The same browser test starts from an empty name, saves Jordan, and then @Jo suggests Jordan. |

## Gaps and notes

- This recording is single-node. Cluster mode uses the same box: signed in, suggestions come from `drive.accounts` (name and email), and opening as that account matches the stored name, email, or account id. A name the directory does not have is still offered. No mail is sent. Sam's landing is the unit test above, not a second recording.
- The local display name is `suiteleaf:display-name`. Names already used on this computer are kept in `suiteleaf:known-names`, which is what single-node @ matching suggests. `suiteleaf:local-author` is only the stable id.
- Replies are still plain text. @ suggestions are in the new-comment box.
- The Suggesting control still says "as Your name". That label is the suggestions identity, not the comment name.
- SuiteDrive's `drive_comment` table is still a separate one-line note on the item. This story is the document thread from storyboard 29.
- There is no mail transport. The scene asserts that commenting and exporting issue no mail request.
