# Indent the first line

Who: Nia is formatting a short story and a works-cited line. She wants the first line of each body paragraph to start half an inch in, and she wants a citation whose wrapped lines sit under the text rather than under the author's name.

Inspired by: Google Docs' Format › Align & indent › Indentation options, which offers a special indent of First line or Hanging. Microsoft Word's paragraph dialog does the same with First line and Hanging.

## Scenes

1. Nia opens a new document and types two paragraphs. She puts the caret in the first and chooses a first-line indent of 0.5 inches. Only the first line of that paragraph moves in. The second line, and the other paragraph, stay at the left margin.
2. She selects both paragraphs and sets the same first-line indent. Both first lines move. She sets the first paragraph back to none, and only that paragraph returns to the margin.
3. She types a works-cited entry long enough to wrap and chooses a hanging indent of 0.5 inches. The first line stays at the margin and the wrapped line starts half an inch in.
4. She saves, returns home, and reopens. The first-line and hanging indents are still there.
5. She downloads a Word file. The first-line paragraph has a first-line indent and the citation has a hanging indent.

## Google Workspace benchmark

- Docs hides first line and hanging behind Format › Align & indent › Indentation options, a separate dialog from the toolbar's increase and decrease indent buttons.
- The toolbar buttons shift the whole paragraph. They do not offer a first line or a hanging line.
- A custom amount is a number with a unit menu, easy to leave on the wrong unit.

## Better than Google Workspace when

1. First line and hanging live on the same paragraph control as line spacing and space before and after. There is no second dialog and no trip through the Format menu.
2. A first-line indent of 0.5 inches moves only the first line. The lines after it stay at the left margin.
3. A hanging indent of 0.5 inches leaves the first line at the margin and moves the wrapped lines in.
4. The choice applies only to the selected paragraphs. The increase and decrease indent buttons still shift a whole list item.
5. Changing the indent leaves line spacing and space before and after as they were.
6. Save and reopen keep both kinds of indent.
7. The downloaded Word file uses a first-line indent on the story paragraph and a hanging indent on the citation.

## Success

- Nia indents a story paragraph and a citation without opening a dialog, and Word keeps both.

## Gaps

- `apps/web/src/editors/Docs.tsx` has increase and decrease indent for a whole block. Nothing sets a first-line or hanging indent.
- A search for first-line and hanging indent in `apps/web` and `packages/core` finds no match.
