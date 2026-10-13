# Keep the indent from Word

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

## Gaps

- `packages/core/src/word.ts` reads paragraph styles, outline level, and numbering from `w:pPr`. It never reads `w:ind`.
- Export in `packages/core/src/docx-export.ts` already writes `w:firstLine` and `w:left`/`w:hanging` from `firstLineIndent` and `hangingIndent`. Import does not put those attributes back on the paragraph.
