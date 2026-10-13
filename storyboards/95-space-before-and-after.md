# 95 · Space before and after

**Mode:** single-node · **App:** Docs · **Video:** [videos/95-space-before-and-after.mp4](videos/95-space-before-and-after.mp4) · **Script:** [scenes/95-space-before-and-after.spec.ts](scenes/95-space-before-and-after.spec.ts)

## Who and why

Priya wants a little air after the welcome paragraph and none after the motion list. Line spacing (storyboard 68) changes the space inside the lines. It does not add space before or after the paragraph. Google Docs hides that in a second dialog under Custom spacing.

## Inspired by

- [Change line and paragraph spacing](https://support.google.com/docs/answer/1696498): Space before and Space after are in the custom spacing dialog, separate from 1.0, 1.15, 1.5, and Double. People set 1.5 and still see paragraphs glued together.
- SuiteLeaf stores line spacing. It does not store space before or space after a paragraph.
- Word writes those as `w:spacing` `w:before` and `w:after`, in twips.

## Scenes

1. **Glued.** Priya opens "Garden club minutes". The welcome and the motion sit with no extra gap. Line spacing on the welcome is already 1.5.
2. **After.** She puts the caret in the welcome and sets Space after to 12 pt. A gap opens under the welcome. The motion does not move apart from that gap. The lines inside the welcome stay at 1.5.
3. **Before.** She puts the caret in the "Motion" heading and sets Space before to 12 pt. A gap opens above the heading. Space after on the welcome stays 12 pt.
4. **Zero.** She sets Space after on the motion to 0. The motion lines stay double-spaced from storyboard 68, with no extra gap after the last line.
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

## Gaps and notes

- Line spacing exists. Space before and space after do not.
- Do not rebuild line spacing, Keep with next, Don't leave one line, or Keep lines together.
- Keep the control on the same paragraph toolbar. Put the spacing values in a new module.
