# 78 · Keep the Word file's margins

**Mode:** single-node · **App:** Docs · **Video:** [videos/78-keep-the-word-margins.mp4](videos/78-keep-the-word-margins.mp4) · **Script:** [scenes/78-keep-the-word-margins.spec.ts](scenes/78-keep-the-word-margins.spec.ts)

## Who and why

Sam opens the council's Word template. The letterhead needs 1.5 inches at the top, 0.75 at the bottom, 1 inch on the left, and 0.75 on the right. SuiteLeaf opens it with the same default inset on every edge, so the title sits in the letterhead.

## Inspired by

- [Change page margins](https://support.google.com/docs/answer/10296618): a Word file opened in Docs keeps the section's top, bottom, left, and right. People still discover the values only after the text has jumped.
- Word stores those edges on `w:pgMar` in twips (1/1440 inch). This base never reads that element. Page setup stores one `margin` in `packages/core/src/document-layout.ts`.
- Storyboard [07](07-page-setup-and-export.md) set that single margin. A separate branch adds four fields in the dialog; this story is the Word round trip, so the four edges have to exist here too.

## Scenes

1. **The template.** Sam opens "Council letter.docx". The title starts the same distance from every edge.
2. **What Word asked for.** Page setup shows Top 1.5 in, Bottom 0.75 in, Left 1 in, and Right 0.75 in. The first line sits further down. The left gap is wider than the right.
3. **One change.** Sam sets Right to 1 inch and downloads a Word file. Opening that file again shows Right 1 inch and the other three unchanged.
4. **No margins in the file.** A second Word file with no page margins opens at SuiteLeaf's usual default on every edge.
5. **Save.** Sam downloads the SuiteLeaf file and opens the copy. The four values are unchanged.

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

Sam opens the council template and the letterhead has room. Page setup already shows the four Word margins. A one-edge change comes back from Word the same way.

## Gaps and notes

- Import currently ignores `w:pgMar`. Layout uses one margin on every edge.
- Use the first section when a Word file has several. Later sections are a future storyboard.
- Header and footer distance, mirror margins, and a binding gutter are out of scope.
- Inches on screen. Do not add a centimeter unit or Narrow / Wide presets in this story.
