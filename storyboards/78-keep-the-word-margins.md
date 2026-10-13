# 78 · Keep the Word file's margins

**Mode:** single-node · **App:** Docs · **Video:** [videos/78-keep-the-word-margins.mp4](videos/78-keep-the-word-margins.mp4) · **Script:** [scenes/78-keep-the-word-margins.spec.ts](scenes/78-keep-the-word-margins.spec.ts)

## Who and why

Sam opens the council's Word template. The letterhead needs 1.5 inches at the top, 0.75 at the bottom, 1 inch on the left, and 0.75 on the right. SuiteLeaf opens it with the same default inset on every edge, so the title sits in the letterhead.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/10296618): a Word file opened in Docs keeps the section's top, bottom, left, and right. People still discover the values only after the text has jumped.
- Word stores those edges on `w:pgMar` in twips (1/1440 inch). Page setup used to store one `margin` in `packages/core/src/document-layout.ts`.
- Storyboard [07](07-page-setup-and-export.md) set that single margin. A separate branch adds four fields in the dialog; this story is the Word round trip, so the four edges have to exist here too.

## Scenes

1. **The template.** Sam opens "Council letter.docx". The title sits lower than it would on a default page, and the left gap is wider than the right.
2. **What Word asked for.** Page setup already shows Top 1.5 in, Bottom 0.75 in, Left 1 in, and Right 0.75 in, next to a small page that draws each edge.
3. **One change.** Sam sets Right to 1 inch. That edge lights up, and the note says the others stay. She downloads a Word file. Opening it again shows Right 1 inch and the other three unchanged.
4. **No margins in the file.** A second Word file with no page margins opens at 0.75 in on every edge.
5. **Save.** Sam downloads the SuiteLeaf file and opens the copy. The four values are unchanged.
6. **An older file.** A SuiteLeaf file that stored one 1-inch margin opens with 1 inch on every edge.

## Google Workspace benchmark

Google Docs keeps a .docx section's margins, then hides them in File › Page setup ([Docs Help](https://support.google.com/docs/answer/10296618)). There is no preview of which edge moved, and a later download sometimes does not match the numbers on screen.

## Better than Google Workspace when

1. Opening a .docx reads Top, Bottom, Left, and Right from the section's `w:pgMar` and shows them in Page setup, in inches.
2. The body inset on each edge matches that field, within a tenth of an inch.
3. Changing one edge and downloading Word writes that edge back and leaves the other three as they were.
4. A .docx with no page margins opens with every edge at SuiteLeaf's current default.
5. The four values survive save as a SuiteLeaf file and reopen.
6. A SuiteLeaf file that stored one margin opens with all four edges equal to that margin.

## Success looks like

Sam opens the council template and the letterhead has room. Page setup already shows the four Word margins, and the edge she edits lights up before the page moves. A one-edge change comes back from Word the same way.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Opening a .docx reads Top, Bottom, Left, and Right from `w:pgMar` and shows them in Page setup, in inches | Met | Video 0:07–0:09; `imports a council letter's w:pgMar into four edges` |
| The body inset on each edge matches that field, within a tenth of an inch | Met | Video 0:04–0:06; `Word's four page margins show, lay out, and round-trip` |
| Changing one edge and downloading Word writes that edge back and leaves the other three | Met | Video 0:09–0:21; `writes the four edges back and leaves the others unchanged` |
| A .docx with no page margins opens at SuiteLeaf's current default on every edge | Met | Video 0:22–0:25; `opens a Word file with no page margins at the current default` |
| The four values survive save as a SuiteLeaf file and reopen | Met | Video 0:26–0:28; browser test reopens `Council letter.sldoc` |
| A SuiteLeaf file that stored one margin opens with all four edges equal to that margin | Met | Video 0:30–0:32; `opens a one-margin SuiteLeaf file with that margin on every edge` |

## Gaps and notes

- Margins outside 0.25–1.5 inches are brought into that range, the same limit Page setup already had.
- Only the first section is read. Later sections are a future storyboard.
- Header and footer distance, mirror margins, and a binding gutter are not read.
- Inches on screen. No centimeter unit, and no Narrow or Wide presets.
- Page numbers, headers, watermarks, and columns are unchanged.
