# 64 · Change every copy of a typo

**Mode:** single-node · **App:** Sheets · **Video:** [videos/64-change-every-copy-of-a-typo.mp4](videos/64-change-every-copy-of-a-typo.mp4) · **Script:** [scenes/64-change-every-copy-of-a-typo.spec.ts](scenes/64-change-every-copy-of-a-typo.spec.ts)

## Who and why

Sam's decisions sheet says "recieve" in four cells. Right-click fixes one cell (storyboard 63). Tools › Spelling then walks the other three one at a time. He wants one action that fixes every copy, and a way to leave a cell that used the word on purpose.

## Inspired by

- Storyboards [54](54-spell-a-sheet-and-a-deck.md) and [63](63-right-click-a-misspelling.md): the sheet underlines a committed misspelling and can replace one word.
- [Check spelling in Google Sheets](https://support.google.com/docs/answer/57859): the spelling card has Change and Change all. People lose track of which cells Change all touched, because the card does not list them first.

## Scenes

1. **Four cells.** Sam opens "Decisions". B2, B4, B7, and B9 contain "recieve". B6 contains "seperate", which he wants to keep.
2. **The menu.** He right-clicks "recieve" in B2. Besides "receive", the menu has "Change all to receive".
3. **A preview.** Choosing Change all lists the four cells and does not change them yet. B6 is not in the list.
4. **Apply.** He confirms. All four cells say "receive". One Undo restores all four. Redo fixes them again.
5. **Leave one.** He changes B9 back to "recieve" and chooses Ignore on that cell. Change all, run again from B2, fixes the others and leaves B9.
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

## Gaps and notes

- Right-click and Tools › Spelling replace one word. There is no Change all.
- Reuse the existing spelling finder. Do not add a second dictionary.
- Do not rebuild right-click for a single word, grammar, or letterhead import.
