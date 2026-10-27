# 54 · Spell a sheet and a deck

**Mode:** single-node · **App:** Sheets, Slides · **Video:** [videos/54-spell-a-sheet-and-a-deck.mp4](videos/54-spell-a-sheet-and-a-deck.mp4) · **Script:** [scenes/54-spell-a-sheet-and-a-deck.spec.ts](scenes/54-spell-a-sheet-and-a-deck.spec.ts)

## Who and why

Sam is finishing two files for the same meeting: a sheet of decisions and a short deck. Both say "recieve" where he meant "receive". Docs already underlines that and offers a correction. He wants the same check in the sheet and in the deck, without the card covering what he is fixing.

## Inspired by

- Storyboard [34](34-count-words-and-check-spelling.md): Docs checks spelling on the device, suggests a word, and does not send the text off the computer.
- [Check your spelling in Google Sheets](https://support.google.com/docs/answer/57859): Tools › Spelling walks the cells. In Slides, Tools › Spelling does the same for text boxes.
- Tools › Spelling in `apps/web/src/App.tsx` was an empty handler for both a spreadsheet and a presentation.

## Scenes

1. **The sheet.** Sam opens "Decisions". Cell B2 says "We will recieve the grant", and the misspelling is already underlined. "kenkey", a dish, in B3 is underlined too. The name "Danquah" beside it is not.
2. **Spell the sheet.** He chooses Tools › Spelling. A panel opens at the side, so B2 stays in view. The suggestion "receive" is first, and one click replaces only that word. The cell reads "We will receive the grant".
3. **A word he wants.** The check moves to B3, "Danquah cooked kenkey". There is no suggestion. He adds "kenkey" to the dictionary. The underline goes away. It is the same dictionary Docs uses.
4. **The deck.** He opens "Update". A text box says "recieve the keys", underlined. Tools › Spelling offers "receive", and accepting it leaves "the keys".
5. **Offline.** With the network off, he types "recieve" in an empty cell and in another text box. Both still suggest "receive". No request leaves the computer.
6. **Save.** He reopens both files. "receive" is saved, and "kenkey" is still not flagged.

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

"recieve" is "receive" in the sheet and in the deck. "kenkey" is not flagged. Sam did not leave either file to fix them.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Tools › Spelling in Sheets and in Slides starts a check | Met | Video 0:11, the sheet panel reads "1 of 2 · B2 · recieve → receive". Video 0:20, the slide panel offers receive. Browser test `sheet spelling replaces one word, shares the Docs dictionary, and works offline` and `slide spelling replaces one word and keeps the rest of the box`. |
| 2. One click replaces a misspelling, and the surrounding text is unchanged | Met | Video 0:13, B2 reads "We will receive the grant" while the panel is still open beside it. The browser test downloads the cell as that full sentence. |
| 3. Suggestions come from the Docs dictionary, including words added there | Met | Video 0:14, Add to dictionary clears "kenkey". Browser test `a word added in Docs is not flagged in a sheet` seeds `suiteleaf.personal-dictionary` and the sheet does not underline it. |
| 4. The check works with the network off and does not send the text anywhere | Met | Video 0:30–0:34, with the network off, a new "recieve" in the sheet and in the deck still offers "receive". Both browser tests record requests and expect none to contain the file's words. |
| 5. In a slide, only the misspelled word changes | Met | Video 0:22, the box reads "receive the keys". The slide browser test expects that string and that the box stays italic. |
| 6. The corrected text and the personal dictionary survive save and reopen | Met | Video 0:38, the reopened sheet shows "We will receive the grant" and "Danquah cooked kenkey" with no underline. Video 0:42, the deck still says "receive the keys". The sheet browser test reopens the file and expects no marks. |

## Gaps and notes

- Misspellings in sheet cells are underlined on the grid as soon as the file opens, and the spelling panel sits to the side of the cell instead of covering it.
- A formula is not rewritten. Spelling only changes plain text, so a formula that happens to display a typo stays a formula.
- Speaker notes are not checked. Text boxes are.
- The personal dictionary lives on this computer, in the same place Docs already uses. It is not inside the file.
- Grammar (storyboard 45), partial slide formatting (storyboard 46), and cell links (storyboard 53) are unchanged.
