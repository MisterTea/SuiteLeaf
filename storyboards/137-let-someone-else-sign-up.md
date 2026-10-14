# 137 · Let someone else sign up

**Mode:** cluster · **App:** Forms · **Video:** [videos/137-let-someone-else-sign-up.mp4](videos/137-let-someone-else-sign-up.mp4) · **Script:** [scenes/137-let-someone-else-sign-up.spec.ts](scenes/137-let-someone-else-sign-up.spec.ts)

## Who and why

Maya built the plot sign-up form on the club's server (storyboard 136). Sam is not at the table. In Google Forms she would turn on "anyone with the link", hope he has a Google account, and then look for his answer in a different spreadsheet. She wants Sam to fill in this form, and she wants his row in the same file, without giving him a way to rewrite the questions.

## Inspired by

- Storyboard [136](136-collect-sign-ups.md): the questions and the answers are one file, but only the person at the laptop can add a row.
- Storyboard [27](27-share-a-document-with-a-teammate.md): Share from the file, pick a person, pick a role.
- [Google Drive Help: Share files](https://support.google.com/drive/answer/2494822): "Anyone with the link" is a separate switch from the list of people, and people are often unsure who can open the file.
- [r/techsupport: share to anyone with the link](https://www.reddit.com/r/techsupport/comments/iuclvn/google_drive_share_to_anyone_with_the_link/): link sharing does not mean what people think it means.

## Scenes

1. **The form is on the server.** Rosa is signed in. She opens "Plot sign-ups". The questions are already there: Your name, Plot size, Notes.
2. **Share with Sam.** She clicks **Share**. She types "sam" and picks Sam Okafor. The role next to his name already says **Responder**, "Can sign up, not change the questions". She clicks **Share**. The list shows Sam as Responder.
3. **Sam opens it.** Rosa signs out. Sam signs in. Shared with me lists the form. He opens it and sees **Add a response**. There is no Questions tab and no way to edit the prompts.
4. **Sam signs up.** He enters Sam, chooses Medium, and leaves Notes empty. He submits. The form clears.
5. **Rosa sees the row.** Sam signs out. Rosa signs in and opens the form. **Responses** shows Sam, Medium, and a blank note. The three questions are unchanged.

## Success looks like

- Sharing a form offers Responder before Editor.
- Sam can submit one response and cannot change the questions.
- Rosa sees his row in the same file.
- The server refuses a responder who tries to change a question.

## Better than Google Forms

- One share role, named for what Sam can do. Google splits the form, the spreadsheet, and "anyone with the link".
- The answer lands in the form Rosa already has open. She does not go find a response sheet.
- Sam never sees a control that looks like it edits the questions.

## Gaps and notes

- Recorded. Rosa shares Plot sign-ups with Sam. The role already says Responder, "Can sign up, not change the questions". Sam sees only Add a response, submits Sam / Medium, and Rosa's Responses table shows that row in the same file.
- The server accepts that append and refuses a responder who changes a question, edits a response, or deletes one. An editor can still change the questions.
- There is still no public link. Sam needs an account on this server.
