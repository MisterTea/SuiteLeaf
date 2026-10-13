# 83 · Line up the times

**Mode:** single-node · **App:** Docs · **Video:** [videos/83-line-up-the-times.mp4](videos/83-line-up-the-times.mp4) · **Script:** [scenes/83-line-up-the-times.spec.ts](scenes/83-line-up-the-times.spec.ts)

## Who and why

Nia is typing the garden-club agenda. Each line is a name, then a time. She presses Tab and the time only moves a few spaces, so 9:00 and 10:30 do not share a column. Google Docs makes her drag a marker on a ruler that is easy to miss.

## Inspired by

- [Use the ruler](https://support.google.com/docs/answer/183891): click the ruler to drop a tab stop, then Tab jumps there. People drag the marker off the ruler by accident, and a tab stop on one paragraph does not explain itself.
- SuiteLeaf has no tab stop. Tab in a paragraph does not line up a second column of times.

## Scenes

1. **The agenda.** Nia opens "Saturday agenda". Three lines read "Plant sale", "Compost", and "Officers", each followed by a time. The times do not line up.
2. **One stop.** She selects the three lines and sets a tab stop at 3 inches from one control. No ruler drag.
3. **The jump.** She puts the caret after "Plant sale" and presses Tab. "9:00" lands at that stop. She does the same for the other two lines. 9:00, 10:30, and 11:00 share a column.
4. **One line.** She moves the stop on the Officers line to 4 inches. Only that time moves. The first two stay at 3 inches.
5. **Save and Word.** She reopens the file. The first two times are still at 3 inches and Officers is still at 4. The exported .docx keeps those tab stops.

## Google Workspace benchmark

In Google Docs you show the ruler, click it, then press Tab ([Docs Help](https://support.google.com/docs/answer/183891)). The stop belongs to the paragraph under the caret, and dragging it is how you move or delete it.

## Better than Google Workspace when

1. A tab stop is a number in one control on the selection, in inches. No ruler drag.
2. Tab after the name moves the time to that stop on each selected line.
3. The three times share a column when they use the same stop.
4. Changing the stop on one line does not move the others.
5. The stops survive save and reopen.
6. The exported .docx keeps each paragraph's tab stop.

## Success looks like

9:00, 10:30, and 11:00 line up. Officers can sit further right without pulling the other two with it.

## Gaps and notes

- There is no tab stop today.
- Decimal tabs, center tabs, and a visible ruler are out of scope.
- Do not change margins, columns, or line spacing.
