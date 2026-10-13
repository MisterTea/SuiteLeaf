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

1. **Jordan's name is already set.** The computer knows Jordan from storyboard 29. Jordan opens "Quarterly Report".
2. **Mention Alex.** Jordan selects "grew 12%" and starts a comment. Typing "@Al" suggests "Alex". Enter inserts Alex as a mention, not as ordinary typed letters. Jordan finishes "please check this" and posts with Cmd/Ctrl+Enter.
3. **A second comment, not for Alex.** Jordan comments on the outlook heading, "Can we shorten this?", with no mention.
4. **Jordan is not scrolled.** Jordan closes the file and opens it again, still as Jordan. The page opens at the top. Both comments are in the margin. Alex's name is still a mention on the first card.
5. **Alex opens it.** The recording sets the local name to Alex, the way a second person on their own computer already has their name stored, and opens the same file. The view scrolls so the "grew 12%" comment is in view, and that card is marked as the one for Alex. The outlook comment is not the one in view.
6. **No mail.** Nothing asks to notify Alex, and no request leaves the computer.
7. **It survives the file.** Jordan exports DOCX. The Word comment on "grew 12%" includes Alex's name. Opening that file as Alex scrolls to the imported thread the same way.
8. **On a server.** Signed in as Jordan, @ and "sa" suggests "Sam Okafor" and sam@gardenclub.org. The mention is stored. Sam opens the file and lands on that comment. Lee, who has no account, can still be typed as a mention and is shown on the card. No email is sent.

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

- Jordan's comment on "grew 12%" mentions Alex. Alex's open lands on that card. Jordan's open stays at the top.
- Sam, on the server, lands on a comment that mentions him. No email was sent in either case.

## Gaps and notes

- A document comment stores an author, a time, and text on an anchor (`doc-comments`). The text is plain. Nothing parses `@` or stores a mentioned name.
- The local display name is `suiteleaf:local-author` (`identity.ts`). That is enough for single-node matching. Server accounts already have a name and an email in the share suggestions (storyboard 27); this story reuses that list inside the comment box.
- SuiteDrive's `drive_comment` table is a separate one-line comment on the item, not these threads. This story is the document thread from storyboard 29.
- There is no mail transport. The recording can assert that sharing or commenting issues no mail request.
