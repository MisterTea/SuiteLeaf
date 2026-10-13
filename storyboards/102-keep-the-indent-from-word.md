# Keep the indent from Word

**Mode:** single-node · **App:** Docs · **Video:** [videos/102-keep-the-indent-from-word.mp4](videos/102-keep-the-indent-from-word.mp4) · **Script:** [scenes/102-keep-the-indent-from-word.spec.ts](scenes/102-keep-the-indent-from-word.spec.ts)

Who: Nia wrote a short story in Word. Each body paragraph indents the first line by half an inch, and the works-cited line uses a hanging indent. She opens that file in SuiteLeaf and expects both indents to still be there.

Inspired by: Google Docs opens a Word file and keeps Format › Align & indent › Indentation options for First line and Hanging. Microsoft Word stores a first-line indent as `w:firstLine` and a hanging indent as `w:left` plus `w:hanging`.

## Scenes

1. Nia opens a Word file with two body paragraphs. The first paragraph's properties include `<w:ind w:firstLine="720"/>` and nothing else on that indent. In SuiteLeaf only the first line of that paragraph starts half an inch in. The second paragraph has no `w:ind`, and both of its lines stay at the left margin.
2. The same file has a works-cited paragraph with `<w:ind w:left="720" w:hanging="720"/>`. Its first line stays at the margin and the wrapped line starts half an inch in.
3. She puts the caret in the story paragraph. The paragraph control shows First line, 0.5 in. In the citation it shows Hanging, 0.5 in. In the plain paragraph it shows None.
4. The story paragraph also had 1.5 line spacing and 12 pt of space after in Word. Those are still 1.5 and 12 pt. The indent import did not clear them.
5. She saves, returns home, and reopens. Both indents are still there. She downloads Word again, and the story paragraph still has `w:firstLine="720"` and the citation still has `w:left="720"` and `w:hanging="720"`.

## Google Workspace benchmark

- Docs keeps a Word first-line indent and a Word hanging indent, but the only place to see which one arrived is Format › Align & indent › Indentation options, a separate dialog.
- A paragraph with no indent, a first-line indent, and a hanging indent can look similar until that dialog is open.
- Docs does not show the indent choice beside line spacing.

## Better than Google Workspace when

1. Opening the Word file shows the first-line indent on the story paragraph: only the first line moves half an inch, and the following line stays at the margin.
2. The citation's hanging indent leaves the first line at the margin and moves the wrapped line half an inch in.
3. The paragraph with no `w:ind` stays at the margin. Its lines line up with the second line of the story paragraph.
4. The paragraph control on the line-spacing button shows First line, Hanging, or None for the caret's paragraph, with 0.5 in where Word stored 720 twips. There is no second dialog.
5. Line spacing and space before and after from the Word file stay as they were.
6. Save and reopen keep both indents.
7. Downloading Word again writes `w:firstLine="720"` on the story paragraph and `w:left="720"` `w:hanging="720"` on the citation.

## Success

- Nia opens the Word file and both indents are visible, named on the paragraph control, and still in the file she downloads.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Opening the Word file shows the first-line indent: only the first line moves half an inch, and the following line stays at the margin. | Met | Video ~0:04. The story's first line sits in and "on the far bank" stays at the margin. `tests/word-indent-import.test.ts` |
| The citation's hanging indent leaves the first line at the margin and moves the wrapped line half an inch in. | Met | Video ~0:08 and ~0:18. "Okada, Mara" stays at the margin and "who wait" sits in. |
| The paragraph with no `w:ind` stays at the margin, lined up with the story's second line. | Met | Video ~0:04. "By noon" lines up with "on the far bank." |
| The line-spacing control shows First line, Hanging, or None, with 0.5 in where Word stored 720 twips. No second dialog. | Met | Video ~0:12 First line and By 0.5 in. ~0:14 None. ~0:17 Hanging and By 0.5 in. |
| Line spacing and space before and after from the Word file stay as they were. | Unmet | The Word file stores 1.5 line spacing and 12 pt after on the story paragraph. Import does not read `w:spacing`, so the control shows Single and 0 pt. Indent import does not clear spacing attributes when they are already on the paragraph. This story does not add a spacing importer. |
| Save and reopen keep both indents. | Met | Video ~0:22. Home, then the reopened page still shows both indents. |
| Downloading Word again writes `w:firstLine="720"` on the story and `w:left="720"` `w:hanging="720"` on the citation. | Met | Video ~0:26 File, Export DOCX. The scene and `tests/word-indent-import.test.ts` check those attributes. The plain paragraph has no `w:ind`. |

## Gaps

- Import reads `w:ind` on the paragraph's `w:pPr` and stores `firstLineIndent` or `hangingIndent`. A hanging indent wins if both `w:hanging` and `w:firstLine` are set. A left indent alone is not a special indent.
- Export already wrote `w:firstLine` and `w:left`/`w:hanging`. Re-export uses that same path.
- Word line spacing and space before and after are still not imported.
