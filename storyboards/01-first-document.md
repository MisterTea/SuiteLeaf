# 01 · Write your first document

**Mode:** single-node · **App:** Docs · **Video:** [videos/01-first-document.mp4](videos/01-first-document.mp4) · **Script:** [scenes/basics.spec.ts](scenes/basics.spec.ts)

## Who and why

Sam just installed SuiteLeaf (or opened it in a browser) and wants to jot down a garden plan. Sam has used Word and Google Docs and expects the same basics: a blank page, a title, headings, bold, and no "did I save?" anxiety.

## Inspired by

- *Google Workspace For Dummies*, ch. 5: creating and naming a document ([docs/workflows.md](../docs/workflows.md)).
- [Google Docs formatting guide](https://mintlify-70257915.mintlify.app/features/formatting): use heading styles rather than big bold text so the outline works.
- [r/MicrosoftWord: why people prefer Word](https://www.reddit.com/r/MicrosoftWord/comments/1tgnekv/why_prefer_microsoft_word_than_google_documents/): "works natively and reliably offline", "saves actual files to my local drive". SuiteLeaf's single-node mode is built for this.

## Scenes

1. **Open SuiteLeaf.** The home screen shows "New document", "New spreadsheet" and "New presentation" in one row, with the file library below. There's no sign-in.
2. **New document.** A blank page opens with "Untitled document" as the title. The formatting toolbar fits on one row.
3. **Name it.** Sam types "Garden plan" in the title box.
4. **Write.** Sam clicks near the top of the page, types "Spring planting", presses Enter, and writes a sentence. The page stays put while Sam types.
5. **Heading.** With the cursor on the first line, Sam picks Heading 1 from the paragraph style menu. The outline on the left lists it, aligned left like Google Docs.
6. **Bold.** Sam double-clicks "last" and clicks Bold.
7. **Autosave.** The status next to the title reads "Saved on this device". There's no Save button to remember.
8. **Reopen.** Back to files shows "Garden plan" in the list, clear of the caption. Opening it shows the heading and the bold word intact.

## Success looks like

- The document is in the library under its new name, with the heading and bold preserved (the script checks both after reopening).
- Autosave status was visible the whole time.

## AI version

**Videos:** [web](videos/01-first-document-ai.mp4) · [desktop (Electron)](videos/electron/01-first-document-ai.mp4) · **Script:** [scenes/ai/01-first-document-ai.spec.ts](scenes/ai/01-first-document-ai.spec.ts)

Sam opens the AI panel on the home screen and types one request:

> Start a new document called Garden plan. At the top put the heading Spring planting, then this sentence: Tomatoes and basil go in the sunny bed after the last frost. Make the word "last" bold.

Gemma 4 E4B, running on the device (WebGPU in the browser, llama.cpp on Metal in the desktop app), does the rest. The purple "Gemma" pointer goes to the New document card (`create_file`), then to the page as it types (`write_text`, using `# ` for the heading and `**last**` for bold). In some runs it also restyles the heading (`set_style`) or bolds the word again with `format_text` or `find_and_replace`. These extra steps are harmless because the text is already right. The script then checks the title, the Heading 1, the sentence, the single bold word, the outline entry and the autosave status ("Saved on this device" on the web, "Draft saved" on the desktop). Then Sam closes the panel, goes back to files, sees Garden plan in the list and reopens it with the heading and bold intact. The model takes about 15–30 seconds on the web and about 8 seconds on the desktop, after the model has loaded.

How Gemma did:

- After the last app fix, the web storyboard passed 2 of 3 runs, and the desktop app passed its last 3 runs. Across the whole review, 4 of 10 web runs passed, but most early failures came from app problems that are now fixed (below).
- Mistakes the model made that the app can't fix: it bolded "last frost" instead of "last" when the request said *Make the word last bold* without quotes. That's why the request now quotes the word. It typed "after the the last frost". Once it moved the word to the end ("after the frost. **last**"). Twice it closed the document after finishing, although nobody asked it to. Each time, it still reported that everything was done. It also often checks its own work by making the same change again (bolding "last" two or three times).
- Problems the app caused, fixed during this review: `find_and_replace` typed `**last**` with the asterisks visible, while `write_text` treats `**` as bold. Now both treat it as bold. `write_text` didn't say what it had made bold or turned into a heading, so Gemma redid the formatting; it now does. `after: "# Spring planting"`, the heading written the way Gemma typed it, matched nothing, and the error didn't say what was in the document. On the desktop, Gemma repeated that call five times. Now `after` ignores the `# ` prefix, and the error lists the paragraphs. The `back_to_files` tool was described as "Save and close", which suggested closing a file saves it. The system prompt now also asks Gemma to leave its work open on screen. The find and replace dialog covered the AI panel. Bold in Gemma's replies showed raw asterisks. On the desktop, a brand-new document said "Recovered draft · review and save". Desktop videos were shrunk into a corner of the frame.

## Gaps and notes

- Fixed while reviewing this storyboard:
  - Outline entries were centered in the outline panel, and long headings didn't get an ellipsis. They are now left-aligned and truncated.
  - The Docs toolbar wrapped onto a second row at 1280 px (and at 1440 px). It now fits on one row from about 1250 px up. To make room, "Page setup" and "Page break" became icon buttons with the same names and tooltips. "Paint format", "Add comment" and the "Menus" pill were removed because they did nothing (the pill only opened Find, which already has its own button).
  - Decrease/Increase indent did nothing. They now nest and un-nest list items, and are disabled outside lists.
  - The new-file cards were laid out two plus one, which pushed "Your files" to the bottom edge of a 1280×800 screen. From 1200 px wide the cards sit in one row.
  - Recording: the old script clicked the centre of the page-tall editor, so Playwright scrolled the page 16 px. The caption also covered the reopened file in the list, and the pointer sat on top of text.
- Follow-ups (not built here):
  - Paint format and document comments.
  - Paragraph indentation outside lists. Google Docs indents any paragraph.
  - A Google Docs-style "more" overflow menu, so the toolbar stays on one row below about 1250 px. With the AI panel open at 1280 px, the editor is about 940 px wide, so the toolbar wraps onto two rows and the save status onto two lines.
  - Alignment buttons don't show which alignment is active.
  - Sheets and Slides still show a "Menus" search pill that does nothing.
