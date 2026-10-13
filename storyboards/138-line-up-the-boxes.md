# Line up the boxes

Who: Nia is building a title slide. The word "Market" sits in a box on the left. "Saturday" sits in a box further right and lower. She wants their left edges to meet, then their tops, without retyping either word.

Inspired by: Google Slides' Arrange › Align › Left and Top. Align is hidden until you already know the menu, and selecting one object aligns it to the slide instead of telling you that a second object is required.

## Scenes

1. Nia opens a deck with one slide. "Market" is in a box whose left edge is further left than "Saturday". "Saturday" is lower. A third box, "Notes", sits on the right and is not part of the lineup.
2. She clicks "Market", then Shift-clicks "Saturday". Both boxes show they are selected. Align left appears. One click moves "Saturday" so its left edge matches "Market". "Market" does not move. Both words stay the same, and the boxes keep their widths.
3. With both still selected, she chooses Align top. "Saturday" moves up so its top matches "Market". The left edges stay together. "Notes" does not move.
4. She clicks only "Market". Align left is not offered. The single box stays where it is.
5. She saves, returns home, and reopens. "Market" and "Saturday" still share a left edge and a top edge. "Notes" is still on the right. The words are unchanged.

## Google Workspace benchmark

- Slides can align objects, but only from Arrange › Align, and only after a multi-selection that the toolbar does not explain.
- With one object selected, Align left pins that object to the slide edge. That is easy to do by mistake.
- After aligning, nothing on the toolbar says which edge the boxes now share.

## Better than Google Workspace when

1. Shift-click adds a second box to the selection. Both selected boxes are visibly selected. A plain click selects only one.
2. Align left and Align top appear when two or more boxes are selected. They do not appear for a single box. There is no Arrange menu and no dialog.
3. Align left moves the other boxes to the leftmost selected left edge. The leftmost box stays put. Widths and words stay the same.
4. Align top moves the other boxes to the topmost selected top edge. The left edges from the previous step stay aligned.
5. "Notes", which is not selected, does not move.
6. A single selected box does not jump to the slide edge.
7. Save and reopen keep the shared left edge, the shared top edge, the words, and the unselected box.

## Success

- Nia lines up "Market" and "Saturday" in two clicks, and "Notes" stays where it was.

## Gaps

- `Slides.tsx` keeps a single `selectedElementId`. A click replaces the selection. Shift-click cannot add a second box.
- Text alignment exists for the words inside one box. Nothing moves two boxes so their left edges or top edges meet.
