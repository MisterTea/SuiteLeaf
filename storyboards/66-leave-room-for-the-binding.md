# 66 · Leave room for the binding

**Mode:** single-node · **App:** Docs · **Video:** [videos/66-leave-room-for-the-binding.mp4](videos/66-leave-room-for-the-binding.mp4) · **Script:** [scenes/66-leave-room-for-the-binding.spec.ts](scenes/66-leave-room-for-the-binding.spec.ts)

## Who and why

Ben is printing the minutes double-sided and stapling them on the left. The text runs into the staple. Page setup has one margin for every edge. There is no extra gutter on the inside edge, so odd pages need more room on the left and even pages need more room on the right.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/86629): Google Docs has no binding gutter. Word does, under Layout › Margins › Custom, and it swaps sides on even pages.
- Storyboard [62](62-odd-and-even-pages.md): headers already swap sides. The text itself still uses equal margins, so it crowds the staple.
- Page setup stores one margin. The gutter lives in `packages/core/src/document-layout.ts` and in the Page setup dialog.

## Scenes

1. **Equal margins.** Ben writes "Minutes" across three pages. Every page has the same gap on the left and the right. The first line starts at the same distance from the left edge on page 2 and page 3.
2. **A header.** Page setup adds "Garden club" and page numbers. Gutter is 0. A facing-page preview shows both pages with the same margins.
3. **Refused.** He types 3 inches. Apply stays off, and the dialog says a gutter larger than 2 inches is refused.
4. **A gutter.** He sets Gutter to 0.5 in. The preview shades the staple side: the right of the even page and the left of the odd page. The outside edge stays put. After Apply, page 3 starts further from the left, and page 2 keeps its header on the outside while the extra half inch is on the right.
5. **The cover.** Page 1 uses the gutter on the left. Different first page is not on this base; page 1 is an odd page, so it is bound on the left anyway.
6. **Zero.** He sets the gutter back to 0. The shaded room disappears and pages 2 and 3 line up again.
7. **Save.** He sets 0.5 in again, closes the file, and opens it. The field still says 0.5, and the inside edges are still wider.

## Google Workspace benchmark

Google Docs does not offer a binding gutter. People fake it by making the left margin huge, which then wastes the outside edge of every page, including the backs. Word's gutter swaps sides when "Mirror margins" is on.

## Better than Google Workspace when

1. Page setup has a Gutter field next to the margins, in inches, default 0.
2. On odd pages the extra space is on the left. On even pages it is on the right. The outside margin does not grow.
3. The first line of body text moves by the gutter amount. Headers on the outside edge do not.
4. Setting the gutter to 0 restores equal margins in one step.
5. The gutter survives save and reopen.
6. A gutter larger than 2 inches is refused, so the text cannot be pushed off the page.

## Success looks like

The staple side of every sheet has an extra half inch, shaded on screen so it is obvious before printing. The outside edge does not. Reopening the file keeps it.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Gutter field, inches, default 0 | Met | Video 0:22. Dialog shows Gutter (inches) at 0 beside Margins. `tests/browser/page-gutter.spec.ts` |
| Odd left, even right, outside stays | Met | Video 0:33 page 3, 0:39 page 2, 1:00 both. Test measures a 0.5 in shift and an unchanged outside edge |
| Body moves; outside header does not | Met | Video 0:39. Page 2 header stays on the left; the first line's right edge moves in. Test compares header position before and after |
| Zero restores equal margins | Met | Video 0:48. One Apply, then the lines line up and the shade is gone |
| Survives save and reopen | Met | Video 0:54–1:00. Reopen shows 0.5 in and the inside shade. Test reads `pageSettings.gutter === 48` |
| Above 2 inches is refused | Met | Video 0:27. 3 inches, red message, Apply disabled |

## Gaps and notes

- The shaded band is an on-screen guide. It is hidden when printing. Printed pages keep the extra space as blank margin.
- Different first page is not on this base. Page 1 still gets the left gutter because it is an odd page.
- Odd and even headers are not on this base. The gutter still swaps. A header on the left stays put on even pages, which is the outside edge. The page number on the right stays put on odd pages.
- A paragraph that crosses a page break keeps one inset, so a single block is not split onto both edges.
- Footnotes still use the original margin and do not follow the gutter.
- A Word round trip of the gutter is not done. HTML print uses CSS `:left` and `:right` page margins.
