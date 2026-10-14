# 143 · Hear that Jordan saved

**Mode:** cluster · **App:** Docs · **Video:** [videos/143-hear-that-jordan-saved.mp4](videos/143-hear-that-jordan-saved.mp4) · **Script:** [scenes/143-hear-that-jordan-saved.spec.ts](scenes/143-hear-that-jordan-saved.spec.ts)

## Who and why

Sam has the bake sale flyer open and is reading it, not typing. Jordan, on another computer, changes the time and saves. In SuiteLeaf today Sam only hears about that the next time his own edits try to upload. If he never types, the page stays wrong. Google Docs would drop Jordan's words into the page while Sam is in the middle of a sentence, which is easy to miss. Sam wants to know Jordan saved, and he does not want his own unsent line to disappear.

## Inspired by

- Storyboard [25](25-when-someone-else-saved-first.md): a conflict is only detected on the next upload. If Sam stops typing, nothing says a newer version exists.
- [See changes to your Google Docs, Sheets, and Slides files](https://support.google.com/docs/answer/190843): other people's edits show up in the document. They are not announced as a choice.
- [r/gsuite: Is Google Drive sync conflict resolution really this bad?](https://www.reddit.com/r/gsuite/comments/1rqlwk8/is_google_drive_sync_conflict_resolution_really/): last write wins, and the person still typing does not get a clear choice.

## Scenes

1. **Sam is reading.** He is signed in and the flyer is open: "Bake sale on Saturday, 10 am to noon." The status says it is saved to SuiteDrive. He does not type.
2. **Jordan saves.** A caption says Jordan changes the time to "9 am to 1 pm" and saves. Sam still does not type.
3. **The page catches up.** Within a few seconds the sentence changes to the new time. The status names Jordan, for example "Jordan updated this." Sam did not click Reload.
4. **Sam starts a line.** He adds "Bring a cake!" and does not wait for a save to finish.
5. **Jordan saves again.** Jordan's version gains "Saturday 14 June" while Sam's line is still only on this computer. A banner appears without Sam clicking Save. It says Jordan saved a newer version. "Bring a cake!" is still in the document.
6. **He keeps his line.** He chooses to keep his version as a copy. The cake line is still there, and the status no longer says a newer version is waiting.

## Success looks like

- An idle open file picks up someone else's save on its own and says who saved it.
- Unsent typing is not replaced by that pickup.
- The banner shows up while the unsent line is still unsent, not only after an upload fails.
- Keeping his version does not throw away the cake line.

## Better than Google Docs

- Someone else's save does not land inside a sentence Sam is currently typing.
- When he has unsent work, he is told and he chooses. Google merges it in.
- When he is only reading, the page updates and names the person, so he is not left on a stale copy.

## Gaps and notes

- Recorded. Sam is idle on the flyer. Jordan's save changes the sentence to "9 am to 1 pm" and the status says "Jordan updated this." Sam does not click Reload. When Sam types "Bring a cake!" and Jordan saves "Saturday 14 June", the banner appears and the cake line stays. Save as copy keeps that line and clears the banner.
- An open SuiteDrive file checks the head version about every 2 seconds. It does not check while signed out, or while the conflict banner is already up.
- When this computer has nothing unsent, the new bytes replace the open document and the status names `lastAuthorName`. If that name is missing, the status says "Someone else updated this." The file is not marked dirty.
- When this computer has unsent typing, including a local save that has not uploaded yet, the existing banner appears and the typing stays. Save as copy and Reload from SuiteDrive are the same choice as storyboard 25.
- This is not character-by-character co-editing. There are no remote cursors. Someone else's save does not land inside a sentence that is still only on this computer.
