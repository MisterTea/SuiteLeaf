# 03 · Open a Word document

**Mode:** single-node · **App:** Docs · **Video:** [videos/03-import-word-document.mp4](videos/03-import-word-document.mp4) · **Script:** [scenes/docs.spec.ts](scenes/docs.spec.ts)

## Who and why

Lena was emailed "Office field notes.docx" by a colleague. She doesn't have Word and wants to read it, add a note and keep working on it, without uploading it anywhere. She also wants to know what might not have come across.

## Inspired by

- [Google Docs Help: work with Microsoft Office files](https://support.google.com/docs/answer/9406611): converting creates a new editable copy and leaves the original Office file alone.
- [r/libreoffice: getting a file into Google Docs](https://www.reddit.com/r/libreoffice/comments/19bm41o/getting_odt_file_transferred_to_google_docs/): "the more complicated your document becomes, the more issues you'll have when importing". People expect basic content to survive and want to be told what didn't.
- W15 (import a Word document) in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md) and [docs/office-imports.md](../docs/office-imports.md).

## Scenes

1. **Open / import.** On the home screen Lena clicks **Open / import** and picks the .docx file.
2. **Editable copy.** The document opens straight away, titled "Office field notes": a Heading 1 (also in the outline), a bold italic line in English, Chinese and Arabic, a "Reference" link, a table and "North plot: 40 m²" with a superscript ².
3. **Compatibility notes.** A banner reads "Imported DOCX: Office field notes.docx · 2 compatibility notes". Opening it lists both: one link with an unsafe address (`javascript:`) was removed but its text was kept, and because SuiteLeaf lays out its own pages, Word's exact line and page breaks, floating placement and font styling may differ.
4. **Unsafe content dropped.** "Unsafe link" is still there as plain text, but it is no longer a link. The normal https "Reference" link is kept.
5. **Edit.** Lena clicks after "40 m²" and presses Enter. As in Word, the new line carries on the superscript, and the toolbar's **Superscript** button shows it is on. She clicks it to turn it off and types a review note in normal text.
6. **Autosave.** The status reads "Saved on this device". The original .docx is never changed.
7. **Library.** Back on the home screen, "Office field notes" is listed with her edit.

## Success looks like

- The Word content is editable in SuiteLeaf, with headings, emphasis, other scripts, the safe link, the table and superscript preserved.
- The import banner says what was converted and lists every compatibility note, including each removed link.
- Superscript and subscript can be seen and toggled from the toolbar (x² and x₂), the **Format** menu, or Cmd/Ctrl+. and Cmd/Ctrl+,.
- Lena's note is saved in the library copy.

## AI version

**Videos:** [web](videos/03-import-word-document-ai.mp4) · [desktop (Electron)](videos/electron/03-import-word-document-ai.mp4) · **Script:** [scenes/ai/03-import-word-document-ai.spec.ts](scenes/ai/03-import-word-document-ai.spec.ts)

Lena opens the AI panel on the home screen and types one request:

> Open the Word document I was emailed. Then on a new line after "40 m²" add this note, in normal text, not superscript: Reviewed by Lena: figures confirmed with the North team.

Gemma calls **Open / import** (`open_from_computer`). Its pointer moves to the Open / import button and the panel shows "Choose the file to open" with a **Choose file…** button; Lena clicks it and picks "Office field notes.docx". The file converts on her computer and opens in Docs, and the tool result gives Gemma the document's opening lines, including "North plot: 40 m²". Gemma then calls **Type text** (`write_text`) with `after: "North plot: 40 m²"` (or just "40 m²"), and its pointer moves to the end of that line as the note is typed on a new line in normal text. It finishes with a one-sentence summary. The script then checks the same end state as the original: heading (also in the outline), bold italic text in three scripts, the safe "Reference" link, "Unsafe link" as plain text, the table, the superscript ², the note as the last paragraph with no superscript, and the import banner listing both compatibility notes. On the web the status reads "Saved on this device"; the desktop app reads "Draft saved · choose Save As", because desktop documents are files and stay drafts until the first Save As. Lena goes back to her files, reopens "Office field notes", and her note is still there.

**How Gemma did:** after the fixes below, the web version passed 3 times out of 3 in a row and the desktop version passed 2 times out of 2. Each time Gemma used two tool calls in 8 to 30 seconds, after the model had loaded. Before the fixes:

- The editor showed the superscript as "40 m2", so `after: "40 m²"` matched no paragraph. Gemma then copied the line label from `read_document` (`"[Paragraph] North plot: 40 m2"`), gave up, and put the note at the end of the document. That only worked because the line happens to be the last one. Docs tools now show superscript and subscript digits as ² and ₂, match ² and 2 as the same, ignore a copied "[Paragraph] " label, and list the document's paragraphs when the text isn't found.
- On the desktop, Gemma twice answered without calling any tool, once asking for the file name and once saying it can't open email attachments. The Open / import tool's description now says it is for email attachments and downloads and needs no file name. With that change it called the tool every time.

## Gaps and notes

- Fixed: the layout note used to say "Continuous layout preserves semantic content…" even though Docs shows live pages. It now describes SuiteLeaf's own pagination.
- Fixed: removed `javascript:` (and other unsafe or unsupported) links were dropped silently. They are now counted and listed in the compatibility notes with their address type.
- Fixed: imports kept superscript and subscript, but there was no control for either, so **Clear formatting** was the only way out. Docs now has Superscript and Subscript toolbar buttons, which show the current state, and matching **Format** menu items.
- Fixed: the banner said "1 compatibility notes"; it now uses the singular for one note.
- The compatibility notes are general. They don't point at the place in the document each note refers to.
