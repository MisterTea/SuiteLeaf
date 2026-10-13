# Line up the right edges

Who: Nia has "Market" in a wide box and "Saturday" in a narrower box whose right edge sticks out past Market. She wants those right edges to meet, then the bottom edges, without changing the words or the widths.

Inspired by: Google Slides' Arrange › Align › Right and Bottom. Those commands sit in the same hidden menu as Left and Top, and with one object selected they pin it to the slide edge.

## Scenes

1. Nia opens a deck. "Market" is a wide box. "Saturday" is narrower, and its right edge is further right than Market's. Saturday's bottom is lower. "Notes" sits elsewhere and is not part of the lineup.
2. She Shift-clicks both boxes. Align right appears beside Align left. One click moves Market so its right edge matches Saturday's. Saturday does not move. Both widths and both words stay the same.
3. With both still selected, she chooses Align bottom. Market moves down so its bottom edge matches Saturday's. The right edges stay together. Notes does not move.
4. She clicks only Market. Align right and Align bottom are not offered. Market stays where it is.
5. She saves, returns home, and reopens. Market and Saturday still share a right edge and a bottom edge. The words are unchanged and Notes is unmoved.
6. She selects both again and chooses Align left. The left edges meet. Align top still meets the tops. Those existing commands still work after the new ones.

## Google Workspace benchmark

- Slides can align right and bottom, but only from Arrange › Align.
- With one object selected, Align right pins that object to the slide's right edge.
- A wider box and a narrower box look lined up on the left while their right edges still disagree, and the menu does not say which edge will move.

## Better than Google Workspace when

1. Align right and Align bottom appear beside Align left and Align top when two or more boxes are selected. They do not appear for a single box. There is no Arrange menu and no dialog.
2. Align right moves the other boxes so each right edge meets the furthest selected right edge. The box that already owns that edge stays put. Widths and words stay the same.
3. Align bottom moves the other boxes so each bottom edge meets the lowest selected bottom edge. The right edges from the previous step stay aligned.
4. Notes, which is not selected, does not move.
5. A single selected box does not jump to the slide edge.
6. Save and reopen keep the shared right edge, the shared bottom edge, the words, and the unselected box.
7. Align left and Align top still do what they did.

## Success

- Nia lines up the right edges and the bottoms of Market and Saturday, and Notes stays where it was.

## Gaps

- `alignBoxes` in `apps/web/src/editors/slide-editing.ts` accepts only `"left"` and `"top"`.
- The selection toolbar offers Align left and Align top. It does not offer Align right or Align bottom.
