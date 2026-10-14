# 144 · See that Jordan has the file open

**Mode:** cluster · **App:** Docs · **Video:** [videos/144-see-that-jordan-has-the-file-open.mp4](videos/144-see-that-jordan-has-the-file-open.mp4) · **Script:** [scenes/144-see-that-jordan-has-the-file-open.spec.ts](scenes/144-see-that-jordan-has-the-file-open.spec.ts)

## Who and why

Sam is about to change the bake sale time. Jordan already has the flyer open on another computer. In Google Docs a colored caret and a tiny face sit on the words, and Sam cannot tell whether Jordan is editing or just left the tab open. The caret also covers the time he is trying to read. He wants a name, and he wants to know if Jordan is only looking.

## Inspired by

- Storyboard [143](143-hear-that-jordan-saved.md): a saved change shows up, but nothing says someone else is in the file before they save.
- [See someone's cursor in a document](https://support.google.com/docs/answer/2494888): Google draws a caret and a name flag on the text.
- [r/googleworkspace: how do I know if someone is editing](https://www.reddit.com/r/gsuite/comments/1rqlwk8/is_google_drive_sync_conflict_resolution_really/): people discover a clash only after a save.

## Scenes

1. **Sam is alone.** He is signed in and the flyer is open. Next to the title there is no one else's name.
2. **Jordan opens it.** A caption says Jordan opens the same flyer and does not type. Within a few seconds a chip says **Jordan is viewing**. Nothing is drawn on the sentence.
3. **Jordan edits.** Jordan's side marks the file as being edited (the recording can set that through the presence call, or by typing on a second page if it stays in this video). The chip changes to **Jordan is editing**. The sentence is still fully readable.
4. **Jordan leaves.** Jordan closes the file. Within a few seconds the chip is gone. Sam's text is unchanged.

## Success looks like

- Another person with the file open is named beside the title.
- The chip says viewing or editing.
- Their presence never covers the document text.
- Leaving removes the chip without a save.

## Better than Google Docs

- The name is not a flag stuck to a word.
- Viewing and editing are different, so a forgotten tab is not the same as someone changing the time.
- The sentence Sam is reading stays clear.

## Gaps and notes

- Recorded. Sam is alone on the flyer and sees no chip. When Jordan has it open, a chip beside the title says "Jordan is viewing". When Jordan's client reports editing, the chip says "Jordan is editing". The sentence stays fully readable. After Jordan stops, the chip is gone within about 15 seconds, and Sam does not save.
- While a SuiteDrive file is open and this person can read it, the editor posts presence about every 5 seconds and reads who else is here on that same cadence. `editing` is true only while there are unsaved local edits, the same signal as "Unsaved changes". Leaving the file stops the beats. Saves and the remote-version check keep their own timing.
- The server stores each person's latest beat: user id, display name, editing flag, and time. A read returns other people only, as `{ name, editing }`, whose beat is not older than 15 seconds. The caller is left out. Nothing sweeps in the background.
- Viewers and commenters may report that they have the file open. Reporting editing does not let them change the file.
- Nothing is drawn on the document text. There is no remote caret and no avatar on the chip.
