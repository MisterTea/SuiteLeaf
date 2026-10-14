# 95 · Space before and after

**Mode:** single-node · **App:** Docs · **Video:** [videos/95-space-before-and-after.mp4](videos/95-space-before-and-after.mp4) · **Script:** [scenes/95-space-before-and-after.spec.ts](scenes/95-space-before-and-after.spec.ts)

## Who and why

Priya wants a little air after the welcome paragraph and none after the motion list. Line spacing (storyboard 68) changes the space inside the lines. It does not add space before or after the paragraph. Google Docs hides that in a second dialog under Custom spacing.

## Inspired by

- [Change line and paragraph spacing](https://support.google.com/docs/answer/1696498): Space before and Space after are in the custom spacing dialog, separate from 1.0, 1.15, 1.5, and Double. People set 1.5 and still see paragraphs glued together.
- SuiteLeaf already stored line spacing. Space before and space after are stored on the paragraph, in points.
- Word writes those as `w:spacing` `w:before` and `w:after`, in twips.

## Scenes

1. **Glued.** Priya opens "Garden club minutes". The welcome and the motion sit with no extra gap. Line spacing on the welcome is already 1.5.
2. **After.** She puts the caret in the welcome and sets Space after to 12 pt. A gap opens under the welcome. The motion does not move apart from that gap. The lines inside the welcome stay at 1.5.
3. **Before.** She puts the caret in the "Motion" heading and sets Space before to 12 pt. A gap opens above the heading. Space after on the welcome stays 12 pt.
4. **Zero.** She puts the caret in the first motion line and sets Space after to 12, then back to 0. The extra gap under that line goes away. The lines stay double-spaced from storyboard 68. The other motion lines were left at 0.
5. **Save and Word.** She reopens the file. Welcome still has 12 pt after, the heading still has 12 pt before, and the motion still has 0 after. The exported .docx records those values on the right paragraphs.

## Google Workspace benchmark

In Google Docs the path is Format, Line & paragraph spacing, Custom spacing, then two fields ([Docs Help](https://support.google.com/docs/answer/1696498)). The menu does not show the current before and after until that dialog opens. A heading and the paragraph under it often double the gap because both add space.

## Better than Google Workspace when

1. Space before and Space after are on the paragraph control, next to line spacing. No second dialog.
2. The control shows the current before and after for the caret's paragraph, in points.
3. Space after on the welcome does not change the motion's space after, and does not change the welcome's line spacing.
4. Space before on the heading does not clear the welcome's space after.
5. Setting a value to 0 removes that gap. Line spacing stays.
6. The values survive save and reopen.
7. The .docx writes `w:before` and `w:after` on the paragraphs that have them, and omits them on a paragraph left at 0.

## Success looks like

The welcome has a gap under it. The Motion heading has a gap above it. The motion list has none after it. Line spacing is unchanged.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Space before and Space after are on the paragraph control, next to line spacing. No second dialog. | Met | Video 0:06. The line-spacing menu shows 1.5 checked, then Space before and Space after in points. There is no second dialog. `tests/browser/paragraph-spacing.spec.ts` |
| The control shows the current before and after for the caret's paragraph, in points. | Met | Video 0:06 both fields read 0 pt on the welcome. Video 0:10 the welcome is 12 pt after and the button still reads 1.5. Video 0:16 the Motion heading's fields read 0 pt before. Video 0:25 the motion reads Double. |
| Space after on the welcome does not change the motion's space after, and does not change the welcome's line spacing. | Met | Video 0:10. A gap opens under the welcome. The motion lines stay together, and the button still reads 1.5. `tests/doc-paragraph-spacing.test.ts` |
| Space before on the heading does not clear the welcome's space after. | Met | Video 0:19. The gap above Motion grows while the welcome still has space under it. `tests/doc-paragraph-spacing.test.ts` |
| Setting a value to 0 removes that gap. Line spacing stays. | Met | Video 0:25 the first motion line has an extra gap and Double is checked. Video 0:28 that gap is gone and Double is still checked. `tests/doc-paragraph-spacing.test.ts` |
| The values survive save and reopen. | Met | Video 0:36. Both gaps are still in the reopened minutes. `tests/browser/paragraph-spacing.spec.ts` |
| The .docx writes `w:before` and `w:after` only on paragraphs that have them. | Met | Video 0:36 File, Export DOCX. Welcome is `w:after="240"`, Motion is `w:before="240"`, and a motion line left at 0 has neither. `tests/doc-paragraph-spacing.test.ts` |

## Gaps and notes

- Opening a Word file still does not read `w:before` and `w:after` back in. Export writes them.
- 12 pt after the welcome and 12 pt before Motion both stay, so the gap between them is the sum. Neither value is cleared.
- The point values live in `packages/core/src/paragraph-spacing.ts`. Line spacing stays in place. Keep with next, Don't leave one line, and Keep lines together no longer float beside the caret.
- The closed button shows the line spacing. Space before and Space after are the fields in that same menu, so the font tools stay on the toolbar.
