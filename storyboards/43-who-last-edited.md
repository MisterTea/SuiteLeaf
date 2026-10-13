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

1. **The list.** Rosa signs in and opens Garden club. The row "Watering rota.sldoc" shows "Sam Okafor · Today 09:14" beside the name. She has not opened the file.
2. **Not the owner.** Rosa owns both files. "Spring fair.slslides", which only she has saved, says "Rosa Diaz · Yesterday 16:40". The rota still says Sam, because his upload is the current version.
3. **On the file.** She opens the rota. Under the title, the line reads "Last edited by Sam Okafor · Today 09:14". The version-history panel is closed.
4. **Sam is already looking.** Sam's Garden club list is open and still says "Sam Okafor · Today 09:14".
5. **She saves.** On her computer she adds "Thursday: ask Alex to cover." Her header changes to "Last edited by Rosa Diaz" with the new time, and the status is "Saved to SuiteDrive". Sam does not reload.
6. **His row updates.** Within a few seconds the rota row turns blue and reads "Rosa Diaz" with the new time, "Today 23:18" in this recording. He opens the file. The header matches, the new sentence is there, and version history is still closed.
7. **A viewer can see it.** Alex, who can only view, sees "Rosa Diaz" and the same time on the row, then "Last edited by Rosa Diaz · Today 23:18" under the title, with a View only badge. He does not open version history.
8. **The history agrees.** Rosa opens the clock. The current version is "Today 23:18 · Rosa Diaz", the same time as the header. Sam's "Today 09:14" is the version under it.

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

- Before Rosa's correction, the rota says Sam Okafor in the list and on the file, and the slides say Rosa Diaz.
- After she saves, Sam's already-open list and an already-open copy of the file say Rosa Diaz, with the same time the current history entry uses.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Every SuiteDrive file row shows the last editor and a local date and time, without opening the file | Met | Video 0:07, rota "Sam Okafor · Today 09:14" and slides "Rosa Diaz · Yesterday 16:40". Test `43-who-last-edited` |
| 2. An open SuiteDrive file shows "Last edited by {name}" with that time, while version history is closed | Met | Video 0:11, "Last edited by Sam Okafor · Today 09:14", history panel absent |
| 3. The name is the head version's author, even when that person is not the owner | Met | Video 0:07, Rosa is signed in and owns the rota; the row says Sam. Slides, which only she saved, say Rosa |
| 4. After someone else saves, an already-open list and an already-open file show the new name and time within 5 seconds, without a reload | Met | Video 0:28, Sam's open list turns blue and reads "Rosa Diaz · Today 23:18". The same test asserts his already-open file header changed within 5 seconds of her save (`rowAt - savedAt` and `fileAt - savedAt`) |
| 5. A save you make yourself shows your display name, the same name version history uses | Met | Rosa's save in the test sets her header to "Last edited by Rosa Diaz". Video 0:43, history's current version is "Today 23:18 · Rosa Diaz", matching the header |
| 6. A viewer who can open the file sees the last editor in the list and in the header | Met | Video 0:37–0:40, Alex (View only, no rename) sees Rosa on the row and "Last edited by Rosa Diaz · Today 23:18" |

## Gaps and notes

- The last editor is the head version's author (`drive_version.authorId`) and `createdAt`. The list and the header use the same display name and the same "Today 09:14" clock as version history. `drive_item` still does not store a copy of the author.
- Shared with me still shows the owner's name and the role under a folder. Inside the folder, each file row names the last editor.
- An already-open document updates the last-edited line when someone else saves. It does not replace the paragraphs on screen; opening the file again does. That conflict is storyboard 25.
- Rosa's typing happens on her own screen so Sam's list can stay in view. The recording shows his row change, then the sentence when he opens the rota.
- The home screen on a single computer is a different list and is out of this story.
- Version history itself is storyboard 28. This story only surfaces the head version's author.
