# 46 · Bold one word in a slide

**Mode:** single-node · **App:** Slides · **Video:** [videos/46-format-one-word-on-a-slide.mp4](videos/46-format-one-word-on-a-slide.mp4) · **Script:** [scenes/46-format-one-word-on-a-slide.spec.ts](scenes/46-format-one-word-on-a-slide.spec.ts)

## Who and why

Dev is polishing "Fundraiser pitch" (storyboard 32). The Meadow theme already sets the fonts and the centre's green. On the title slide the box reads "Spring fair for the community centre", and Dev wants "fair" in bold and "community" in the accent green, with the other words left in the theme's body style. Selecting the box today bolds every word.

## Inspired by

- WF-A4-11 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): bold, italic, and color apply to the selection.
- Storyboard [32](32-give-a-deck-a-theme-and-transitions.md): a font or color set by hand marks the whole object "Overrides theme", and the next theme leaves that object alone.
- [Change how paragraphs & fonts look](https://support.google.com/docs/answer/1663349): select the text, then Bold, Italic, or a color. In Slides that means the words inside the box, not the box.
- [Docs Editors Community: default fonts and the theme](https://support.google.com/docs/thread/251596528/change-default-fonts-in-google-slides): text you format by hand stops following the theme.
- [Skywork: theme fonts in Google Slides](https://skywork.ai/blog/how-to-change-default-font-google-slides-template-guide/): manual formatting and theme fonts fight, and people clear formatting to get the theme back.

## Scenes

1. **Open the title.** Dev opens "Fundraiser pitch" on the Meadow theme. The title box is one style: Source Sans, the theme's body colour, no bold words. A second line reads "Saturday at the hall".
2. **Bold one word.** Dev double-clicks the title so a caret appears, selects "fair", and presses Cmd/Ctrl+B. "fair" is bold. "Spring", "for", and the rest are not. The box does not say "Overrides theme". The Bold button does the same thing as the shortcut.
3. **Colour one word.** Dev selects "community" and clicks the A with the theme's accent bar. Only that word turns the accent green (#3ddc84, bright enough to read on Meadow). "fair" stays bold and the body colour.
4. **Italic and underline.** Dev selects "centre" and turns on italic, then underline. The other words are unchanged. Undo removes the underline and leaves the italic.
5. **A new theme.** Dev applies Ink. The unformatted words switch to Arial and Ink's body colour. "fair" stays bold, "community" stays green, and "centre" stays italic. The box is not marked as overriding the theme.
6. **The whole box, on purpose.** On "Saturday at the hall", with the box selected and no caret inside it, Bold still bolds every word and shows "Overrides theme". Reset to theme clears the mark and the bold.
7. **Save.** Dev downloads the SuiteLeaf file and opens the copy with Keep both. "fair" is bold, "community" is green, and "centre" is italic.

## Google Workspace benchmark

In Google Slides, partial formatting is select the word (the box has to be in text editing, which is a double-click), then Bold, Italic, Underline, or a color: 1 click once the word is selected ([Docs Help](https://support.google.com/docs/answer/1663349)). Cmd/Ctrl+B is the same for bold. A single click on the box selects the object, and Bold then applies to all of its text.

Known pain points:

- Bold from the object selection formats the whole box, which is easy to do when you meant one word.
- A word formatted by hand stops following the theme, and so do the words around it once the box is treated as manually styled ([Docs Community](https://support.google.com/docs/thread/251596528/change-default-fonts-in-google-slides), [Skywork](https://skywork.ai/blog/how-to-change-default-font-google-slides-template-guide/)).

## Better than Google Workspace when

1. With a caret in a text box, selecting one word and pressing Cmd/Ctrl+B, or clicking Bold, bolds only that word.
2. Italic, underline, and text color apply to the same kind of selection, and Undo undoes one of those steps.
3. Words outside the selection keep the weight, style, and color they had.
4. Applying a different theme restyles the words that were not formatted by hand, and leaves the bold, color, italic, and underline on the words that were.
5. Selecting the box as an object, with no caret, still bolds the whole box and marks it "Overrides theme", with Reset to theme.
6. The per-word formatting survives save, reopen, and the downloaded `.slslides` file.

## Success looks like

- The title reads with "fair" bold, "community" in the accent green, and "centre" italic and, after Undo, not underlined.
- Ink restyled the other words to Arial. The downloaded copy matches.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. With a caret, Cmd/Ctrl+B or Bold bolds only the selected word | Met | Video ~0:08 selects "fair" and bolds it. "Spring" stays regular. The Bold button is the same control; `tests/browser/slide-runs.spec.ts` clicks it. |
| 2. Italic, underline, and text colour follow the selection, and Undo undoes one step | Met | Video ~0:13 the accent button colours "community". ~0:15 italic and underline on "centre". ~0:17 Undo leaves the italic and drops the underline. |
| 3. Words outside the selection keep their weight, style, and colour | Met | Video ~0:17 "fair" is still bold, "community" is still green, and "for" is neither. `tests/slide-runs.test.ts` |
| 4. A new theme restyles only the words that were not formatted by hand | Met | Video ~0:21 Ink turns the other words light gray in Arial. "fair" stays bold, "community" stays green, "centre" stays italic. No "Overrides theme" on that box. |
| 5. A box with no caret still bolds every word and marks "Overrides theme", with Reset to theme | Met | Video ~0:24 "Saturday at the hall" goes bold and the bar appears. Reset clears the bar and the bold. |
| 6. The per-word formatting survives save, reopen, and the downloaded `.slslides` file | Met | The scene reads the download, then Keep both opens the copy. Video ~0:29. `tests/slide-runs.test.ts` round-trips the runs. |

## Gaps and notes

- Per-word bold, italic, underline, and colour are stored as runs next to the plain `content` string. The box does not get `themeOverride`, so `applyDeckTheme` still changes its font and colour. A run colour is the exception.
- Bold on the box, with no caret, still sets `themeOverride`. Reset to theme clears that mark, the box-level bold, italic, and underline, and any runs.
- The accent control paints the theme's accent in one click. This recording uses #3ddc84 so the green is obvious on Meadow's dark background.
- PowerPoint export is still out of scope (storyboard 32). This story is the native file and the editor.
- Tables on a slide store each cell as a string (`rows`). Per-word formatting inside a table cell is not part of this story.
- A font or a size chosen in the toolbar still applies to the whole box.
