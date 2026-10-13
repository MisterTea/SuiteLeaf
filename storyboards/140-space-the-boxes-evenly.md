# Space the boxes evenly

Who: Nia has three boxes on a title slide: "Market", "Saturday", and "Notes". The gap between Market and Saturday is much wider than the gap between Saturday and Notes. She wants the same amount of space between each pair, without moving the outer boxes or changing the words.

Inspired by: Google Slides' Arrange › Distribute › Horizontally and Vertically. Distribute is in that same hidden menu, and with fewer than three objects it does nothing without saying so.

## Scenes

1. Nia opens a deck. Market is on the left, Notes is on the right, and Saturday sits close to Notes, so the left gap is much larger than the right gap. The three boxes are at the same height. A fourth box, "Door", sits below and is not part of the spacing.
2. She Shift-clicks Market, Saturday, and Notes. Space evenly across appears. One click leaves Market and Notes where they are and moves Saturday so the gap after Market equals the gap before Notes. Widths and words stay the same. Door does not move.
3. She stacks three boxes with uneven vertical gaps, Shift-clicks them, and chooses Space evenly down. The top and bottom boxes stay. The middle box moves so the vertical gaps match. Their horizontal positions stay.
4. With only two boxes selected, Space evenly across and Space evenly down are not offered.
5. She saves, returns home, and reopens. The even horizontal gaps are still there. Door is still where it started.

## Google Workspace benchmark

- Slides can distribute objects, but only from Arrange › Distribute.
- With two objects selected, the command is still in the menu and does nothing.
- After distributing, nothing says that the outer objects stayed put and only the middle ones moved.

## Better than Google Workspace when

1. Space evenly across and Space evenly down appear when three or more boxes are selected. They do not appear for one or two boxes. There is no Arrange menu and no dialog.
2. Space evenly across keeps the leftmost and rightmost selected boxes where they are. The boxes between them move so the gap from one box's right edge to the next box's left edge is the same for every pair. Widths and words stay the same.
3. Space evenly down keeps the topmost and bottommost selected boxes where they are. The boxes between them move so the vertical gaps are equal. Horizontal positions stay.
4. Door, which is not selected, does not move.
5. Align left, Align right, Align top, and Align bottom still do what they did.
6. Save and reopen keep the even gaps, the words, and Door.
7. The gaps are equal in pixels, including when the boxes have different widths.

## Success

- Nia evens the space between Market, Saturday, and Notes, and the outer boxes stay put.

## Gaps

- `alignBoxes` in `apps/web/src/editors/slide-editing.ts` only lines boxes up on an edge. Nothing spaces the boxes between the outer ones.
- The selection toolbar offers Align left, Align right, Align top, and Align bottom. It does not offer an even-spacing command.
