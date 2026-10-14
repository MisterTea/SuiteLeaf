# Keep the zoom

Who: Nia edits the minutes at 150% so she can read them. She leaves and comes back. The page should still be at 150%. A new document should not open at 150% just because the minutes did.

Inspired by: Google Docs remembers a zoom, but it is one zoom for the account. Opening a different document keeps the last zoom, which is often too large or too small for that file.

## Scenes

1. Nia opens the minutes. The zoom control says 100% or Fit. She chooses 150%. The page is larger, and the status bar still shows the word count and the page.
2. She saves, returns home, and reopens the minutes. The zoom control says 150%, and the page is still large.
3. She creates a new document. Its zoom is 100% or Fit, not 150%.
4. She returns to the minutes. They are still at 150%.
5. She downloads the minutes as Word. The file contains the sentences and does not contain "150%".

## Google Workspace benchmark

- Docs has a zoom menu, and the last zoom sticks to the browser rather than to the file.
- Opening a short note after a poster can leave the note at 200%.
- Nothing next to the word count says which file the zoom belongs to. The menu is the only place.

## Better than Google Workspace when

1. Choosing 150% enlarges that document's page. The word count and the page label stay visible.
2. Save and reopen of that same document restores 150%.
3. A different document keeps its own zoom. A new document does not open at 150%.
4. Returning to the minutes shows 150% again.
5. Fit still fits the window for a document that was left on Fit.
6. The zoom is not written into the document text.
7. The downloaded Word file does not contain "150%".

## Success

- Nia comes back to the minutes and they are still at 150%, and a new document is not.

## Gaps

- `zoomLevel` in `Docs.tsx` is React state that starts at Fit or 100%. Leaving the document forgets it.
- Nothing stores a zoom per file.
