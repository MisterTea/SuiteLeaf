# 68 · Space the lines

**Mode:** single-node · **App:** Docs · **Video:** [videos/68-space-the-lines.mp4](videos/68-space-the-lines.mp4) · **Script:** [scenes/68-space-the-lines.spec.ts](scenes/68-space-the-lines.spec.ts)

## Who and why

Priya is writing the garden-club minutes. The welcome paragraph should sit at a comfortable 1.5, and the motion list under it should stay single-spaced so the vote fits on the page. Google Docs hides that choice in Format, then Line & paragraph spacing, then a second dialog for anything that is not on the short list.

## Inspired by

- [Change line and paragraph spacing](https://support.google.com/docs/answer/1696498): Format menu, then a flyout of 1.0, 1.15, 1.5, and Double. Custom spacing is another dialog.
- People lose the selection while hunting through that menu, and a "custom" value of 1.5 looks the same as the preset until you open the dialog again.
- SuiteLeaf paragraphs have no line-spacing attribute, and Word export does not write paragraph spacing.

## Scenes

1. **The minutes.** Priya opens "Garden club minutes". The welcome paragraph and the three-line motion are both single-spaced.
2. **The choice.** She puts the caret in the welcome paragraph and chooses 1.5 from a line-spacing control. The current choice is marked. She does not open a second dialog.
3. **The page.** The welcome lines open up. The motion list under it stays single-spaced.
4. **Double.** She selects the motion and chooses Double. Those three lines spread out. The welcome paragraph stays at 1.5.
5. **Save and Word.** She reopens the SuiteLeaf file. The welcome is still 1.5 and the motion is still double. The exported .docx records those two spacings.

## Google Workspace benchmark

In Google Docs the path is Format, Line & paragraph spacing, then a preset ([Docs Help](https://support.google.com/docs/answer/1696498)). Custom spacing is a second dialog, and the menu does not show which value the paragraph already has until you hover the right row.

## Better than Google Workspace when

1. Line spacing is one control on the paragraph, with Single, 1.15, 1.5, and Double. No second dialog.
2. The control shows which of those the caret's paragraph already uses.
3. Choosing 1.5 changes only the paragraphs in the selection. A paragraph outside the selection stays single-spaced.
4. Choosing Double on another paragraph does not reset the first paragraph.
5. Both values survive save and reopen.
6. The exported .docx carries each paragraph's spacing, not a single spacing for the whole document.

## Success looks like

The welcome paragraph is open at 1.5 and the motion is double-spaced. Reopening the file, and the Word file, keep both.

## Gaps and notes

- Paragraphs have no spacing attribute today.
- Space before and space after a paragraph are out of scope.
- Do not change page size, headers, or page numbers.
