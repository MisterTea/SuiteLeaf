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

## AI version

**Videos:** [videos/06-find-and-replace-ai.mp4](videos/06-find-and-replace-ai.mp4) (web, WebGPU) · [videos/electron/06-find-and-replace-ai.mp4](videos/electron/06-find-and-replace-ai.mp4) (desktop, llama.cpp) · **Script:** [scenes/ai/06-find-and-replace-ai.spec.ts](scenes/ai/06-find-and-replace-ai.spec.ts)

Priya types the same six-line letter, with "recieve" three times, into a new document called "Thank-you letter". Then she opens the assistant and asks:

> Could you check the spelling in my letter and fix any mistakes?

**Tools used:** `check_spelling`, which opens **Tools → Spelling and grammar** (the pointer goes to the Tools menu) and returns `"recieve" (3×): receive, relieve`. Then `find_and_replace` with `all: true`, which opens the Find and replace dialog with both fields filled, highlights the three matches ("1 of 3"), replaces them, shows "Replaced 3 instances…", and closes. Its result quotes each change and says `No "recieve" is left in the document`.

**What the recording shows:** the Spelling panel opens beside the page and lists "recieve 3×" with the suggestions receive and relieve. The dialog appears and the three highlighted matches are visible to its left. Then the panel switches to "No spelling mistakes found." Gemma replies in one sentence, for example "I have checked the spelling and corrected all instances of "recieve" to "receive" throughout the letter." The script checks that no "recieve" is left, that "receive" appears three times, that the other lines are unchanged, that the Spelling panel has nothing left to check, and that the letter saved ("Saved on this device" on the web, "Draft saved · choose Save As" on the desktop).

**How Gemma did:** 9 of 9 web runs and 2 of 2 desktop runs passed. That includes the last three web runs, done after the final fix, which all passed. It always picked the right two tools with the right arguments. In most runs it then made one unneeded `find_and_replace` call to check its work (once with `match_case: true` first, then false; once with a misspelled `"reciev"`), even though the first result said none were left. That call now returns "Nothing to replace: … already replaced" rather than an error. Once it ran `check_spelling` again to confirm. In the first recording, before the tool results said what was left, it repeated the replace until the loop guard stopped it, so it never replied.

**Fixed along the way:** `find_and_replace` now says where each change went and whether any matches are left. Not finding text that is already replaced is reported as done, not as an error. The spelling check's pointer goes to the Tools menu. With the AI panel and the Spelling panel both open, the outline hides and the Spelling panel narrows, so the page is about 75% size instead of about 40%. The page also fits beside the Spelling panel when the AI panel is closed, instead of running under it.

## Gaps and notes

- Spellcheck works: the editor's text box has `spellcheck="true"`, and the browser underlines each "recieve" in red. Recordings use full Chromium (`channel: "chromium"` in `playwright.storyboards.config.ts`) because Playwright's default headless shell has no spellchecker.
- The dialog opens over the right-hand end of the toolbar. It moves only when the current match would be hidden, not to uncover other text.
- With regular expressions on, the replacement is literal: `$1` group references aren't supported yet.
