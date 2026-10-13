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
  - A Google Docs-style "more" overflow menu, so the toolbar stays on one row below about 1250 px.
  - Alignment buttons don't show which alignment is active.
  - Sheets and Slides still show a "Menus" search pill that does nothing.
