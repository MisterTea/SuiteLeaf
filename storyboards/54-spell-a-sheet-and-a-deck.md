# 54 · Spell a sheet and a deck

**Mode:** single-node · **App:** Sheets, Slides · **Video:** [videos/54-spell-a-sheet-and-a-deck.mp4](videos/54-spell-a-sheet-and-a-deck.mp4) · **Script:** [scenes/54-spell-a-sheet-and-a-deck.spec.ts](scenes/54-spell-a-sheet-and-a-deck.spec.ts)

## Who and why

Sam is finishing two files for the same meeting: a sheet of decisions and a short deck. Both say "recieve" where he meant "receive". Docs already underlines that and offers a correction. In Sheets and in Slides, Tools › Spelling does nothing.

## Inspired by

- Storyboard [34](34-count-words-and-check-spelling.md): Docs checks spelling on the device, suggests a word, and does not send the text off the computer.
- [Check your spelling in Google Sheets](https://support.google.com/docs/answer/57859): Tools › Spelling walks the cells. In Slides, Tools › Spelling does the same for text boxes.
- Tools › Spelling in `apps/web/src/App.tsx` is an empty handler for both a spreadsheet and a presentation.

## Scenes

1. **The sheet.** Sam opens "Decisions". Cell B2 says "We will recieve the grant". Nothing is underlined.
2. **Spell the sheet.** He chooses Tools › Spelling. The cell is selected, the suggestion "receive" is first, and one click replaces the word. The rest of the cell stays as it was.
3. **A name he wants.** Cell B3 says "Nkrumah spoke". He adds "Nkrumah" to the dictionary. The underline goes away. The same dictionary Docs uses already has that word if he added it there.
4. **The deck.** He opens "Update". A text box says "recieve the keys". Tools › Spelling offers "receive", and accepting it changes only that word, not the whole box.
5. **Offline.** With the network off, both files still suggest "receive". No request leaves the computer.
6. **Save.** He reopens both files. "receive" is saved, and "Nkrumah" is still not flagged.

## Google Workspace benchmark

In Google Sheets, Tools › Spelling opens a card, steps through cells, and changes one word at a time ([Docs Help](https://support.google.com/docs/answer/57859)). Slides uses the same menu. The dictionary is tied to the Google account, so a name added in Docs is known in Sheets. People complain that the card covers the cell it is correcting, and that spelling in Sheets is easy to miss because the cells are not underlined while you type.

## Better than Google Workspace when

1. Tools › Spelling in Sheets and in Slides starts a check. The menu item is not a no-op.
2. A misspelling in a cell or a text box can be replaced with one click, and the surrounding text is unchanged.
3. The suggestion list is the same dictionary Docs already uses, including words the user added there.
4. The check works with the network off and does not send the file's text anywhere.
5. In a slide, the replacement changes the misspelled word only, not every word in the box.
6. The corrected text and the personal dictionary survive save and reopen.

## Success looks like

"recieve" is "receive" in the sheet and in the deck. "Nkrumah" is not flagged. Sam did not leave either file to fix them.

## Gaps and notes

- Sheets and Slides Tools › Spelling call an empty handler. Docs spelling is already implemented.
- Reuse the Docs dictionary and suggestion list. Do not add a second word list.
- Do not rebuild grammar (storyboard 45), partial slide formatting (storyboard 46), or cell links (storyboard 53).
