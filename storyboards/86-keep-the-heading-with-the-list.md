# 86 · Keep the heading with the list

**Mode:** single-node · **App:** Docs · **Video:** [videos/86-keep-the-heading-with-the-list.mp4](videos/86-keep-the-heading-with-the-list.mp4) · **Script:** [scenes/86-keep-the-heading-with-the-list.spec.ts](scenes/86-keep-the-heading-with-the-list.spec.ts)

## Who and why

Nia’s newsletter has a heading, “This week”, at the bottom of page 1 and the three items that belong under it on page 2. She wants the heading to travel with those items. Google Docs hides that under Format, Line & paragraph spacing, Keep with next.

## Inspired by

- [Keep lines and paragraphs together](https://support.google.com/docs/answer/1696498): Format › Line & paragraph spacing › Keep with next. People cannot tell which paragraph it applies to, and a heading left behind is a common print surprise.
- SuiteLeaf pagination does not keep a heading with the following paragraph. There is no `keepNext` on a paragraph.

## Scenes

1. **The split.** Nia opens “Garden club news”. Enough text fills page 1 so “This week” sits on the last line. The three items start on page 2.
2. **Keep them together.** She puts the caret in “This week” and turns on Keep with next. No second dialog.
3. **The page.** “This week” moves to page 2, above the three items. Page 1 no longer ends with a stranded heading.
4. **Off.** She turns Keep with next off. “This week” returns to the bottom of page 1.
5. **Save and Word.** She turns it on again, reopens the file, and the heading is still with the items. The exported .docx marks that heading to keep with the next paragraph.

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

## Gaps and notes

- Pagination does not keep a paragraph with the next one.
- Keep lines together and widow/orphan control are out of scope.
- Do not change columns, margins, or line spacing.
