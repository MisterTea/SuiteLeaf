# 34 · Count words and check spelling

**Mode:** single-node · **App:** Docs · **Video:** [videos/34-count-words-and-check-spelling.mp4](videos/34-count-words-and-check-spelling.mp4) · **Script:** [scenes/34-count-words-and-check-spelling.spec.ts](scenes/34-count-words-and-check-spelling.spec.ts)

## Who and why

Amara is finishing a 1,500-word history essay. The limit excludes the reference list, and she needs to know how long her introduction is on its own. She types fast, and her essay is full of names the dictionary doesn't know ("Nkrumah", "Ghana's"). She wants to fix real typos quickly without wading through false alarms, and without the checker forgetting her choices.

## Inspired by

- WF-A1-12 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): "check word count… Word count updates live".
- [Docs Editors Help: Count the words in a document](https://support.google.com/docs/answer/39003): Tools › Word count, "Display word count while typing", and a count that excludes headers, footers, and footnotes unless selected.
- [University of Liverpool: managing word counts in Word and Google Docs](https://www.liverpool.ac.uk/media/livacuk/centre-for-innovation-in-education/diy-guides/mge-wordcount-word-googledoc-turnitin-speedgrader/manage-word-counts-msword-google-docs-turnitin-speedgrader.pdf): the live counter "will have disappeared" when the document is reopened, there's no option to exclude parts of the text, and reference lists are counted.
- [Docs Editors Help: Check your spelling & grammar](https://support.google.com/docs/answer/57859): suggestions, Ignore, Accept all, and the personal dictionary.
- [Docs Editors Community: undo ignoring spelling suggestions](https://support.google.com/docs/thread/278999262/how-do-we-undo-the-ignoring-of-spelling-and-grammar-suggestions?hl=en): ignored suggestions can't be brought back.
- [r/writing: Google Docs' spellchecker is "pretty dumb sometimes"](https://www.reddit.com/r/writing/comments/4dp0ov/has_anyone_else_noticed_that_google_docs/): it misses "wer", and there's "no way for me to tell Google Docs to mark it wrong".

## Scenes

1. **Open the essay.** Amara opens "Independence essay". The status bar shows "1,612 words".
2. **Count a selection.** She selects the introduction. The status bar changes to "318 of 1,612 words" while the selection lasts.
3. **Word count details.** She opens Tools › Word count (Cmd/Ctrl+Shift+C). A dialog lists words, characters, characters without spaces, paragraphs, and pages, for the selection and for the whole document.
4. **Exclude the references.** In the dialog she ticks "Stop counting at heading: References". The document total drops to 1,488. She leaves "Count footnotes" unticked. The status bar now reads "1,488 words (excludes References)", and that setting is saved with the essay.
5. **Spelling as she types.** She types "the movment grew" and "movment" is underlined. Right-clicking shows "movement" first, then "Add to dictionary" and "Ignore". Clicking "movement" fixes it.
6. **Teach it names.** She right-clicks "Nkrumah" and chooses Add to dictionary. Every other "Nkrumah" in the essay loses its underline.
7. **Check the whole essay.** Tools › Spelling opens a panel that steps through issues one by one: "2 of 5 · "recieve" → "receive"", with **Change**, **Ignore**, and **Add to dictionary**. She works through them with Enter.
8. **Change her mind.** Tools › Personal dictionary lists "Nkrumah". She'd accidentally added "teh" too, so she removes it, and "teh" is underlined again.
9. **Offline.** All of this works on the train with no connection.

## Google Workspace benchmark

In Google Docs, the word count is 2 clicks (Tools › Word count) or Cmd/Ctrl+Shift+C. With text selected, it shows "318 of 1,612 words". The live counter needs Tools › Word count › "Display word count while typing" › OK (3 clicks) and must be turned on again every time the document is reopened ([Liverpool guide](https://www.liverpool.ac.uk/media/livacuk/centre-for-innovation-in-education/diy-guides/mge-wordcount-word-googledoc-turnitin-speedgrader/manage-word-counts-msword-google-docs-turnitin-speedgrader.pdf)). Spelling is underlined as you type, with suggestions on right-click. A full check is Tools › Spelling and grammar › Spelling and grammar check (3 clicks) or Cmd/Ctrl+Alt+X ([Docs Help](https://support.google.com/docs/answer/57859)).

Known pain points:

- The live counter doesn't stay on.
- There's no way to exclude a section such as references. Footnotes are always excluded unless selected ([Docs Help](https://support.google.com/docs/answer/39003), [Liverpool guide](https://www.liverpool.ac.uk/media/livacuk/centre-for-innovation-in-education/diy-guides/mge-wordcount-word-googledoc-turnitin-speedgrader/manage-word-counts-msword-google-docs-turnitin-speedgrader.pdf)).
- Ignored suggestions can't be undone ([Docs Community](https://support.google.com/docs/thread/278999262/how-do-we-undo-the-ignoring-of-spelling-and-grammar-suggestions?hl=en)).
- Real typos that happen to be rare words can't be marked as wrong ([r/writing](https://www.reddit.com/r/writing/comments/4dp0ov/has_anyone_else_noticed_that_google_docs/)).

## Better than Google Workspace when

1. The status bar word count is on by default, and if it's hidden it stays hidden after reopening (or stays shown, whichever the user chose).
2. Selecting text changes the status bar to "N of M words" within 200 ms, with no dialog needed.
3. Tools › Word count and Cmd/Ctrl+Shift+C open a dialog with words, characters, characters without spaces, paragraphs, and pages, for both the selection and the document.
4. The dialog can include or exclude footnotes and stop counting at a chosen heading. The choice is saved in the file, and the status bar says what's excluded.
5. On a fixture document checked in with the tests, the word count equals Microsoft Word's count for the same .docx.
6. Right-clicking a misspelled word offers suggestions, Add to dictionary, and Ignore, and one click on a suggestion replaces the word.
7. Tools › Spelling steps through every issue with Change, Ignore, and Add to dictionary, all usable from the keyboard. Words added or ignored can be reviewed and removed in Tools › Personal dictionary, which makes them flagged again.
8. Spelling and word count work with the network blocked and send no document text off the device.
9. Tools › Spelling never changes the document's formatting.

## Success looks like

- The essay reads "1,488 words (excludes References)", and the introduction's length was checked from a selection.
- The essay has no unknown words left, "Nkrumah" is in the personal dictionary, and "teh" isn't.

## Gaps and notes

- **Tools › "Spelling and grammar" clears formatting.** Its `onSelect` calls `docActions.clearFormatting()`, so choosing it strips bold, italics, and links from the selection. It should either open a spelling check or be removed until one exists.
- **A live count exists, but only for the whole document.** The status bar shows "N words · P pages · English", counting whitespace-separated words in all editor text. There's no selection count, no Word count dialog, no Cmd/Ctrl+Shift+C, and no exclusions. Tiptap's `CharacterCount` extension is loaded, but nothing shows character counts.
- **Spelling is the browser's.** The editor sets `spellcheck="true"`, so underlines, suggestions, the dictionary, and the language come from the browser (and differ between Chrome, Firefox, Safari, and the desktop app). There's no in-app suggestion menu, spelling panel, or personal dictionary, and "English" in the status bar is a fixed label.
- Footnotes don't exist yet (storyboard [35](35-add-a-table-of-contents-and-footnotes.md)), so "Count footnotes" depends on that work.
