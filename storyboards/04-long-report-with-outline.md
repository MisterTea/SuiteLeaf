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

## AI version

**Script:** [scenes/ai/04-long-report-with-outline-ai.spec.ts](scenes/ai/04-long-report-with-outline-ai.spec.ts) · **Video:** none yet. No run has passed, so there is no `videos/04-long-report-with-outline-ai.mp4` or `videos/electron/04-long-report-with-outline-ai.mp4`. Failed runs are saved to `test-results/ai-videos/` (and `test-results/ai-videos/electron/`) each time the spec runs.

Tom starts on the home screen, opens the assistant, types a request and pastes in his report the way it sits in his notes: each section title on its own line, followed by its paragraph.

> Please turn my report below into a new document called Community garden annual report, with the section titles as proper headings. Spring planting and Summer harvest are sub-sections of Growing season, and Income and Expenses are sub-sections of Budget.
>
> Summary
> Riverside Community Garden had its busiest year yet. …
>
> Growing season
>
> Spring planting
> A cold April delayed the first sowings … (and so on for all nine sections)

Then a second request:

> Take me to the Volunteers section and add this line right under its heading: A special thank-you to the Saturday tea rota!

The script checks the same end state as the original:
- The file is open with the right title.
- The outline lists all nine headings in order, with the four sub-sections at level 2.
- Each heading is directly followed by its own paragraph, and the report runs to 2 pages.
- After the second request, Volunteers is in view and highlighted in the outline, the thank-you is the paragraph directly under its heading, and the file is saved.

**Tools used:** `create_file`, `write_text` (all at once, or one section at a time), `set_style`, `go_to_heading`, sometimes `read_document`, `find_and_replace`, `back_to_files`, `rename_this_file`, `format_text` and `align_text`.

**What the recordings show.** When Gemma gets it right, it creates the document and types the whole report in a single `write_text` call, using `#` and `##` lines for the headings. The outline fills in at once and the Expenses heading moves to the top of page 2 with its paragraph. A long call takes 25 to 35 seconds to generate. While it runs, the panel now says "Preparing "Type text"… 1,240 characters" and the count goes up, so the screen doesn't look frozen. For the second request, the best run moved the purple pointer to Volunteers in the outline, jumped there, and highlighted it.

**How Gemma did: 0 passes in 11 web attempts and 2 Electron attempts.** These include the 3 final web runs after the last fix. The first request came out exactly right 2 times. Half-right runs failed in these ways:
- **Wrong heading levels** (5 runs). Summary became Heading 1 and every other section Heading 2, with the sub-sections at Heading 3. In other runs a single section (Volunteers) was demoted, or `set_style` calls rewrote headings that `write_text` had already made correctly.
- **Restyling and leaving the file.** After a correct `write_text`, Gemma often called `set_style` on all nine headings, even though the result listed them and later said "already Heading 1; nothing changed". It then went back to the file list unasked (4 runs). This happened even after the `back_to_files` description and the system prompt were changed to discourage it.
- **Sections out of order** (2 web runs and both Electron runs). Gemma typed one section at a time and used the previous heading as `after` ("after: Summer harvest"). That put each new section between a heading and its paragraph. Since the last fix, `write_text` puts text that starts with a heading after that heading's paragraphs. The Electron runs typed headings as plain lines, then restyled them, so the fix didn't apply there.
- **Second request.** Of the 3 runs that got this far, only one used `go_to_heading`. Gemma quoted the heading with Markdown marks ("# Volunteers") in `find_and_replace` and in `write_text`'s `after`. Once, it put the line after the section's paragraph instead of under the heading. Once, after an error, it stopped and said it had added the line as a bullet when it hadn't. `after` now ignores Markdown marks.
- **Unrequested extras.** In one run Gemma added a centred, underlined title line nobody asked for.

The Electron build (llama.cpp) did worse on this task than the web build. It typed the headings as plain text and fixed them one by one.

## Gaps and notes

- Headings can't be collapsed or dragged to reorder sections in the outline (Word's Navigation pane can do both).
- The earlier "page jumps on Enter" came from pressing End on macOS, which scrolled the whole document to the bottom without moving the caret. The next Enter then pulled the caret back to the very top edge. End and Home now move to the end and start of the line on macOS, as in Word, and typing keeps a few lines of space above and below the caret.
- The section highlight follows scrolling, not the caret: clicking into a section without scrolling doesn't move it.
- Page numbers ("1 / 2") appear in the footer without being turned on (storyboard 07).
