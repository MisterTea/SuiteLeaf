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

## Gaps and notes

- Fixed: the layout note used to say "Continuous layout preserves semantic content…" even though Docs shows live pages. It now describes SuiteLeaf's own pagination.
- Fixed: removed `javascript:` (and other unsafe or unsupported) links were dropped silently. They are now counted and listed in the compatibility notes with their address type.
- Fixed: imports kept superscript and subscript, but there was no control for either, so **Clear formatting** was the only way out. Docs now has Superscript and Subscript toolbar buttons, which show the current state, and matching **Format** menu items.
- Fixed: the banner said "1 compatibility notes"; it now uses the singular for one note.
- The compatibility notes are general. They don't point at the place in the document each note refers to.
