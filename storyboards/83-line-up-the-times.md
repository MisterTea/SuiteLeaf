# 83 · Line up the times

**Mode:** single-node · **App:** Docs · **Video:** [videos/83-line-up-the-times.mp4](videos/83-line-up-the-times.mp4) · **Script:** [scenes/83-line-up-the-times.spec.ts](scenes/83-line-up-the-times.spec.ts)

## Who and why

Nia is typing the garden-club agenda. Each line is a name, then a time. She presses Tab and the time only moves a few spaces, so 9:00 and 10:30 do not share a column. Google Docs makes her drag a marker on a ruler that is easy to miss.

## Inspired by

- [Use the ruler](https://support.google.com/docs/answer/183891): click the ruler to drop a tab stop, then Tab jumps there. People drag the marker off the ruler by accident, and a tab stop on one paragraph does not explain itself.
- SuiteLeaf has no tab stop. Tab in a paragraph does not line up a second column of times.

## Scenes

1. **The agenda.** Nia opens "Saturday agenda". Three lines read "Plant sale", "Compost", and "Officers", each followed by a time. The times do not line up.
2. **One stop.** She selects the three lines and types 3 in the Tab stop field. A guide appears on each line. No ruler drag.
3. **The jump.** She puts the caret before each time and presses Tab. 9:00, 10:30, and 11:00 land on that guide and share a column.
4. **One line.** She clicks Officers and changes that line's stop to 4 inches. Only 11:00 moves. The first two stay at 3 inches.
5. **Save and Word.** She reopens the file. The first two times are still at 3 inches and Officers is still at 4. File, Export DOCX keeps those tab stops.

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

9:00, 10:30, and 11:00 line up on a guide. Officers can sit further right without pulling the other two with it.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| A tab stop is a number in one control, in inches. No ruler drag. | Met | Video 0:08–0:11. The Tab stop field reads 3, and the hint says the three lines share that stop. `tests/browser/doc-tab-stops.spec.ts` |
| Tab after the name moves the time to that stop. | Met | Video 0:13–0:17. Each time jumps to the guide as Nia presses Tab. |
| The three times share a column when they use the same stop. | Met | Video 0:19. Their left edges are within 2px. Same assertion in the scene and the browser test. |
| Changing the stop on one line does not move the others. | Met | Video 0:22. Officers goes to 4 in; 9:00 and 10:30 stay together, about an inch to the left. |
| The stops survive save and reopen. | Met | Video 0:26. After reopen, two paragraphs are still 3 in and Officers is still 4. |
| The exported .docx keeps each paragraph's tab stop. | Met | Scene export check and `tests/doc-tab-stops.test.ts`: left stops at 4320, 4320, and 5760 twips, each with a tab. |

## Gaps and notes

- One left stop per paragraph. Decimal, center, and right tabs, and more than one custom stop on a line, are out of scope.
- The guide is a screen aid. It is not part of the printed page.
- Opening a Word file does not restore its tab stops. Export does write them.
- Margins, columns, line spacing, and page numbers are unchanged.
