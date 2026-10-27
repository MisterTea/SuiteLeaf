# 63 · Right-click a misspelling

**Mode:** single-node · **App:** Sheets · **Video:** [videos/63-right-click-a-misspelling.mp4](videos/63-right-click-a-misspelling.mp4) · **Script:** [scenes/63-right-click-a-misspelling.spec.ts](scenes/63-right-click-a-misspelling.spec.ts)

## Who and why

Sam already used Tools › Spelling to fix the decisions sheet (storyboard 54). While he is typing the next row he sees "recieve" underlined in the cell. In Docs he can right-click that word and pick "receive". In the sheet, the underline is only a hint. The correction still requires opening Tools › Spelling and stepping through every issue.

## Inspired by

- Storyboard [54](54-spell-a-sheet-and-a-deck.md): Sheets underlines a committed misspelling and Tools › Spelling replaces one word. The notes there say there is no right-click suggestion.
- Storyboard [34](34-count-words-and-check-spelling.md): Docs replaces a word from the right-click menu and can add it to the dictionary.
- [Check spelling in Google Sheets](https://support.google.com/docs/answer/57859): the spelling card steps through cells. People also expect the browser-style menu on the underlined word itself, which Sheets does not offer as clearly as Docs.

## Scenes

1. **The shared dictionary.** Sam opens "Handover". The names "Kwame" and "Danquah" are not underlined. "kenkey", "fufu", and "seperate" are. He right-clicks "kenkey", a dish, and chooses Add to dictionary. That underline goes away.
2. **The underline.** He opens "Decisions". "Ask Kwame for kenkey tomorrow" is not underlined. He types "Please recieve the keys" in B4. After he leaves the cell, only "recieve" is underlined.
3. **The menu.** He right-clicks the underlined word. A menu lists "receive" first, then Ignore and Add to dictionary. It opens beside the cell, and the word stays visible.
4. **Replace.** He clicks "receive". The cell becomes "Please receive the keys". Undo puts "recieve" back, and redo restores "receive".
5. **A word he keeps.** He right-clicks "fufu" in B5, "Danquah cooked fufu", and chooses Add to dictionary. The underline disappears. Tools › Spelling stops on "seperate", not on that cell.
6. **Ignore.** He right-clicks "seperate" and chooses Ignore. The word stays in the cell. The underline goes away. It is not added to the dictionary.
7. **Back in the document.** "fufu" is not flagged. "seperate" still is, because Ignore did not add it. "kenkey" is still clear.
8. **Save.** He reopens "Decisions". "receive" is saved, and "fufu" is still not underlined.

## Google Workspace benchmark

Google Sheets does not put a suggestion menu on the underlined word. Tools › Spelling opens a card and walks every issue ([Docs Help](https://support.google.com/docs/answer/57859)). Docs does offer the right-click menu. People fixing a sheet one cell at a time have to open the card, which covers the grid and makes them step through issues they already decided to leave.

## Better than Google Workspace when

1. Right-clicking an underlined word in a cell opens suggestions. The top item is the same suggestion Tools › Spelling would offer.
2. Choosing a suggestion replaces only that word. The rest of the cell stays. Undo restores the misspelling.
3. The menu does not cover the word it is correcting.
4. Add to dictionary uses the same personal dictionary as Docs. A word added in either place is not flagged in the other.
5. Ignore leaves the word in this cell and does not add it to the dictionary.
6. The correction and the dictionary survive save and reopen.
7. Right-clicking a correctly spelled word does not show spelling suggestions.

## Success looks like

Sam fixes "recieve" from the cell itself. He does not step through Tools › Spelling to make that change. "fufu" stays a word he chose, in this sheet and in a document. "kenkey", added in the document, was already known here.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Right-clicking an underlined word opens suggestions, and the top item matches Tools › Spelling | Met | Video 0:16, the menu's first item is "receive". Browser test `right-clicking a sheet misspelling suggests, replaces, ignores, and shares the Docs dictionary` opens Tools › Spelling first and expects "recieve → receive", then expects that same word as the menu's first item. |
| 2. A suggestion replaces only that word, and undo restores the misspelling | Met | Video 0:20, B4 reads "Please receive the keys". Video 0:21, undo puts "recieve" back and the underline returns. Video 0:22, redo restores "receive". The browser test checks the cell value at each step. |
| 3. The menu does not cover the word it is correcting | Met | Video 0:16, "Please recieve the keys" stays fully visible and the menu sits to the right of the cell. The browser test polls until the menu box does not overlap the word. |
| 4. Add to dictionary uses the same personal dictionary as Docs | Met | Video 0:04, Sam adds "kenkey" in the document. Video 0:08, the sheet does not underline it. Video 0:25, he adds "fufu" in the sheet. Video 0:34, the document no longer underlines "fufu". The browser test reads `suiteleaf.personal-dictionary` and expects both words. |
| 5. Ignore leaves the word in this cell and does not add it to the dictionary | Met | Video 0:31, B6 still says "seperate the copies" and the underline is gone. Video 0:34, the document still underlines "seperate". The browser test expects the cell text unchanged and the personal dictionary not to contain "seperate". |
| 6. The correction and the dictionary survive save and reopen | Met | Video 0:40, the reopened sheet shows "Please receive the keys", and "fufu" is not underlined. The browser test reopens the file and downloads the saved cell. |
| 7. Right-clicking a correctly spelled word does not show spelling suggestions | Met | Video 0:13, "Please" and "keys" are not underlined. The browser test right-clicks "keys" and expects no spelling menu. |

## Gaps and notes

- The right-click menu lives in the spelling module and reuses the Docs personal dictionary. There is no second word list.
- Tools › Spelling was left as it was. The recording opens it only to show that it skips "fufu".
- Ignore uses the same per-file word list as Tools › Spelling. Ignoring "seperate" clears it for this sheet, and the document still flags it.
- The underline appears after the cell is committed. A formula is still not rewritten.
- Right-clicking a correctly spelled word keeps the grid's own menu. Spelling suggestions are not added to it.
