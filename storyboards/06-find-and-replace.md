# 06 · Fix a repeated typo with find and replace

**Mode:** single-node · **App:** Docs · **Video:** [videos/06-find-and-replace.mp4](videos/06-find-and-replace.mp4) · **Script:** [scenes/docs.spec.ts](scenes/docs.spec.ts)

## Who and why

Priya wrote a thank-you letter to the garden volunteers and spelled "receive" as "recieve" three times. She wants to check the first one, then fix the rest in one go, the cautious way Google Docs and Word guides recommend.

## Inspired by

- [Google Docs Help: find and replace](https://support.google.com/docs/answer/62754): Next and Prev step through matches, Replace changes one, Replace all changes every one.
- [ProofreadNow: find and replace in Word and Google Docs](https://www.proofreadnow.com/blog/how-to-use-find-and-replace-in-microsoft-word-and-google-docs): "Start slow; find and replace a single instance at a time until you're comfortable with the tool."
- [r/MicrosoftWord: how do you deal with repetitive work in Word?](https://www.reddit.com/r/MicrosoftWord/comments/1vywrpt/how_do_you_deal_with_repetitive_work_in_word/): an editor of 26 years says, "I use find and replace a LOT."
- Checkpoint 4 in [docs/docs-parity.md](../docs/docs-parity.md).

## Scenes

1. **Write the letter.** Priya types six short lines into a new document, "Thank-you letter", with "recieve" in three of them. The last one falls near the end of a long line.
2. **Open the tool.** **Edit → Find and replace** opens a dialog with Find, Replace with, and options for matching case, regular expressions (with a Help link) and ignoring diacritics.
3. **Find.** Typing "recieve" highlights all three. The counter reads "1 of 3", and the current match is darker and outlined.
4. **Replace one.** With "receive" in Replace with, **Replace** fixes the first and moves on. The counter reads "1 of 2".
5. **Step through.** **Next** shows "2 of 2". That match is at the end of a line, where the dialog was sitting, so the dialog steps aside below it, as Word's does. **Previous** goes back to "1 of 2".
6. **Move the dialog.** She drags the dialog by its title, as in Google Docs.
7. **Replace all.** **Replace all** fixes the other two. The counter reads "No results", and the dialog says "Replaced 2 instances of “recieve” with “receive”."
8. **Done.** She closes the dialog. All three read "receive", and the letter is saved.

## Success looks like

- No "recieve" left, three correct "receive".
- The current match was never hidden behind the dialog.
- The match counter tracked every step, Replace all said what it changed, and the letter autosaved.

## Also in the dialog

- Enter in Find goes to the next match and Shift+Enter to the previous one. Ctrl/Cmd+F with the dialog open selects the Find text again.
- Text selected in the document when the dialog opens fills Find, as in Google Docs and Word.
- When the cursor isn't on a match, the counter shows how many there are ("3 results") rather than "0 of 3".

## Gaps and notes

- Spellcheck works. The editor's text box has `spellcheck="true"`, and full Chromium underlines each "recieve" in red. The recording shows no underlines because Playwright's default headless shell has no spellchecker (a plain `<textarea>` gets none either). To show them, `playwright.storyboards.config.ts` would need `channel: "chromium"`. That setting applies to every storyboard, so it isn't changed here.
- The dialog opens over the right-hand end of the toolbar. It moves only when the current match would be hidden, not to uncover other text.
- With regular expressions on, the replacement is literal: `$1` group references aren't supported yet.
