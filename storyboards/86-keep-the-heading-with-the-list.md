# 86 · Keep the heading with the list

**Mode:** single-node · **App:** Docs · **Video:** [videos/86-keep-the-heading-with-the-list.mp4](videos/86-keep-the-heading-with-the-list.mp4) · **Script:** [scenes/86-keep-the-heading-with-the-list.spec.ts](scenes/86-keep-the-heading-with-the-list.spec.ts)

## Who and why

Nia’s newsletter has a heading, “This week”, at the bottom of page 1 and the three items that belong under it on page 2. She wants the heading to travel with those items. Google Docs hides that under Format, Line & paragraph spacing, Keep with next.

## Inspired by

- [Keep lines and paragraphs together](https://support.google.com/docs/answer/1696498): Format › Line & paragraph spacing › Keep with next. People cannot tell which paragraph it applies to, and a heading left behind is a common print surprise.
- SuiteLeaf pagination does not keep a heading with the following paragraph. There is no `keepNext` on a paragraph.

## Scenes

1. **The split.** Nia opens “Garden club news”. “This week” is the last line of page 1. Seed swap, garden class, and work day start on page 2.
2. **Keep them together.** She clicks “This week”. A Keep with next control appears on that heading and reads Off. One click turns it On. No second dialog.
3. **The page.** “This week” moves to page 2, above the three items. A blue bar marks the heading. Page 1 now ends on the line before it.
4. **Off.** She turns Keep with next off. “This week” returns to the bottom of page 1 and the items stay on page 2.
5. **Save and Word.** She turns it on again. The status says saved. She reopens the file: the heading is still with the items, and the control still says On. File, Export DOCX writes keep-with-next on that heading only.

## Google Workspace benchmark

In Google Docs the path is Format, Line & paragraph spacing, Keep with next ([Docs Help](https://support.google.com/docs/answer/1696498)). The menu does not say which paragraph will move, and the result is easy to miss until you print.

## Better than Google Workspace when

1. Keep with next is one control on the paragraph that has the caret. No second dialog.
2. The control shows that it is on for that paragraph.
3. With it on, a heading that would be the last line of a page moves to the next page with the following paragraph.
4. Turning it off puts the heading back at the bottom of the previous page.
5. The choice survives save and reopen.
6. The exported .docx sets keep-with-next on that heading and not on the paragraphs that were left off.

## Success looks like

“This week” and the three items start together on page 2. Turning the control off separates them again. Word keeps the heading with what follows.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| One control on the paragraph with the caret. No second dialog. | Met | Video 0:08, control beside “This week”. `tests/browser/keep-next.spec.ts` |
| The control shows that it is on. | Met | Video 0:11, blue badge reads On. Same test, `aria-pressed` |
| On moves a last-line heading onto the next page with the following paragraph. | Met | Video 0:11, “This week” joins the three items on page 2 |
| Off puts the heading back. | Met | Video 0:14, heading on page 1, items on page 2 |
| The choice survives save and reopen. | Met | Video 0:17 saved, 0:21 reopened with the badge still On |
| Exported .docx sets keep-with-next on that heading only. | Met | Video 0:23 Export DOCX. `tests/doc-keep-next.test.ts` and the browser test check `w:keepNext` |

## Gaps and notes

- The Keep with next switch no longer floats beside the caret. It covered the heading while someone was typing. A heading already saved with keep-with-next still travels with the following block.
- Keep lines together and widow/orphan control are still out of scope.
- Columns, margins, line spacing, tab stops, and headers are unchanged.
- A Word file’s existing keep-with-next is not read on import.
