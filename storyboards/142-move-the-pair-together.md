# Move the pair together

Who: Nia lined up "Market" and "Saturday" on a title slide. She wants to slide that pair to the right without leaving Saturday behind, and without moving "Notes".

Inspired by: Google Slides' Arrange › Group. Group is in that hidden menu. After grouping, nothing on the toolbar says the boxes are one pair, so Ungroup is easy to miss.

## Scenes

1. Nia opens a deck. Market and Saturday are separate boxes. Notes sits apart. She Shift-clicks Market and Saturday. Group appears. One click joins them. The control then reads Ungroup.
2. She drags Market. Saturday moves by the same amount. The gap between them stays the same. Both words stay the same. Notes does not move.
3. She clicks Ungroup. She drags Market again. Saturday stays where the pair left it. Notes still does not move.
4. She groups them again, saves, returns home, and reopens. Dragging Market still moves Saturday with it.
5. With only Market selected and not grouped, Group is not offered. Align left still lines up two selected boxes that are not a group.

## Google Workspace benchmark

- Slides can group objects, but only from Arrange › Group.
- The toolbar does not change to Ungroup, so the only sign of a group is that the handles surround both objects.
- Grouping two objects can swallow a third object that was merely nearby if the selection was unclear.

## Better than Google Workspace when

1. Group appears when two or more boxes are selected and they are not already one group. One click. There is no Arrange menu and no dialog.
2. After grouping, the control reads Ungroup. Dragging any box in the group moves the others by the same amount. Words, widths, and the gap between the grouped boxes stay the same.
3. Notes, which was not selected, does not move.
4. Ungroup leaves the boxes where they are. The next drag moves only the box under the pointer.
5. A single selected box does not offer Group.
6. Save and reopen keep the group, so the pair still moves together.
7. Align left still lines up two selected boxes that are not grouped. Spacing and the other align commands still work.

## Success

- Nia slides Market and Saturday together, and Notes stays put.

## Gaps

- `slideElementSchema` in `packages/core/src/index.ts` has no group id. Boxes cannot remember that they belong together.
- `Slides.tsx` moves the selected box by itself. A drag does not move a second box.
