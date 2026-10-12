# 04 · Write a long report and move around it with the outline

**Mode:** single-node · **App:** Docs · **Video:** [videos/04-long-report-with-outline.mp4](videos/04-long-report-with-outline.mp4) · **Script:** [scenes/docs.spec.ts](scenes/docs.spec.ts)

## Who and why

Tom is writing the community garden's annual report: a summary, the growing season, volunteers, the budget and next year's plans. It runs over two pages, and he wants to jump between sections without scrolling, as he does with Word's Navigation pane or the Google Docs outline.

## Inspired by

- [Google Docs Help: document outline](https://support.google.com/docs/answer/6367684): apply Heading styles and the outline lists them. "Click the heading you want to go to."
- [Microsoft Support: use the Navigation pane in Word](https://support.microsoft.com/en-us/word/use-the-navigation-pane-in-word): browse by headings, and Word highlights where you are as you scroll.
- [r/MicrosoftWord: how do you deal with repetitive work in Word?](https://www.reddit.com/r/MicrosoftWord/comments/1vywrpt/how_do_you_deal_with_repetitive_work_in_word/): "I use the Heading styles for each section's title… which allows me to easily navigate using the Navigation Pane."

## Scenes

1. **New document.** Tom names it "Community garden annual report".
2. **Headings as he writes.** He types each section title and picks **Heading 1** or **Heading 2** from the paragraph style menu, then writes the section. Each heading appears in the outline on the left as soon as it's styled.
3. **The shape of the report.** Nine headings (five Heading 1, four Heading 2) are listed, with each Heading 2 indented under its Heading 1. The status bar reads "2 pages".
4. **Where am I?** Clicking **Summary** goes back to the top. As Tom scrolls down, the outline highlights the section he's reading.
5. **Jump.** Clicking **Expenses** brings that heading to the top of the window, with a little space above it. It starts page 2 together with its paragraph rather than being left alone at the bottom of page 1.
6. **Edit in place.** Clicking **Volunteers** jumps there. Tom adds a thank-you line under the heading, and it saves.

## Success looks like

- Every Heading 1 and Heading 2 is in the outline, in document order, with subheadings clearly indented.
- Clicking an outline entry puts that heading near the top of the window, ready to edit, and highlights the entry.
- The highlighted entry follows the reader while scrolling.
- A heading is never the last line on a page: it moves to the next page with the text after it.

## Gaps and notes

- Headings can't be collapsed or dragged to reorder sections in the outline (Word's Navigation pane can do both).
- The earlier "page jumps on Enter" came from pressing End on macOS, which scrolled the whole document to the bottom without moving the caret. The next Enter then pulled the caret back to the very top edge. End and Home now move to the end and start of the line on macOS, as in Word, and typing keeps a few lines of space above and below the caret.
- The section highlight follows scrolling, not the caret: clicking into a section without scrolling doesn't move it.
- Page numbers ("1 / 2") appear in the footer without being turned on (storyboard 07).
