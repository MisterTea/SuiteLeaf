# Paint the format

Who: Nia styled the word "Market" as bold, 18 pt, and blue. The next sentence, "Apples were 4 dollars," is plain. She wants that sentence to look like "Market" without retyping it and without changing the words.

Inspired by: Google Docs' paint format brush. One click arms a sticky brush, and the next click anywhere picks up that formatting, including a click you did not mean. The toolbar icon does not say which words it copied.

## Scenes

1. Nia opens a document. "Market" is bold, 18 pt, and blue. "Apples were 4 dollars." is plain body text.
2. She selects "Market" and chooses Copy format, beside Bold. The button then reads Apply format. Nothing else in the document changes.
3. She selects "Apples were 4 dollars." and chooses Apply format. Those words become bold, 18 pt, and blue. The letters stay "Apples were 4 dollars."
4. "Market" is still bold, 18 pt, and blue. The paragraph after the sentence stays plain.
5. With nothing copied, Apply format is not offered. Copy format on a plain word, then Apply format on another plain word, leaves both plain.
6. She saves, returns home, and reopens. The sentence is still bold, 18 pt, and blue, and the words are unchanged.
7. She downloads Word. The sentence is bold, 18 pt, and blue. "Market" is still styled the same way.

## Google Workspace benchmark

- Docs copies formatting with a paint brush that stays armed until the next click.
- The brush does not say which formatting it is holding.
- A click in the wrong place paints that place, and there is no separate Apply step to undo the arming without painting.

## Better than Google Workspace when

1. Copy format and Apply format are two named steps beside Bold. There is no sticky brush and no dialog.
2. After Copy format on "Market", the control reads Apply format, so the next click is a choice rather than an accident.
3. Apply format makes the selected sentence bold, 18 pt, and blue, and does not change its letters.
4. "Market" stays styled. Text outside the selection stays plain.
5. Apply format is unavailable until a format has been copied. Copying a plain word does not invent bold, size, or color.
6. Save and reopen keep the painted bold, size, and color on those words.
7. The downloaded Word file has bold, 18 pt, and blue on the sentence, and the same marks on "Market".

## Success

- Nia makes the sentence look like "Market" in two named steps, and the words stay put.

## Gaps

- Docs can toggle bold, set a font size, and set a color from the toolbar in `apps/web/src/editors/Docs.tsx`. Nothing copies those marks from one selection onto another.
- A search for paint format in `apps/web` finds no match.
