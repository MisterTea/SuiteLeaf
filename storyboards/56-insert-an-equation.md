# 56 · Insert an equation

**Mode:** single-node · **App:** Docs · **Video:** [videos/56-insert-an-equation.mp4](videos/56-insert-an-equation.mp4) · **Script:** [scenes/56-insert-an-equation.spec.ts](scenes/56-insert-an-equation.spec.ts)

## Who and why

Amara is writing a short methods note. She needs `x²` as a real equation, not a superscript typed by hand, and a fraction `(a+b)/c` that sits on two lines. A Word file that already contains an equation opens in SuiteLeaf as recovered text, with a compatibility note that editable equation layout is not supported.

## Inspired by

- [Insert an equation](https://support.google.com/docs/answer/1696498): Insert › Equation, then type or pick a structure. Google's equation editor is easy to open and hard to edit later, because the equation becomes an image-like object.
- `packages/core/src/word.ts`: "Equations are retained as recovered text when available; editable equation layout is not supported."
- Storyboard [05](05-tables-images-and-links.md) already has superscript for a single character. This story is a real equation, not that shortcut.

## Scenes

1. **The note.** Amara opens "Methods" and writes "The model fits", with the caret still in the sentence.
2. **A square.** Insert › Equation, type `x^2`. The preview shows a power. Inserting it puts x with a raised 2 in the sentence, as math.
3. **A fraction.** She keeps writing and types `(a+b)/c`. The numerator sits on a bar and c sits under it. Both equations stay in the sentence, and the words around them keep their font.
4. **Edit.** She clicks the denominator. Only that symbol is selected. She types `d`. The numerator and the rest of the sentence stay put.
5. **The file.** She leaves and opens Methods again. The square and the fraction are still math.
6. **From Word.** She opens a .docx that already contains n². It is an equation. The compatibility note is about page layout. It does not say equation layout is unsupported. She changes the exponent from 2 to 3.
7. **Back to Word.** She exports .docx. Opening that file again still shows n³ as math, not a picture and not recovered text.

## Google Workspace benchmark

In Google Docs, Insert › Equation opens a toolbar of structures, then you type. It takes one menu click plus the structure ([Docs Help](https://support.google.com/docs/answer/1696498)). The result is not normal text, so you cannot place the caret inside it the way you can in Word. People also lose the equation when they export to Word and get an image.

## Better than Google Workspace when

1. Insert › Equation inserts math at the caret. The menu item exists.
2. `x^2` displays as a superscript that is part of the equation, and `(a+b)/c` displays as a stacked fraction.
3. Clicking the equation lets the user edit one symbol without retyping the whole equation.
4. The surrounding sentence keeps its font and position.
5. A Word equation imports as an editable equation, and the import note no longer says equation layout is unsupported for that file.
6. Exporting to .docx writes Office math (`m:oMath`), not a picture and not plain recovered text.
7. The equation survives save and reopen in a SuiteLeaf file.

## Success looks like

The methods note shows a square and a fraction, and the denominator is d. The Word file's equation is still math after export and reopen.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Insert › Equation inserts math at the caret | Met | Video 4s–10s; `insert an equation, edit one symbol, and round-trip Office math` |
| `x^2` is a superscript inside the equation, and `(a+b)/c` is a stacked fraction | Met | Video 8s and 16s–18s; browser test checks the exponent sits above the base and the numerator sits above the denominator |
| Clicking the equation edits one symbol | Met | Video 20s–23s, c becomes d; video 33s–35s, 2 becomes 3 |
| The surrounding sentence keeps its font and position | Met | Video 18s; browser test compares the sentence font with the equation font and checks they share a line |
| A Word equation imports as an editable equation, and the note does not say layout is unsupported | Met | Video 30s–33s; `imports a Word equation as editable math and skips the unsupported note` |
| Export writes Office math (`m:oMath`), not a picture or recovered text | Met | Video 36s–39s, the reopened file is still n³; vitest `writes Office math on export and reads it back` |
| The equation survives save and reopen | Met | Video 24s–28s |

## Gaps and notes

- Powers and stacked fractions are enough for this story. Radicals, sums, matrices, and a structure toolbar are not included.
- Linear typing (`x^2`, `(a+b)/c`) is the way in. Office math that is not a power, a subscript, or a fraction comes back as an editable run of its text.
- Citations, footnotes, and spelling were left alone.
