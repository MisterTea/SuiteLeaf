# 07 · Set up pages and export for Word and the web

**Mode:** single-node · **App:** Docs · **Video:** [videos/07-page-setup-and-export.mp4](videos/07-page-setup-and-export.mp4) · **Script:** [scenes/docs.spec.ts](scenes/docs.spec.ts)

## Who and why

Ben takes the garden club's minutes. Some members want a Word file they can print, with the club's name at the top of every page and page numbers. The club website wants a web page. Ben wants to write once and send both.

## Inspired by

- [Google Docs Help: headers, footers and page numbers](https://support.google.com/docs/answer/86629): add a header and footer that repeat on every page, and insert page numbers.
- [r/gsuite: converting Google Docs to Word without losing formatting](https://www.reddit.com/r/gsuite/comments/13oem44/how_do_i_convert_google_docs_to_word_without/): "There isn't 100% compatibility." People check that what matters (headers, page numbers) survives the trip to Word.
- W5 (exports) and the local editor features note (Page setup, DOCX export) in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md).

## Scenes

1. **Write the minutes.** In "October meeting minutes", Ben adds a Heading 1, the attendance and the decisions.
2. **Page breaks.** On an empty line he clicks **Page break** on the toolbar. The view moves to the new page with the cursor at its top, and he types "Appendix A: plot assignments". For Appendix B he uses **Insert → Page break** (shortcut Ctrl+Enter, or ⌘+Enter on a Mac). The status bar reads "3 pages".
3. **Page setup.** **File → Page setup…** (also on the toolbar) opens a dialog with paper size, orientation, margins, header, footer and page numbers. He types the header "Riverside Garden Club" and the footer "Minutes: draft for members". **Page numbers** is off, as in Docs and Word, so he turns it on and clicks **Apply**.
4. **Check the pages.** Where pages 1 and 2 meet, page 1 ends with the footer and "1 / 3", and page 2 starts with the header.
5. **Export DOCX.** **File → Export DOCX** downloads "October meeting minutes.docx". Inside the file are the header and the footer with page-number fields.
6. **Export HTML.** **File → Export HTML** downloads "October meeting minutes.html": the club name above the minutes, the footer below, and the headings and text in between.

## Success looks like

- Three pages, each with the header, the footer and "page of" numbering.
- A Word file and a web page in Downloads, both with the full minutes.

## AI version

**Video:** [videos/07-page-setup-and-export-ai.mp4](videos/07-page-setup-and-export-ai.mp4) (web, WebGPU) · [videos/electron/07-page-setup-and-export-ai.mp4](videos/electron/07-page-setup-and-export-ai.mp4) (desktop, llama.cpp) · **Script:** [scenes/ai/07-page-setup-and-export-ai.spec.ts](scenes/ai/07-page-setup-and-export-ai.spec.ts)

Ben has already typed the October minutes as in the original: the heading, the attendance and decisions, and both appendix headings with their text, all on one page with no page setup. He opens the assistant and types one request:

> Put Appendix A and Appendix B each on their own page. Add the header "Riverside Garden Club" and the footer "Minutes: draft for members" with page numbers, then export the minutes for Word and as a web page.

Gemma called `insert_page_break` before "Appendix A: plot assignments" and before "Appendix B: work party rota", then `page_setup` with the header, the footer and page numbers on, then `export_document` twice (docx, then html), and replied with one sentence. The recording shows the purple pointer going to the start of each appendix heading as the page moves down, to the Page setup button as the dialog opens filled in and applies, and to the File menu for each export. The test then checks the same end state as the original: two page breaks, each directly before its appendix heading; "3 pages"; every page with the club's name at the top and "Minutes: draft for members" and "n / 3" at the bottom; and both files. "October meeting minutes.docx" has the header, a footer with the NUMPAGES field and all the minutes, and "October meeting minutes.html" has the club name above the minutes and the footer below. On the web these are browser downloads. On the desktop they go through the Save dialog, which the test answers with a folder.

How Gemma did: it passed every attempt on the first try, with the same five tool calls each time, no tool errors and no retries. That was 5 of 5 on the web (three loop iterations plus two consistency runs) and 2 of 2 on the desktop. The agent's part takes about 10 to 25 seconds once the model has loaded. The only model-side quirk was sending settings nobody asked for. In one run it set `margin_inches: 1`, which would have changed the margins from 0.75". After the fixes below it either leaves them out or copies the current values (Letter, portrait, 0.75") from the app state, so nothing changes.

Fixed along the way:
- `page_setup` treated margins as 72 per inch, but the document stores CSS pixels (96 per inch). It reported the default margins as 1.00" while the dialog showed 0.75", and asking for 1" gave 0.75". It now uses the dialog's inches and range (0.25" to 1.5"), and it says when a value was out of range.
- The Docs app state now includes the page setup (paper, orientation, margins, header, footer, page numbers). The tool also says to pass only the settings the user asked to change.
- `export_document` used to say "Exported" even when the person cancelled the desktop Save dialog. It now says where the file went ("downloaded to the browser's downloads" or "the user saved it as …"), or that the dialog was closed and nothing was exported.

## Gaps and notes

- Fixed: after **Page break**, the break stayed selected; the next key typed replaced it and the document fell back to one page. The cursor now lands in an empty paragraph on the new page, and the view scrolls to it. Backspace at the start of that page removes the break, as in Docs.
- Fixed: typing on a later page could snap the view back to page 1 while pages were re-measured.
- Changed: new documents, and documents never given a page setup, have no page numbers. Files saved with page setup keep the numbering they had.
- The HTML export is one web page, so the header and footer appear once, above and below the text. Printing it uses the paper size, margins and page breaks; page numbers print in browsers that support page margin boxes (Chrome and Edge), but the header and footer don't repeat on each printed page. Use DOCX or **Print / Save as PDF** for that.
- Headers and footers are plain text only. There's no different first page, no choice of where page numbers go, and no formatting or images, unlike Docs and Word. Margins are one value for all four sides.
- Outside this storyboard: the outline shortens headings to "Meeting minutes, 8 Octo…" (see 04).
