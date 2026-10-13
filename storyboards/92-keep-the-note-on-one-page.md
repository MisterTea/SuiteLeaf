# 92 · Keep the note on one page

**Mode:** single-node · **App:** Docs · **Video:** [videos/92-keep-the-note-on-one-page.mp4](videos/92-keep-the-note-on-one-page.mp4) · **Script:** [scenes/92-keep-the-note-on-one-page.spec.ts](scenes/92-keep-the-note-on-one-page.spec.ts)

## Who and why

Nia’s three-line reminder splits so the first line sits at the bottom of page 1 and the rest starts page 2. She wants the whole reminder on one page. Google Docs hides that under Format, Line & paragraph spacing, Keep lines together.

## Inspired by

- [Keep lines and paragraphs together](https://support.google.com/docs/answer/1696498): Keep lines together is a separate item from Prevent single lines and Keep with next. People turn on the wrong one and still get a split paragraph.
- SuiteLeaf can keep a heading with the next block, and can refuse to leave a single line alone. It cannot keep every line of one paragraph on the same page.

## Scenes

1. **The split.** Nia opens “Garden club news”. The reminder “Bring gloves, a hat, and a trowel.” starts on the last line of page 1 and finishes on page 2.
2. **The switch.** She puts the caret in that reminder and turns on Keep lines together. No second dialog. The control shows that it is on.
3. **One page.** The whole reminder is on page 2. No line of it remains on page 1. The heading above it stays where it was.
4. **Off.** She turns the control off. The reminder splits across the page break again.
5. **Save and Word.** She turns it on, reopens the file, and the reminder is still on one page. The exported .docx sets keep-lines on that paragraph and not on a paragraph she left off.

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

## Gaps and notes

- Don’t leave one line and Keep with next already exist or are in progress. Do not replace them.
- A paragraph longer than one page is out of scope.
- Do not change margins, columns, or line spacing.
