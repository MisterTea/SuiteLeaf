# 41 · A viewer cannot edit a spreadsheet or a presentation

**Mode:** cluster · **App:** Sheets, Slides · **Video:** [videos/41-viewer-of-a-sheet-or-deck.mp4](videos/41-viewer-of-a-sheet-or-deck.mp4) · **Script:** [scenes/41-viewer-of-a-sheet-or-deck.spec.ts](scenes/41-viewer-of-a-sheet-or-deck.spec.ts)

## Who and why

Alex Rivera can read the garden club's "Plot assignments" spreadsheet and the "Spring fair" slides. Rosa shared both as Viewer (storyboard 27). Alex wants to look up who has the north bed, and to play the slides at the meeting, without any chance of changing Rosa's files. Last time the grid still looked editable, and Alex is not sure a click in a cell stuck.

## Inspired by

- WF-A2-08 and WF-A4-08 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): viewing mode, and a role that is actually enforced.
- Storyboard [27](27-share-a-document-with-a-teammate.md): a document viewer already sees "View only", a grey editing toolbar, and no save.
- [Learn more about access to Google files](https://support.google.com/docs/answer/16722399): viewers can read; commenters can comment; editors can change the file.
- [Sort & filter your data](https://support.google.com/docs/answer/3540681): a viewer of a spreadsheet can make a temporary filter view, and it is not saved.
- [Find what's changed in a file](https://support.google.com/docs/answer/190843): viewers cannot open version history.

## Scenes

1. **Open the sheet.** Alex signs in. Shared with me lists "Plot assignments.slsheet" as "Rosa Diaz · Can view". The sheet opens with "View only" beside the title. The formula bar and the editing toolbar (undo, formatting, Insert) are greyed. Zoom and Print stay usable.
2. **Try to type.** Alex clicks C4, types "Alex", and presses Enter. C4 still says "Sam". Paste and Delete do the same. The status never says it is saving, and it never reports an error.
3. **Look, without changing the file.** Data › Filter views › Bed: North (three clicks) hides every row that is not North, and a bar says the filter is only on this screen. Closing the file and opening it again shows every row, and Rosa's copy is unchanged.
4. **A commenter, still not an editor.** Priya, who can comment, opens the same sheet. The badge says "Can comment". The editing toolbar and the formula bar are greyed. Typing in C4 leaves "Sam". Priya can open the comment on C4 and reply.
5. **Open the slides.** Alex opens "Spring fair.slslides", also "Rosa Diaz · Can view", with the same "View only" badge. Bold, Theme, New slide, and the text-box tools are greyed. Present stays available.
6. **Try to edit a slide.** Alex clicks a text box, presses Cmd/Ctrl+B, and types. The words stay as Rosa left them. The status does not save.
7. **Present.** Slideshow (Cmd/Ctrl+Enter) plays the deck. Esc returns to the same read-only editor.
8. **Rosa is unaffected.** Rosa opens both files. Her toolbar is enabled, and neither file contains Alex's keystrokes.

## Google Workspace benchmark

In Google Sheets a viewer sees a mostly grey toolbar, but the grid still accepts a click. Typing then fails with a permission message after the keystroke, which feels like an edit that didn't stick. A temporary filter view takes 3 clicks (Data › Filter views › Create new filter view) and is discarded ([Docs Help](https://support.google.com/docs/answer/3540681)). In Google Slides a viewer can still select objects; typing raises a bar asking for edit access. Present is 1 click. Viewers cannot open version history ([Docs Help](https://support.google.com/docs/answer/190843)).

Known pain points:

- The sheet looks editable until the first keystroke, so people think their change was lost rather than refused.
- A commenter who expected to edit the grid gets the same refusal, with the role easy to miss.
- Filter views are the supported way to look at a sheet you cannot edit, and they are buried under Data › Filter views.

## Better than Google Workspace when

1. A viewer of a spreadsheet sees "View only", and the formula bar and editing toolbar are disabled before any keystroke, the way Docs disables its editing toolbar. Zoom and Print stay available.
2. Typing, pasting, and Delete in a cell leave every cell's value and formula unchanged. The status never starts a save and never shows a save error.
3. A viewer can filter through a filter view in at most 3 clicks. That filter is not written to the file, and reopening the file shows the unfiltered sheet.
4. A commenter sees "Can comment", cannot change cells, and can still reply to a comment.
5. A viewer of a presentation sees "View only", and Bold, Theme, New slide, and the text tools are disabled. Present still starts the slideshow.
6. Typing and Bold on a slide change no object, and no save is attempted.
7. After the viewer and the commenter close the files, the bytes stored for each file match the bytes from before they opened them.
8. An editor opening the same files gets an enabled toolbar and can edit.

## Success looks like

- Alex read the north-bed row and presented the slides. Neither file changed.
- Priya replied to a comment and could not edit the grid. Rosa's toolbar still works.

## Gaps and notes

- Version history for viewers is unchanged: this story does not grant or remove it.
- Slide comments are a different story. A commenter on a deck still cannot comment.
- Selecting a commented cell also opens Univer's comment card beside the grid, as well as the comments sidebar.
- A viewer's saved "Create a filter" stays disabled. Filter views are the path that does not write the file.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Viewer sees "View only"; formula bar and editing toolbar disabled; Zoom and Print stay on | Met | Video ~0:08; scene asserts Bold, Undo, and Font family disabled, Zoom and Print enabled, formula editor `data-view-locked` |
| 2. Typing, paste, and Delete leave cells unchanged; no save and no save error | Met | Video ~0:14, C4 stays Sam; scene counts content PUTs as 0 |
| 3. Filter view in at most 3 clicks, not written, gone on reopen | Met | Video ~0:22, Data › Filter views › Bed: North; reopen at ~0:28 shows South; bytes match before Rosa edits |
| 4. Commenter sees "Can comment", cannot edit cells, can reply | Met | Video ~0:36, Priya types a reply on C4; C4 stays Sam |
| 5. Slide viewer sees "View only"; Bold, Theme, New slide, and text tools disabled; Present works | Met | Video ~0:46 toolbar, ~0:50 slideshow |
| 6. Typing and Bold on a slide change nothing and do not save | Met | Video ~0:48, title stays "Spring fair"; content PUTs stay 0 |
| 7. Stored bytes match after the viewer and commenter close the files | Met | Scene compares SHA-256 of both files before Rosa edits |
| 8. An editor gets an enabled toolbar and can edit | Met | Video ~0:54 Rosa types "ok" and adds "!" to the title |
