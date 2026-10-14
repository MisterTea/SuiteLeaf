# 89 · Don't leave one line behind

**Mode:** single-node · **App:** Docs · **Video:** [videos/89-dont-leave-one-line-behind.mp4](videos/89-dont-leave-one-line-behind.mp4) · **Script:** [scenes/89-dont-leave-one-line-behind.spec.ts](scenes/89-dont-leave-one-line-behind.spec.ts)

## Who and why

Nia’s newsletter paragraph breaks so the last line, “See you Saturday.”, sits alone at the top of page 2. She wants that line to stay with the sentence above it. Google Docs hides the fix under Format, Line & paragraph spacing, Prevent single lines.

## Inspired by

- [Keep lines and paragraphs together](https://support.google.com/docs/answer/1696498): Prevent single lines is one item in a long spacing menu. It is off until you find it, and nothing on the page says a line was left behind.
- SuiteLeaf pagination can keep a heading with the next block (storyboard 86). It does not keep the last line of a paragraph with the line before it.
- Word calls this widow and orphan control (`w:widowControl`).

## Scenes

1. **The leftover.** Nia opens “Garden club news”. A paragraph fills the bottom of page 1, and “See you Saturday.” is the only line at the top of page 2.
2. **The switch.** She puts the caret in that paragraph and turns on Don’t leave one line. No second dialog. The control shows that it is on.
3. **Together.** “See you Saturday.” is no longer alone. It sits with at least one line of the same paragraph. The heading on page 1 is unchanged.
4. **Off.** She turns the control off. “See you Saturday.” is alone at the top of page 2 again.
5. **Save and Word.** She turns it on, reopens the file, and the line is still with its paragraph. The exported .docx sets widow and orphan control on that paragraph and not on a paragraph she left off.

## Google Workspace benchmark

In Google Docs the path is Format, Line & paragraph spacing, Prevent single lines ([Docs Help](https://support.google.com/docs/answer/1696498)). The menu does not show the result until the page reflows, and the control is easy to confuse with Keep with next.

## Better than Google Workspace when

1. Don’t leave one line is one control on the paragraph that has the caret. No second dialog.
2. The control shows that it is on for that paragraph.
3. With it on, a paragraph does not leave a single line alone at the top or bottom of a page. At least two lines of that paragraph stay together.
4. Turning it off allows the single line again.
5. The choice survives save and reopen.
6. The exported .docx sets widow and orphan control on that paragraph only.

## Success looks like

“See you Saturday.” sits with the line before it. Turning the control off leaves it alone again. Word keeps the same rule.

## Gaps and notes

- The Don’t leave one line switch no longer floats beside the caret. It covered the paragraph while someone was typing. A paragraph already saved with widow and orphan control still keeps two lines together.
- Keep with next (storyboard 86) is a different rule. Headings still travel with the following block.
- A one-line paragraph has nothing to pair, so the control cannot pull another line.
- Keeping a whole paragraph on one page is out of scope.
- The .docx write sets `w:widowControl` only on the paragraph that is on. Opening a Word file does not read that flag back.
- Margins, columns, and line spacing are unchanged.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. One control on the paragraph that has the caret. No second dialog. | Met | Video 0:09. The switch appears beside “See you Saturday.” Browser test finds no dialog. |
| 2. The control shows that it is on for that paragraph. | Met | Video 0:12. The switch reads On and is pressed. |
| 3. With it on, that paragraph does not leave a single line alone. At least two lines stay together. | Met | Video 0:12. “Bring a chair if you can.” moves onto page 2 with “See you Saturday.” “This month” stays on page 1. Unit test `avoidSingleLine` covers the opening line as well. |
| 4. Turning it off allows the single line again. | Met | Video 0:16. “See you Saturday.” is alone at the top of page 2. |
| 5. The choice survives save and reopen. | Met | Video 0:22. After reopen the two lines are still together and the switch is On. |
| 6. The exported .docx sets widow and orphan control on that paragraph only. | Met | Video 0:27 export. `tests/doc-widow-control.test.ts` and the browser test expect `<w:widowControl` on the closing paragraph and not on “The board meets Monday.” or the heading. |
