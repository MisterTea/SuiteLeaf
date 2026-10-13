# 31 · Rearrange a deck

**Mode:** single-node · **App:** Slides · **Video:** [videos/31-rearrange-a-deck.mp4](videos/31-rearrange-a-deck.mp4) · **Script:** [scenes/31-rearrange-a-deck.spec.ts](scenes/31-rearrange-a-deck.spec.ts)

## Who and why

Maria is turning last quarter's 8-slide update into this quarter's. She needs to move the results slide to the front, duplicate the chart slide to make a "before and after" pair, delete two out-of-date slides, and add a text box, a logo, and a callout shape. She works from the keyboard and the menus she knows from Google Slides and PowerPoint, and she expects Undo to rescue her.

## Inspired by

- WF-A2-14 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): organize slides, text boxes, shapes ("core … reorder … supported").
- [Keyboard shortcuts for Google Slides](https://support.google.com/docs/answer/1696717): Ctrl+M new slide, Ctrl+D duplicate, Ctrl+Up/Down to move a slide, Ctrl+Shift+Up/Down to move it to the start or end, Shift+Up/Down to extend the selection.
- [Use Google Slides with a screen reader: change the order of slides](https://support.google.com/accessibility/answer/1634140): moving several slides from the filmstrip with the keyboard.
- [Vegaslide: move a slide to the end](https://vegaslide.com/how-to-move-a-slide-to-the-end-in-google-slides/): dragging a group of selected slides.
- [r/GoogleSlides: "Google Slides is really the worst"](https://www.reddit.com/r/GoogleSlides/comments/1h18clf/rant_google_slides_is_really_the_worst/): "Copy pasting always paste at the top left corner of the slide instead of at your cursor position."
- Storyboard [20](20-build-a-presentation.md): building a deck in SuiteLeaf.

## Scenes

1. **Open the deck.** Maria opens "Q3 update" (8 slides). The filmstrip shows numbered thumbnails.
2. **Move a slide to the front.** She clicks slide 6 ("Results") and presses Cmd/Ctrl+Shift+Up. It becomes slide 1, and the filmstrip scrolls to keep it in view.
3. **Drag a group.** She clicks slide 3, Shift-clicks slide 4, and drags both below slide 7. A line shows where they'll land, and both move together in their original order.
4. **Duplicate.** With the chart slide selected she presses Cmd/Ctrl+D. A copy appears right after it and is selected. Slide › Duplicate slide and the thumbnail's right-click menu do the same.
5. **Delete two slides.** She selects slides 7 and 8 and presses Delete. Both go, and a "2 slides deleted · Undo" notice appears.
6. **Undo and redo.** Cmd/Ctrl+Z brings both back in place. Cmd/Ctrl+Shift+Z (or Cmd/Ctrl+Y) deletes them again. Edit › Undo and Edit › Redo do the same.
7. **Insert from the menu.** Insert › Text box places a text box in the middle of the slide, ready to type. Insert › Image opens a file picker, and the logo appears. Insert › Shape › Rounded rectangle adds a callout.
8. **Format from the menu.** With the text box selected, Format › Text › Bold (Cmd/Ctrl+B) and Format › Align & indent › Center work on the text box.
9. **Copy and paste.** She copies the callout with Cmd/Ctrl+C, clicks slide 2, and pastes with Cmd/Ctrl+V. It lands at the same position as the original, not the top-left corner. Edit › Cut, Copy, and Paste behave the same.
10. **Present.** Cmd/Ctrl+Enter shows the deck in its new order.

## Google Workspace benchmark

Google Slides covers most of this from the keyboard: Ctrl+D duplicates, Ctrl+Shift+Up/Down moves a slide to the start or end, Shift+arrows select several slides, and Delete removes them, with Ctrl+Z to undo ([shortcuts](https://support.google.com/docs/answer/1696717)). With the mouse, moving a slide is a drag. Duplicating or deleting is a right-click plus a menu item (2 clicks), or Slide › Duplicate slide (2). Inserting a shape takes 3 clicks (Insert › Shape › Shapes › the shape, plus a drag to draw it).

Known pain points:

- Pasted objects land at the top-left of the slide rather than where you're working ([r/GoogleSlides](https://www.reddit.com/r/GoogleSlides/comments/1h18clf/rant_google_slides_is_really_the_worst/)).
- On a Mac, the filmstrip's "first slide" and "last slide" shortcuts need Fn ([8apps](https://www.8apps.co/guides/accelerator-keys/google-slides-shortcuts/category/film-strip)).
- The shortcuts are only discoverable through the Ctrl+/ list.

## Better than Google Workspace when

1. Every item in the Slides Edit, Insert, Format, and Slide menus does what its label says. A test that clicks each menu item sees a change or a dialog for every one; none is a no-op.
2. Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y, Cmd/Ctrl+D, Delete or Backspace (on a selected slide or element), and Cmd/Ctrl+C, X, and V work from the canvas and the filmstrip, matching the shortcuts shown in the menus.
3. Cmd/Ctrl+Up/Down moves the selected slides by one, and Cmd/Ctrl+Shift+Up/Down moves them to the start or end, with no Fn key needed on a Mac.
4. Shift-click and Cmd/Ctrl-click select several slides, and dragging, deleting, duplicating, or moving them acts on all of them while keeping their order.
5. Deleting slides shows a notice with Undo, and one Undo restores all slides deleted in that action, in their original positions.
6. Pasting an element puts it at the same position as the original. Pasting on the same slide offsets it slightly so the two don't overlap exactly.
7. Insert › Text box, Image, and Shape each take at most 2 clicks and leave the new element selected; a text box is ready for typing.
8. After a sequence of 10 mixed edits (move, duplicate, delete, insert, format), pressing Undo 10 times returns the deck to its starting state exactly.

## Success looks like

- "Q3 update" starts with Results, has the duplicated chart pair, has lost the two old slides, and has the new text box, logo, and callout.
- Every menu item and shortcut Maria tried did something.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Every Edit, Insert, Format, and Slide item does something | Met | `every Slides Edit, Insert, Format, and Slide menu item does something`; video ~5s (Slide menu), ~36s (Format), ~40s (Insert) |
| 2. Undo, redo, duplicate, delete, and cut/copy/paste match the menus, from the canvas and the filmstrip | Met | `keyboard shortcuts work from the filmstrip and the canvas`; video ~14s (Cmd+D), ~20s (Delete), ~24s (Cmd+Z / Cmd+Shift+Z), ~48s (Edit › Cut / Paste) |
| 3. Cmd/Ctrl+arrow moves by one; Cmd/Ctrl+Shift+arrow jumps to the start or end, with no Fn key | Met | Same keyboard test; video ~7s, shortcut labeled in the Slide menu |
| 4. Shift-click and Cmd/Ctrl-click select several slides; drag, delete, duplicate, and move keep their order | Met | `shift-click selects a group that drags, deletes, and duplicates together`; video ~11s (both thumbnails outlined, blue drop line, pair lands together) |
| 5. Deleting slides shows Undo, and one Undo restores that whole group in place | Met | Video ~20s “2 slides deleted · Undo”, ~24s both outlines return on Old pipeline and Old targets |
| 6. Paste keeps the original position; a second paste on the same slide steps aside | Met | `paste keeps the original position and offsets a copy on the same slide`; video ~45s |
| 7. Text box, image, and shape take at most 2 clicks and stay selected; the text box is ready to type | Met | Menu test; video ~34s (typing “Shipped.”), ~40s (QL logo), ~42s (rounded callout) |
| 8. Ten mixed edits undo to the exact starting deck | Met | `ten mixed edits undo back to the exact starting deck` |

## Gaps and notes

- Tools › Spelling, Tools › Preferences, and Help › Keyboard shortcuts still do nothing. Those belong to storyboard 36.
- Themes and transitions are storyboard 32. The toolbar Theme menu is unchanged.
- A text box is bold or centered as a whole. There is no selection inside the text.
- Shapes are still rectangle, rounded rectangle, and ellipse. The callout is a rounded rectangle, not a speech-bubble tail.
- Dragging a group does not auto-scroll the filmstrip. The recording scrolls the chart into view first so the drop line stays on screen.
