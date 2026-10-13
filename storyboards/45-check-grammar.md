# 45 · Check grammar while you write

**Mode:** single-node · **App:** Docs · **Video:** [videos/45-check-grammar.mp4](videos/45-check-grammar.mp4) · **Script:** [scenes/45-check-grammar.spec.ts](scenes/45-check-grammar.spec.ts)

## Who and why

Amara is still on "Independence essay" (storyboard 34). Spelling already catches "movment" and has learned "Nkrumah". She also writes "the movement were" and "its the reason", and she wants those flagged on this computer, with a suggestion she can accept or ignore, without the checker sending the essay anywhere and without it touching the bold she applied.

## Inspired by

- WF-A1-12 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): proofing while writing.
- Storyboard [34](34-count-words-and-check-spelling.md): spelling, the personal dictionary, and Tools › Spelling already run on the device.
- [Check your spelling & grammar in Google Docs](https://support.google.com/docs/answer/57859): red underlines for spelling, blue for grammar, Tools › Spelling and grammar.
- [Docs Editors Community: undo ignoring spelling and grammar](https://support.google.com/docs/thread/278999262/how-do-we-undo-the-ignoring-of-spelling-and-grammar-suggestions): an ignored suggestion cannot be brought back.
- [Workspace Updates: spelling and grammar in Docs](https://workspaceupdates.googleblog.com/2019/02/spelling-grammar-improvements.html): grammar is a blue underline, and the suggestions are produced for the text in the document.

## Scenes

1. **Open the essay.** Amara opens "Independence essay". The status bar still shows the word count from storyboard 34. "movment" is underlined as a spelling error. "the movement were" and "its the reason" are underlined in blue, a different line from the spelling underline.
2. **Fix one from the menu.** She right-clicks "were". "was" is the first item, then Ignore. Clicking "was" replaces that word. The sentence is "the movement was". The bold on a nearby word is unchanged.
3. **its / it's.** She right-clicks "its" in "its the reason" and chooses "it's". The sentence reads "it's the reason".
4. **A name is not grammar.** "Nkrumah" has no blue underline. If it is not in her dictionary it still has only the spelling underline from storyboard 34.
5. **Step through grammar.** "they was ready" is still underlined. Tools › Grammar shows "1 of 1 · was → were", with Change and Ignore. Enter changes it to "they were ready". Tools › Spelling still lists "movment" and does not list "was".
6. **Change her mind.** She ignores a second "they was", then opens Tools › Ignored grammar, removes it, and the blue underline comes back. She changes it to "were".
7. **Offline.** The network is off. Another "they was" is underlined in blue. No request carries the essay's words.

## Google Workspace benchmark

Google Docs underlines spelling in red and grammar in blue as you type. A full pass is Tools › Spelling and grammar › Spelling and grammar check, or the toolbar button ([Docs Help](https://support.google.com/docs/answer/57859)). Accepting a suggestion is Tab, or a click on the suggestion. Ignore is on the same menu.

Known pain points:

- Spelling and grammar are one checker, so a grammar pass is hard to separate from spelling, and Ignore applies to both.
- An ignored suggestion cannot be restored ([Docs Community](https://support.google.com/docs/thread/278999262/how-do-we-undo-the-ignoring-of-spelling-and-grammar-suggestions)).
- The suggestions are computed from the document text on Google's side ([Workspace Updates](https://workspaceupdates.googleblog.com/2019/02/spelling-grammar-improvements.html)). A machine with no network gets no new grammar marks.

## Better than Google Workspace when

1. Grammar underlines are a different style from spelling underlines, and they appear as you type.
2. Right-clicking a grammar issue offers the suggestion first and Ignore. One click on the suggestion replaces only that phrase.
3. Tools › Grammar steps through grammar issues with Change and Ignore, both usable from the keyboard, and does not include spelling issues. Tools › Spelling does not include grammar issues.
4. Ignored grammar issues are listed in Tools › Ignored grammar. Removing one puts its underline back.
5. On a fixture document checked in with the tests, "the movement were" suggests "was", "its the reason" suggests "it's", "they was" suggests "were", and "Nkrumah" is not a grammar issue.
6. Accepting or ignoring a suggestion leaves bold, italic, and links on the surrounding text as they were.
7. With the network blocked, grammar still runs, and no request contains the document text.
8. Word count and spelling from storyboard 34 still pass on this essay: the same word count, and "movment" still a spelling issue.

## Success looks like

- The essay reads "the movement was", "it's the reason", and "they were ready". The ignored "they was" is corrected after she restores it from Ignored grammar.
- "Nkrumah" is not marked as grammar. Bold text stayed bold. Nothing left the computer.

## Gaps and notes

- `doc-spelling.ts` underlines misspellings, suggests replacements, and stores the personal dictionary on this device. There is no grammar pass and no second underline.
- The Tools item is Spelling (storyboard 34). `commands.ts` still has a leftover "Spelling and grammar" pending reason from before spelling shipped; the menu does not run a grammar check.
- This story is a closed set of issues the fixture can assert: subject-verb agreement of the kind "were" / "was", and "its" before a verb where "it's" is required. A general grammar model is not required.
- Ignored spellings already live in the file (storyboard 34). Ignored grammar should be stored the same way so it survives reopen, and should be removable.
