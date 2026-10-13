# 68 · Change every copy in a sheet

**Mode:** single-node · **App:** Sheets · **Video:** [videos/68-change-every-copy-in-a-sheet.mp4](videos/68-change-every-copy-in-a-sheet.mp4) · **Script:** [scenes/68-change-every-copy-in-a-sheet.spec.ts](scenes/68-change-every-copy-in-a-sheet.spec.ts)

## Who and why

Sam's decisions sheet says "recieve" in four cells. Right-click fixes one cell (storyboard 63). Tools › Spelling then walks the other three one at a time. He wants one action that fixes every copy, and a way to leave a cell that used the word on purpose.

## Inspired by

- Storyboards [54](54-spell-a-sheet-and-a-deck.md) and [63](63-right-click-a-misspelling.md): the sheet underlines a committed misspelling and can replace one word.
- [Check spelling in Google Sheets](https://support.google.com/docs/answer/57859): the spelling card has Change and Change all. People lose track of which cells Change all touched, because the card does not list them first.

## Scenes

1. **Four cells.** Sam opens "Decisions". B2, B4, B7, and B9 contain "recieve". B6 contains "seperate", which he wants to keep.
2. **The menu.** He right-clicks "recieve" in B2. Besides "receive", the menu has "Change all to receive".
3. **A preview.** Choosing Change all highlights and lists the four cells. B6 is not in the list. He cancels, and the cells stay "recieve".
4. **Apply.** Tools › Spelling has the same Change all. He confirms. All four cells say "receive", and the check moves on to "seperate". One Undo restores all four. Redo fixes them again.
5. **Leave one.** He undoes that, then chooses Ignore this cell on B9. The other copies stay underlined. Change all from B2 lists the other three, fixes them, and leaves B9.
6. **Save.** He reopens the file. The three corrections remain, and B9 is still "recieve" and not underlined.

## Google Workspace benchmark

Google Sheets' spelling card offers Change and Change all ([Docs Help](https://support.google.com/docs/answer/57859)). Change all applies immediately. It does not show the cells first, and Undo is one cell at a time if you notice a mistake after.

## Better than Google Workspace when

1. Change all is on the right-click menu and in Tools › Spelling.
2. Before anything changes, the user sees how many cells will change and can cancel.
3. Only the same misspelling is changed. A different typo, and a cell the user ignored, stay as they are.
4. Confirming is one undo step that restores every cell Change all edited.
5. The corrections survive save and reopen.
6. A cell ignored for this word is not included in a later Change all of that word.

## Success looks like

Sam fixes three "recieve" cells in one step and keeps the one he ignored. He can see the list before it happens, and one Undo undoes the whole change.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Change all is on the right-click menu and in Tools › Spelling | Met | Video 0:09, the menu shows "receive" and "Change all to receive". Video 0:20, Tools › Spelling shows Change all beside Change. |
| 2. Before anything changes, the user sees how many cells will change and can cancel | Met | Video 0:14, "4 cells will change", with the cells highlighted. He cancels and B2 still says "recieve". Browser test `change all previews the same misspelling, undoes in one step, and skips an ignored cell`. |
| 3. Only the same misspelling is changed. A different typo, and a cell the user ignored, stay as they are | Met | Video 0:20, B6 still says "seperate" and the spelling check moves to it. Video 0:36, the second preview lists B2, B4, and B7 only. |
| 4. Confirming is one undo step that restores every cell Change all edited | Met | Video 0:26, one Undo brings "recieve" back in B2, B4, B7, and B9 together. The browser test checks all four cells after a single Undo. |
| 5. The corrections survive save and reopen | Met | Video 0:45, the reopened sheet still has "receive" in B2, B4, and B7. |
| 6. A cell ignored for this word is not included in a later Change all of that word | Met | Video 0:32, B9 is no longer underlined while the other copies are. Video 0:36, B9 is absent from the list. Video 0:45, B9 is still "recieve" and not underlined. |

## Gaps and notes

- Ignore this cell is remembered on this computer, in the same place as the personal dictionary. It is not stored inside the file, so another computer would underline that cell again.
- Change all uses the first suggestion. Replacing one cell with a later suggestion is still the single-word action from storyboard 63.
- A formula is still not rewritten. Spelling only changes plain text.
- Word-level Ignore still skips that word everywhere in the file. Ignore this cell is the way to leave one copy.
