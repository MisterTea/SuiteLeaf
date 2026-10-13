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
2. **Four fields.** In Page setup he sets Top 1.5 in, Bottom 0.75 in, Left 1 in, and Right 0.75 in. A small preview shows the page getting taller at the top only.
3. **The page.** The first line sits further down. The last line sits closer to the bottom than to the top. The left gap is wider than the right.
4. **A bad value.** He tries Top 0. The field explains that a margin must be at least 0.25 inches, and Apply stays off.
5. **Save.** He reopens the file. The four margins are unchanged.

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

## Gaps and notes

- One margin value is applied to every edge.
- The gutter from storyboard 66, if present, is extra on the inside and must still add to Left or Right rather than replace them.
- A Word round trip of the four margins is a bonus, not required.
