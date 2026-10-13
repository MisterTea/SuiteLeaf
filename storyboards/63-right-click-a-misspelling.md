# 63 · Right-click a misspelling

**Mode:** single-node · **App:** Sheets · **Video:** [videos/63-right-click-a-misspelling.mp4](videos/63-right-click-a-misspelling.mp4) · **Script:** [scenes/63-right-click-a-misspelling.spec.ts](scenes/63-right-click-a-misspelling.spec.ts)

## Who and why

Sam already used Tools › Spelling to fix the decisions sheet (storyboard 54). While he is typing the next row he sees "recieve" underlined in the cell. In Docs he can right-click that word and pick "receive". In the sheet, the underline is only a hint. The correction still requires opening Tools › Spelling and stepping through every issue.

## Inspired by

- Storyboard [54](54-spell-a-sheet-and-a-deck.md): Sheets underlines a committed misspelling and Tools › Spelling replaces one word. The notes there say there is no right-click suggestion.
- Storyboard [34](34-count-words-and-check-spelling.md): Docs replaces a word from the right-click menu and can add it to the dictionary.
- [Check spelling in Google Sheets](https://support.google.com/docs/answer/57859): the spelling card steps through cells. People also expect the browser-style menu on the underlined word itself, which Sheets does not offer as clearly as Docs.

## Scenes

1. **The underline.** Sam opens "Decisions". B4 says "Please recieve the keys". After he leaves the cell, "recieve" is underlined. The rest of the sentence is not.
2. **The menu.** He right-clicks the underlined word. A menu lists "receive" first, then Ignore and Add to dictionary. It opens next to the cell, not over the word.
3. **Replace.** He clicks "receive". The cell becomes "Please receive the keys". The underline is gone. Undo puts "recieve" back.
4. **A name.** He right-clicks "Nkrumah" in B5 and chooses Add to dictionary. The underline disappears. Tools › Spelling no longer stops on that cell.
5. **The shared dictionary.** The word he added in Docs is already in this menu's dictionary, and the word he adds here is not flagged when he later opens a document.
6. **Save.** He reopens the file. "receive" is saved, and "Nkrumah" is still not underlined.

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

Sam fixes "recieve" from the cell itself. He does not open Tools › Spelling. "Nkrumah" stays a name he chose, in this sheet and in a document.

## Gaps and notes

- Tools › Spelling and the underline already exist. There is no context menu on the underlined word.
- Reuse the Docs dictionary. Do not add a second word list.
- Do not rebuild Tools › Spelling, grammar, or cell links.
