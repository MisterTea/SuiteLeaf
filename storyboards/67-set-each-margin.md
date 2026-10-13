# 67 · Set each margin

**Mode:** single-node · **App:** Docs · **Video:** [videos/67-set-each-margin.mp4](videos/67-set-each-margin.mp4) · **Script:** [scenes/67-set-each-margin.spec.ts](scenes/67-set-each-margin.spec.ts)

## Who and why

Ben is matching the town council's template. The top margin must be 1.5 inches for the letterhead, the bottom 0.75, the left 1, and the right 0.75. Page setup has one margin, so making room at the top also pushes the text in from both sides.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/10296618): File › Page setup, then a number for each edge. Google's dialog is four fields plus a preview.
- Storyboard [66](66-leave-room-for-the-binding.md): a gutter adds the same extra amount on the inside. It does not let the top differ from the bottom.
- Page setup stores one margin. `packages/core/src/document-layout.ts` has no separate top, bottom, left, or right.

## Scenes

1. **One margin.** Ben opens "Minutes". The text starts the same distance from every edge.
2. **Four fields.** In Page setup he sets Top to 1.5 in. The preview's top band grows, and Bottom, Left, and Right stay 0.75. He then sets Left to 1 in. Bottom and Right stay 0.75. Each field is labeled in inches, and the note says only that edge changes.
3. **The page.** The first line sits further down. The left gap is wider than the right. The last line of the page sits closer to the bottom edge than to the top.
4. **A bad value.** He tries Top 0. The field says a margin must be at least 0.25 inches, and Apply stays off. Top 4 is refused too: a margin must be at most 3 inches.
5. **Save.** He reopens the file. Top is still 1.5, bottom 0.75, left 1, and right 0.75.

## Google Workspace benchmark

In Google Docs, File › Page setup shows Top, Bottom, Left, and Right ([Docs Help](https://support.google.com/docs/answer/10296618)). Four fields, then OK. People miss that the unit is inches until the text jumps, and there is no preview of which edge moved.

## Better than Google Workspace when

1. Page setup has Top, Bottom, Left, and Right, in inches. One shared margin is no longer the only control.
2. Changing Top does not change Left, Right, or Bottom.
3. The body text inset on each edge matches the field, within a tenth of an inch.
4. A margin below 0.25 inches or above 3 inches is refused, and Apply does not commit it.
5. The four values survive save and reopen.
6. Existing files that stored one margin open with all four edges equal to that margin.

## Success looks like

The minutes have a deep top margin and a narrower right margin. Reopening the file keeps each edge.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Page setup has Top, Bottom, Left, and Right, in inches | Met | Video 0:11; `tests/browser/page-margins.spec.ts` |
| Changing Top does not change Left, Right, or Bottom | Met | Video 0:11 (others stay 0.75); `tests/document-layout.test.ts` |
| Body text inset on each edge matches the field, within a tenth of an inch | Met | `tests/browser/page-margins.spec.ts`; scene assertions; video 0:16 and 0:19 |
| A margin below 0.25 in or above 3 in is refused, and Apply does not commit it | Met | Video 0:23 (Top 0) and 0:25 (Top 4); Apply stays off |
| The four values survive save and reopen | Met | Video 0:28 |
| A file that stored one margin opens with all four edges equal to it | Met | `tests/document-layout.test.ts`; `tests/browser/page-margins.spec.ts` (stored margin 1 in) |

## Gaps and notes

- This base has no binding gutter, so none was added. Left and Right are the text insets.
- Exporting DOCX writes each edge. Opening a Word file still does not read its page margins.
- The on-page difference between a 1 in left margin and a 0.75 in right margin is real and measured, and easier to see in the dialog preview than on the page.
- The page updates when Ben clicks Apply. The preview updates as he types.
