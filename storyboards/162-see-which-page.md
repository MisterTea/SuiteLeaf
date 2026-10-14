# See which page

Who: Nia is writing minutes that run onto a second page. She wants the status bar to say she is on page 2 while her caret is there, next to the word count, without scrolling back to look at the page corner.

Inspired by: Google Docs' status bar, which shows the page at the top of the window. If she is editing the bottom of page 1 while the window is scrolled onto page 2, the status bar can disagree with the caret.

## Scenes

1. Nia opens a new document and types "Apples were four dollars." The status bar says Page 1 of 1, next to the word count. She does not open a dialog.
2. She inserts a page break and types "Pears were ten." on the second page. With the caret in that sentence, the status bar says Page 2 of 2. The word count still includes both sentences.
3. She moves the caret back to "Apples". The status bar says Page 1 of 2. The words on both pages stay.
4. She saves, returns home, and reopens, and puts the caret in "Pears were ten." The status bar says Page 2 of 2.
5. She downloads Word. The file contains both sentences and the page break. It does not contain the label "Page 2 of 2".

## Google Workspace benchmark

- Docs shows a page in the status bar, but it follows the scroll position, not the caret.
- The page number in the corner of the page is a different control from the status bar, and they can disagree.
- Seeing both the page and the word count means looking at two places.

## Better than Google Workspace when

1. The status bar says Page 1 of 1 on a one-page document, beside the word and character counts. There is no dialog.
2. With the caret on the second page, it says Page 2 of 2. The word count still counts both pages.
3. Moving the caret back to the first page says Page 1 of 2, even if the window is still scrolled to the second page.
4. The label follows the caret, not the top of the window.
5. The words and the page break do not change.
6. Save and reopen keep the same label for the caret's page.
7. The downloaded Word file does not contain "Page 2 of 2". The status text is not a paragraph.

## Success

- Nia looks at the status bar and knows the caret is on page 2 of 2.

## Gaps

- The status bar shows the word count and a total such as "2 pages". It does not say which page the caret is on.
- `pageCount` in `Docs.tsx` is the total. Nothing in the status bar reads the caret's page.
