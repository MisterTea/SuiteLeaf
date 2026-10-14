# See the word count

Who: Nia is writing the market minutes and needs to stay under 50 words. She wants the count on the page while she types, and she wants a selection to say how many of those words she has highlighted.

Inspired by: Google Docs' Tools › Word count, a dialog. "Display word count while typing" is a checkbox inside that dialog, and the selection count only appears after you open it again.

## Scenes

1. Nia opens a new document. The corner already says 0 words. She types "Apples were four dollars." The corner says 4 words. She does not open a dialog.
2. She adds "Pears were ten." The corner says 7 words.
3. She selects "four dollars". The corner says 2 of 7 words. The rest of the sentence stays.
4. She clicks away. The corner says 7 words again.
5. She saves, returns home, and reopens. The corner still says 7 words. She downloads Word. The file contains the sentences and does not contain the words "7 words".

## Google Workspace benchmark

- Docs hides the count in Tools › Word count.
- The live count is off until you open the dialog and check a box.
- A selection's count is easy to miss because it replaces the document count inside the dialog.

## Better than Google Workspace when

1. The count is visible while she types. There is no dialog and no checkbox.
2. Typing a word updates the count immediately. "Apples were four dollars." is 4 words.
3. A selection says how many words are selected and the document total, as "2 of 7 words". Clicking away returns to the document total.
4. An empty paragraph does not add a word. A number such as 10 counts as one word.
5. Words in a table cell count. The header and the body both count.
6. Save and reopen show the same count. The count is not stored as a paragraph in the document.
7. The downloaded Word file contains the minutes and does not contain the label "7 words". Command search for word count shows the same live count, not a message that SuiteLeaf lacks it.

## Success

- Nia watches the count go from 0 to 7 as she types, and a selection says 2 of 7.

## Gaps

- `apps/web/src/commands.ts` lists word count with the reason "SuiteLeaf doesn't have word count yet."
- The document editor has no live word count on the page.
