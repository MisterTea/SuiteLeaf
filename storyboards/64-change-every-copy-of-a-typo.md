# 64 · Change every copy of a typo

**Mode:** single-node · **App:** Docs · **Video:** [videos/64-change-every-copy-of-a-typo.mp4](videos/64-change-every-copy-of-a-typo.mp4) · **Script:** [scenes/64-change-every-copy-of-a-typo.spec.ts](scenes/64-change-every-copy-of-a-typo.spec.ts)

## Who and why

Sam's launch notes say "recieve" four times. One of those words is bold. Another sentence says "seperate", which he wants to keep. Tools › Spelling would walk the four copies one by one, and Find and replace is a separate pass that does not know which words are misspelled. He wants one action, from the spelling suggestion, that fixes every copy, shows him the list first, and undoes as a single step.

## Inspired by

- Storyboard [34](34-count-words-and-check-spelling.md): Docs already underlines a misspelling and can replace one word, ignore a word, or add it to the dictionary.
- Storyboard [06](06-find-and-replace.md): Find and replace can change every "recieve", but it is a second tool and it matches text, not spelling.
- [Check spelling in Google Docs](https://support.google.com/docs/answer/57859): the spelling card can change a suggestion. People lose track of which copies a bulk change touched, because the card does not list them first.

## Scenes

1. **Four copies.** Sam opens "Launch notes". Four sentences contain "recieve". The first one is bold. One sentence contains "seperate", which he wants to keep.
2. **The menu.** He right-clicks a "recieve". Besides "receive", the menu has "Change all to receive".
3. **A preview.** Choosing Change all lists the four copies and does not change them yet. "seperate" is not in the list. He cancels. The notes are unchanged.
4. **Apply.** He confirms. All four say "receive", and the first one is still bold. One Undo restores all four. Redo fixes them again.
5. **Leave one.** He undoes so the typos are back, then chooses Ignore this one on the last "recieve". That copy stays and loses its underline. Tools › Spelling › Change all lists the other three, not the ignored copy and not "seperate". He confirms.
6. **Save.** He reopens the file. The three corrections remain. The ignored "recieve" is still there and not underlined. "seperate" is still underlined.

## Google Workspace benchmark

Google Docs underlines spelling and offers a suggestion on right-click. A full check steps through issues one at a time. Changing every copy means Find and replace, which applies as soon as you choose Replace all and does not tell you it is only the misspelling. Undo of a bulk text replace is one step, but it is not tied to the spelling suggestion, and an occurrence you wanted to keep is easy to overwrite.

## Better than Google Workspace when

1. Change all is on the right-click spelling menu and in Tools › Spelling.
2. Before anything changes, the user sees how many copies will change and can cancel.
3. Only the same misspelling is changed. A different typo, and a copy the user ignored, stay as they are.
4. Confirming is one undo step that restores every copy Change all edited.
5. The corrections survive save and reopen.
6. A copy ignored for this word is not included in a later Change all of that word.
7. Bold on a corrected word stays bold. Find and replace still changes text on its own.

## Success looks like

Sam fixes three "recieve" copies in one step and keeps the one he ignored. He can see the list before it happens, and one Undo undoes the whole change. The bold word is still bold.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Change all is on the right-click menu and in Tools › Spelling | Met | Video: right-click shows "Change all to receive"; Tools › Spelling shows Change all. |
| 2. Before anything changes, the user sees how many copies will change and can cancel | Met | Video: the preview says "4 copies" and Cancel leaves the notes unchanged. Browser test `change all lists every copy, cancels, and undoes in one step`. |
| 3. Only the same misspelling is changed. A different typo, and an ignored copy, stay | Met | Video: "seperate" stays underlined; the ignored "recieve" stays. Vitest `leaves an ignored copy out of a later change all`. |
| 4. Confirming is one undo step that restores every copy | Met | Video: one Undo restores all four, then later one Undo restores the three. Vitest `replaces every copy in one undo step and keeps bold`. |
| 5. The corrections survive save and reopen | Met | Video: after reopen, three "receive" remain and the ignored copy is still "recieve". Browser test reopens the file. |
| 6. A copy ignored for this word is not included in a later Change all | Met | Video: the second preview lists 3 copies. Vitest expects three replacements and one remaining "recieve". |
| 7. Bold stays, and Find and replace still works | Met | Video: the first "receive" is still bold. Browser test `find and replace still replaces every match in one undo`. |

## Gaps and notes

- This pass is Docs. Sheet right-click spelling and letterhead headers are other storyboards and are not built here.
- Ignore still ignores the word everywhere, as in storyboard 34. Ignore this one keeps a single copy, stored as a mark in the file, so the others can still be corrected.
- Right-click Change all uses the first suggestion. A different correction for every copy is chosen in Tools › Spelling, which previews that correction before it edits.
- Grammar, sheet cells, and slide text boxes are unchanged.
