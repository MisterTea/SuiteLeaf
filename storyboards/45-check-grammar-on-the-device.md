# 45 · Check grammar while you write

**Mode:** single-node · **App:** Docs · **Video:** [videos/45-check-grammar-on-the-device.mp4](videos/45-check-grammar-on-the-device.mp4) · **Script:** [scenes/45-check-grammar-on-the-device.spec.ts](scenes/45-check-grammar-on-the-device.spec.ts)

## Who and why

Amara is still on "Independence essay" (storyboard 34). Spelling already catches "movment" and leaves the name "Danquah" alone. She also writes "the movement were" and "its the reason", and she wants those flagged on this computer, with a suggestion she can accept or ignore, without the checker sending the essay anywhere and without it touching the bold she applied.

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
4. **A name is not grammar.** "Danquah" has no blue underline, and as a name it has no spelling underline either.
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
5. On a fixture document checked in with the tests, "the movement were" suggests "was", "its the reason" suggests "it's", "they was" suggests "were", and "Danquah" is not a grammar issue.
6. Accepting or ignoring a suggestion leaves bold, italic, and links on the surrounding text as they were.
7. With the network blocked, grammar still runs, and no request contains the document text.
8. Word count and spelling from storyboard 34 still pass on this essay: the same word count, and "movment" still a spelling issue.

## Success looks like

- The essay reads "the movement was", "it's the reason", "they were ready", and "They were late". She typed a second "they was", ignored it, restored it from Ignored grammar, and fixed it.
- With the network off, "They was next" is still underlined in blue. "movment" is still a spelling underline. "Danquah" has no underline at all. "movement" stayed bold, "strong" stayed italic, and Ghana stayed a link. The count still starts at 1,488 words, excluding References.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Grammar underlines differ from spelling and appear as you type | Met | Video 0:07: red wavy "movment", blue dotted "were", "its", and "was". Video 0:36: "They was next" gains a blue underline while she types. Browser test `grammar underlines a different way from spelling and leaves formatting alone` expects `text-decoration-style` dotted versus wavy. |
| 2. Right-click offers the suggestion first, then Ignore, and one click replaces only that word | Met | Video 0:07: menu on "were" shows "was", then Ignore. Video 0:10: the sentence is "the movement was" and bold "movement" is unchanged. The same browser test expects the first menuitem to be "was" and exactly two items. |
| 3. Tools › Grammar steps through grammar with Change and Ignore from the keyboard, and spelling stays separate | Met | Video 0:18: "1 of 1 · was → were", Change and Ignore. Enter makes "they were ready" (video 0:22). Video 0:22: Tools › Spelling shows "1 of 2 · movment → movement" and does not list "was". Browser test `ignored grammar comes back, stays in the file, and still runs offline` focuses Ignore and presses Enter. |
| 4. Tools › Ignored grammar lists skipped issues, and removing one restores the underline | Met | Video 0:30: the panel lists "they was → were" with Remove. The blue underline returns and she changes it to "They were late" (video 0:33). The browser test reloads, finds the phrase still ignored, and Remove puts the underline back. |
| 5. The fixture suggests was, it's, and were, and Danquah is not grammar | Met | `tests/doc-grammar.test.ts` "flags the closed set" and "keeps the independence essay's word count". Video 0:14: Danquah has no underline, neither grammar nor spelling. |
| 6. Accepting or ignoring leaves bold, italic, and links alone | Met | Video 0:10 and 0:36: "movement" is bold, "strong" is italic, Ghana is a link. The browser test checks `strong`, `em`, and the Ghana href after Change and after Ignore. |
| 7. Grammar still runs with the network blocked, and no request contains the document text | Met | Video 0:33–0:36: the caption says the network is off, and "They was next" is underlined. The scene test and the browser test collect requests and expect none to contain the essay's words. |
| 8. Storyboard 34's word count and "movment" still hold | Met | Video 0:05: "1,488 words (excludes References)". Video 0:36: "movment" is still a spelling underline; the count is 1,494 after the six words she typed. `tests/doc-grammar.test.ts` expects 1,612 / 318 / 1,488 and `misspelledWords` of `movment`, `Danquah`. `tests/doc-proofing.test.ts` still passes. |

## Gaps and notes

- Grammar is a closed on-device pass next to spelling: a singular noun after the/a/an plus "were" suggests "was"; they/we/these/those (and a few irregular plurals) plus "was" suggests "were"; "its" before a word that cannot follow a possessive, such as "the", suggests "it's". "its future", "the people were", "if it were", and names such as Danquah are not grammar issues.
- Ignored grammar is a list of phrases on the document (`they was → were`), separate from ignored spellings and from the personal dictionary. Removing a phrase brings every match back. Ignoring one "they was" hides every "they was" until that row is removed.
- The personal dictionary is unchanged. Sheet and slide Tools › Spelling are still empty items, so the old "Spelling" pending reason remains for those menus.
- There is no Accept all, and the panel does not explain the rule beyond the suggestion. A general grammar model is still out of scope.
