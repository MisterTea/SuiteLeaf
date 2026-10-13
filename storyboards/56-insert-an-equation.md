# 56 · Insert an equation

**Mode:** single-node · **App:** Docs · **Video:** [videos/56-insert-an-equation.mp4](videos/56-insert-an-equation.mp4) · **Script:** [scenes/56-insert-an-equation.spec.ts](scenes/56-insert-an-equation.spec.ts)

## Who and why

Amara is writing a short methods note. She needs `x²` as a real equation, not a superscript typed by hand, and a fraction `(a+b)/c` that sits on two lines. A Word file that already contains an equation opens in SuiteLeaf as recovered text, with a compatibility note that editable equation layout is not supported.

## Inspired by

- [Insert an equation](https://support.google.com/docs/answer/1696498): Insert › Equation, then type or pick a structure. Google's equation editor is easy to open and hard to edit later, because the equation becomes an image-like object.
- `packages/core/src/word.ts`: "Equations are retained as recovered text when available; editable equation layout is not supported."
- Storyboard [05](05-tables-images-and-links.md) already has superscript for a single character. This story is a real equation, not that shortcut.

## Scenes

1. **The note.** Amara opens "Methods" and puts the caret in a sentence.
2. **A square.** Insert › Equation, type `x^2`, and close the editor. The page shows x with a raised 2, as math, not as two characters she formatted.
3. **A fraction.** She inserts `(a+b)/c` as a fraction. The numerator sits above a bar and the denominator below it.
4. **Edit.** She clicks the equation and changes `c` to `d`. The rest of the sentence is unchanged.
5. **From Word.** She opens a .docx that contains one equation. It is still an equation she can edit, and the compatibility note does not say equation layout is unsupported.
6. **Back to Word.** She exports .docx and the equation is an Office math equation, not a picture and not plain text.

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

The methods note shows a square and a fraction. Amara edits the denominator. The Word round trip still has an equation, not a sentence of recovered symbols.

## Gaps and notes

- Word import keeps equation text when it can and says editable layout is not supported.
- There is no Insert › Equation.
- A full equation toolbar is not required. Superscript and a stacked fraction are enough for this story.
- Do not rebuild citations, footnotes, or spelling.
