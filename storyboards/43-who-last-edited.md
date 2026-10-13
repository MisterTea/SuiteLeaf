# 43 · See who last edited a file

**Mode:** cluster · **App:** Files, Docs · **Video:** [videos/43-who-last-edited.mp4](videos/43-who-last-edited.mp4) · **Script:** [scenes/43-who-last-edited.spec.ts](scenes/43-who-last-edited.spec.ts)

## Who and why

Rosa owns the "Watering rota", and Sam edits it during the week. Before she opens version history, she wants the file list and the open document to say that Sam was the last person to change it, and when. When she saves a correction herself, both places should switch to her name without a trip through the history panel.

## Inspired by

- WF-A4-19 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): past revisions list who changed the file.
- Storyboard [28](28-restore-an-earlier-version.md): version history already shows each version's display name. This story is the name of the current version, without opening that panel.
- [Find what's changed in a file](https://support.google.com/docs/answer/190843): inside an open file, hover "Last edit" to see who updated it. Viewers cannot open the history.
- [Tips to edit and collaborate](https://support.google.com/a/users/answer/13004165): the activity dashboard is a separate Tools screen, and it needs edit access.

## Scenes

1. **The list.** Rosa signs in and opens Garden club. The row "Watering rota.sldoc" shows "Sam Okafor" and a local time, "Today 09:14", in the same row as the name. She has not opened the file.
2. **Not the owner.** The owner of the file is Rosa. The row still says Sam, because his upload is the current version. "Spring fair.slslides", which only Rosa has saved, says "Rosa Diaz".
3. **On the file.** She opens the rota. Beside the title, the line reads "Last edited by Sam Okafor · Today 09:14". The version-history panel is closed.
4. **She saves.** She adds "Thursday: ask Alex to cover." The status goes to "Saved to SuiteDrive", and the line changes to "Last edited by Rosa Diaz" with the new time. The Garden club list shows Rosa on that row without a manual reload.
5. **Sam's screen.** Sam already has the file list open. After Rosa's save, his row updates to "Rosa Diaz" and the new time. He opens the rota and sees the same line in the header.
6. **A viewer can see it.** Alex, who can only view, sees "Rosa Diaz" on the row and the same "Last edited by" line in the header. He does not need version history.
7. **The history agrees.** Rosa opens the clock. The top version is hers, with the same time the header showed.

## Google Workspace benchmark

Inside Google Docs, Sheets, or Slides, who last edited is a hover on "Last edit" at the top of the open file ([Docs Help](https://support.google.com/docs/answer/190843)). The Drive list shows a date. Seeing the person from the list means opening the file, or opening Details, or Tools › Activity dashboard, which needs edit access ([Workspace Learning Center](https://support.google.com/a/users/answer/13004165)). Viewers are told they cannot open version history.

Known pain points:

- The list answers "when" and hides "who", so two people who both might have touched a file look the same.
- "Last edit" is easy to confuse with the owner. The owner and the last editor are often different people.
- Viewers who can read the file still cannot see who changed it.

## Better than Google Workspace when

1. Every SuiteDrive file row shows the last editor's display name and a local date and time, without opening the file.
2. An open SuiteDrive file shows "Last edited by {name}" with that same time, while version history is closed.
3. The name is the author of the current head version. When the owner and the last editor differ, both the list and the header show the editor.
4. After another person saves, an already-open list and an already-open file show the new name and time within 5 seconds, without a reload.
5. A save you make yourself shows your display name, the same name version history uses for that version.
6. A viewer who can open the file sees the last editor in the list and in the header.

## Success looks like

- Before Rosa's correction, the rota says Sam Okafor in the list and on the file.
- After she saves, both say Rosa Diaz, including on Sam's already-open list, and the top history entry is hers.

## Gaps and notes

- `drive_item` stores `updatedAt` and `ownerId`. It does not store a last author. The author is `drive_version.authorId`, and `authorName` is filled when versions are listed.
- Drive rows show `formatModified(updatedAt)`. Shared rows add the owner's name and the recipient's role, which is not the last editor. The open file's status line says "Saved to SuiteDrive" and does not name anyone.
- The home screen on a single computer is a different list and is out of this story. SuiteDrive is the list that should gain the name.
- Version history itself is storyboard 28. This story only surfaces the head version's author.
