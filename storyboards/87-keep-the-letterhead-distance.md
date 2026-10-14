# 87 · Keep the letterhead's distance

**Mode:** single-node · **App:** Docs · **Video:** [videos/87-keep-the-letterhead-distance.mp4](videos/87-keep-the-letterhead-distance.mp4) · **Script:** [scenes/87-keep-the-letterhead-distance.spec.ts](scenes/87-keep-the-letterhead-distance.spec.ts)

## Who and why

Sam opens the council's Word template. "Town council" is half an inch from the top of the page, and the notes start an inch in. SuiteLeaf drops the header down into the body margin, so the letterhead sits on the title.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/10296618): a Word file opened in Docs keeps the header and footer distance. People still only discover the number after the letterhead has jumped.
- Word stores those distances on `w:pgMar` as `w:header` and `w:footer`, in twips. Export on the header-distance branch already writes them. Import does not read them.
- Storyboard [84](84-header-from-the-edge.md) added Header from edge and Footer from edge. This story is the Word round trip.

## Scenes

1. **Already in place.** Sam opens "Council letter.docx". The import line says header 0.5 in and footer 0.5 in from the edge. "Town council" is already half an inch from the top. The notes stay an inch in.
2. **The bottom edge.** The whole page fits in view. "Hearing notes" sits half an inch above the bottom edge. The lower margin stays an inch.
3. **What Word asked for.** Page setup shows Header from edge 0.5, Footer from edge 0.5, and Top 1. The note says these move the header and the footer, not the notes.
4. **One change.** Sam sets Header from edge to 0.75. Footer stays 0.5. The letterhead moves down. The notes stay an inch in. She downloads Word and opens that file. Header is 0.75, footer is 0.5, and the top margin is still 1.
5. **No distance in the file.** "Workshop.docx" never set a header or footer distance. Page setup shows 0.75 in on every edge, the usual margin.
6. **Save.** She downloads the SuiteLeaf copy of the revised letter and opens it. Header is still 0.75, footer is still 0.5, and the notes are still an inch in.

## Google Workspace benchmark

Google Docs keeps a .docx header distance, then hides it in File › Page setup ([Docs Help](https://support.google.com/docs/answer/10296618)). Nothing on the page says the letterhead moved because of that number rather than the top margin.

## Better than Google Workspace when

1. Opening a .docx reads `w:header` and `w:footer` into Header from edge and Footer from edge, in inches.
2. The header's distance from the top of the page matches that field, within a tenth of an inch. The body margin does not change.
3. Changing one distance and downloading Word writes that attribute back and leaves the other.
4. A .docx with no header or footer distance opens at the current default for that edge.
5. Both distances survive save as a SuiteLeaf file and reopen.
6. The footer distance matches the bottom of the page the same way.

## Success looks like

Sam opens the council template and "Town council" is already half an inch from the top. The notes stay an inch in. "Hearing notes" is half an inch from the bottom. A one-edge change comes back from Word the same way, and the SuiteLeaf copy keeps both.

## Gaps and notes

- No ruler, images or tabs inside the header, centimeter unit, or a separate distance for a different first page or odd and even headers. Those variants keep this one distance.
- Body margins are stored the same way as before. Importing a header distance does not change them.
- A file that omits `w:header` or `w:footer` leaves that field unset, so it still follows the body margin (0.75 in when the file also omits margins).
- The import line still mentions the existing layout compatibility note.
- The recording zooms to 50% so the footer and the bottom edge both fit on screen. The distances are the same at 100%.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Opening a .docx reads `w:header` and `w:footer` into the fields, in inches | Met | Video 0:05, the import line says header 0.5 in and footer 0.5 in. Video 0:11, Page setup shows both. Test `imports both distances in inches without moving the body margin`. |
| 2. The header's distance matches that field, within a tenth of an inch. The body margin does not change | Met | Video 0:05, "Town council" sits above the notes. Browser test `a Word letterhead keeps its distance from the edge` measures the header at 0.5 in and the notes at 1 in. |
| 3. Changing one distance and downloading Word writes that attribute back and leaves the other | Met | Video 0:15, Header becomes 0.75 and Footer stays 0.5. Video 0:24, the reopened Word file shows the same pair and Top still 1. Test `writes a changed header distance back and leaves the footer`. |
| 4. A .docx with no header or footer distance opens at the current default | Met | Video 0:30, Workshop shows 0.75 in for the header, the footer, and every margin. Test `keeps the current default when the file has no header or footer distance`. |
| 5. Both distances survive save as a SuiteLeaf file and reopen | Met | Video 0:36, Header 0.75, Footer 0.5, Top 1. The browser test reads `headerFromEdge: 72` and `footerFromEdge: 48` from the downloaded file and measures them after reopen. |
| 6. The footer distance matches the bottom of the page the same way | Met | Video 0:08, "Hearing notes" sits above the bottom edge. The browser test measures the footer at 0.5 in and the bottom inset at 1 in. |
