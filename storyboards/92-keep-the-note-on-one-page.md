# 92 · Keep the note on one page

**Mode:** single-node · **App:** Docs · **Video:** [videos/92-keep-the-note-on-one-page.mp4](videos/92-keep-the-note-on-one-page.mp4) · **Script:** [scenes/92-keep-the-note-on-one-page.spec.ts](scenes/92-keep-the-note-on-one-page.spec.ts)

## Who and why

Nia’s three-line reminder splits so the first line sits at the bottom of page 1 and the rest starts page 2. She wants the whole reminder on one page. Google Docs hides that under Format, Line & paragraph spacing, Keep lines together.

## Inspired by

- [Keep lines and paragraphs together](https://support.google.com/docs/answer/1696498): Keep lines together is a separate item from Prevent single lines and Keep with next. People turn on the wrong one and still get a split paragraph.

## Scenes

1. **The split.** Nia opens “Garden club news”. The reminder is three lines: “Bring gloves,” then “a hat,” then “and a trowel.” The first line is the last line of page 1. The other two start page 2.
2. **The switch.** She puts the caret in that reminder. Keep lines together sits in the margin, separate from Keep with next and Don’t leave one line. No second dialog.
3. **One page.** She turns it on. The switch reads On. The whole reminder is on page 2. “What to bring” and “Meet at the gate.” stay on page 1.
4. **Off.** She turns the control off. “Bring gloves,” is the last line of page 1 again, and the other two lines start page 2.
5. **Save and Word.** She turns it on, goes back to the file list, reopens “Garden club news”, and the reminder is still on one page. File, Export DOCX sets keep-lines on that paragraph and not on the others.

## Google Workspace benchmark

In Google Docs the path is Format, Line & paragraph spacing, Keep lines together ([Docs Help](https://support.google.com/docs/answer/1696498)). It sits beside Prevent single lines, and the names do not say which one moves the whole paragraph.

## Better than Google Workspace when

1. Keep lines together is one control on the paragraph that has the caret. No second dialog.
2. The control shows that it is on, and it is separate from Don’t leave one line and Keep with next.
3. With it on, every line of that paragraph stays on the same page. A paragraph that would split moves wholly to the next page.
4. Turning it off allows the split again.
5. The choice survives save and reopen.
6. The exported .docx sets keep-lines on that paragraph only.

## Success looks like

The reminder sits together on page 2. Turning the control off lets it split again. Word keeps the same rule.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. One control on the paragraph that has the caret. No second dialog. | Met | Video 0:08. The switch is on the reminder. `tests/browser/keep-lines.spec.ts` finds no dialog. |
| 2. The control shows that it is on, and it is separate from Don’t leave one line and Keep with next. | Met | Video 0:12. The switch reads On. The other two stay Off. |
| 3. With it on, every line of that paragraph stays on the same page. A paragraph that would split moves wholly to the next page. | Met | Video 0:12. All three reminder lines are on page 2. “What to bring” stays on page 1. |
| 4. Turning it off allows the split again. | Met | Video 0:18. “Bring gloves,” is the last line of page 1, and “a hat,” starts page 2. |
| 5. The choice survives save and reopen. | Met | Video 0:24. After reopen the reminder is still together and the switch is On. |
| 6. The exported .docx sets keep-lines on that paragraph only. | Met | Video 0:28, File › Export DOCX. `tests/doc-keep-lines.test.ts` expects `<w:keepLines` on the reminder and not on the heading or “The board meets Monday.” |

## Gaps and notes

- Don’t leave one line and Keep with next stay separate switches. A heading still travels with the paragraph after it, so the reminder is not that paragraph.
- A paragraph longer than one page is out of scope.
- Opening a Word file does not read keep-lines back. Export writes it.
- Margins, columns, and line spacing are unchanged.
