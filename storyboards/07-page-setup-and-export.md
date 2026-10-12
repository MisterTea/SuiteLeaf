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

## Gaps and notes

- Fixed: after **Page break**, the break stayed selected; the next key typed replaced it and the document fell back to one page. The cursor now lands in an empty paragraph on the new page, and the view scrolls to it. Backspace at the start of that page removes the break, as in Docs.
- Fixed: typing on a later page could snap the view back to page 1 while pages were re-measured.
- Changed: new documents, and documents never given a page setup, have no page numbers. Files saved with page setup keep the numbering they had.
- The HTML export is one web page, so the header and footer appear once, above and below the text. Printing it uses the paper size, margins and page breaks; page numbers print in browsers that support page margin boxes (Chrome and Edge), but the header and footer don't repeat on each printed page. Use DOCX or **Print / Save as PDF** for that.
- Headers and footers are plain text only. There's no different first page, no choice of where page numbers go, and no formatting or images, unlike Docs and Word. Margins are one value for all four sides.
- Outside this storyboard: the outline shortens headings to "Meeting minutes, 8 Octo…" (see 04).
