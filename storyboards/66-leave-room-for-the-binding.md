# 66 · Leave room for the binding

**Mode:** single-node · **App:** Docs · **Video:** [videos/66-leave-room-for-the-binding.mp4](videos/66-leave-room-for-the-binding.mp4) · **Script:** [scenes/66-leave-room-for-the-binding.spec.ts](scenes/66-leave-room-for-the-binding.spec.ts)

## Who and why

Ben is printing the minutes double-sided and stapling them on the left. The text runs into the staple. Page setup has one margin for every edge. There is no extra gutter on the inside edge, so odd pages need more room on the left and even pages need more room on the right.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/86629): Google Docs has no binding gutter. Word does, under Layout › Margins › Custom, and it swaps sides on even pages.
- Storyboard [62](62-odd-and-even-pages.md): headers already swap sides. The text itself still uses equal margins, so it crowds the staple.
- Page setup stores one margin. There is no gutter field in `packages/core/src/document-layout.ts`.

## Scenes

1. **Equal margins.** Ben opens "Minutes". Every page has the same gap on the left and the right. The first line starts at the same distance from the left edge on page 2 and page 3.
2. **A gutter.** In Page setup he sets Gutter to 0.5 in. Page 3, an odd page, starts further from the left. Page 2, an even page, starts further from the right. The outside edge stays at the original margin.
3. **The letterhead.** Page 1, if Different first page is on, still uses the gutter on the left, because a cover is bound on the left too.
4. **Zero.** He sets the gutter back to 0. Pages 2 and 3 line up again.
5. **Save.** He reopens the file. The 0.5 in gutter is back, and the inside edges are still wider.

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

The staple side of every sheet has an extra half inch. The outside edge does not. Reopening the file keeps it.

## Gaps and notes

- Margins are one value for every edge.
- Odd and even headers may not be on this base. The gutter must still swap sides on even pages.
- A Word round trip of the gutter is a bonus, not required.
