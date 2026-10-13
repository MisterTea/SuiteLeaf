# 101 · Bring the space from Word

**Mode:** single-node · **App:** Docs · **Video:** [videos/101-bring-the-space-from-word.mp4](videos/101-bring-the-space-from-word.mp4) · **Script:** [scenes/101-bring-the-space-from-word.spec.ts](scenes/101-bring-the-space-from-word.spec.ts)

## Who and why

Priya receives Garden club minutes as a Word file. The welcome already has 12 pt after it, and the Motion heading already has 12 pt before it. The motion lines have no extra gap. She should see those gaps when the file opens. Google Docs imports the spacing, then hides the numbers in Format › Line & paragraph spacing › Custom spacing.

## Inspired by

- [Change line and paragraph spacing](https://support.google.com/docs/answer/1696498): Space before and Space after sit in a second dialog.
- Storyboard 95 already edits those values and writes `w:before` and `w:after`. This story is the other direction: Word → SuiteLeaf.
- Word stores the gap in twips on `w:spacing` (`w:before="240"` is 12 pt).

## Scenes

1. **Glued today.** Priya opens minutes.docx. The welcome, the Motion heading, and the first motion line sit with no extra gap, even though the file says otherwise.
2. **The gaps arrive.** After the fix, the same open shows a gap under the welcome and a gap above Motion. The motion line has no extra gap. Line spacing on the welcome stays whatever the file had (single, if the file set none).
3. **The numbers.** The caret in the welcome shows Space after 12 pt on the line-spacing control. Motion shows Space before 12 pt. The motion line shows 0 pt after. No second dialog.
4. **One change.** She sets the welcome's Space after to 0. Only that gap goes away. Motion stays 12 pt before.
5. **Round trip.** She reopens the SuiteLeaf file. Motion is still 12 pt before. Exporting .docx writes `w:before="240"` on Motion, omits `w:after` on the welcome she zeroed, and omits both on the motion line.

## Google Workspace benchmark

Google Docs imports Word before/after spacing, but the menu does not show the current numbers until Custom spacing opens. A heading style and the imported space often stack, so the gap is larger than the number in the dialog.

## Better than Google Workspace when

1. Opening the .docx shows the welcome's 12 pt after and Motion's 12 pt before on the page, with no extra command.
2. The line-spacing control shows those points for the caret's paragraph. No second dialog.
3. A paragraph with no `w:before` and no `w:after` stays at 0. It does not gain a hidden stylesheet gap the control does not show.
4. Setting the welcome's space after to 0 does not clear Motion's imported space before, and does not change line spacing.
5. The imported values survive save and reopen of the SuiteLeaf file.
6. Export writes `w:before` / `w:after` only where the paragraph still has that gap, in twips, and omits a 0.
7. A `w:before` or `w:after` of 0, or a missing attribute, is 0 pt. A value above 120 pt is rejected and that side stays 0, with the rest of the paragraph still imported.

## Success looks like

The welcome has air under it. Motion has air above it. The motion line does not. The control shows 12, 12, and 0. Zeroing the welcome does not collapse Motion.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Opening the .docx shows the welcome's 12 pt after and Motion's 12 pt before on the page, with no extra command. | Met | Video 0:04. The minutes are open, the button already reads 12 pt after, and Motion sits below a gap the motion lines do not have. `tests/doc-paragraph-spacing.test.ts` |
| The line-spacing control shows those points for the caret's paragraph. No second dialog. | Met | Video 0:08. The menu shows Single and Space after 12, and there is no dialog. Video 0:11 Motion reads 12 pt before. Video 0:13 the motion line reads 0 pt after. |
| A paragraph with no `w:before` and no `w:after` stays at 0. It does not gain a hidden stylesheet gap the control does not show. | Met | Video 0:13. The motion line is 0 pt before and 0 pt after, and the two lines sit together. Motion's missing space after is stored as 0, so the heading margin does not add a gap. `tests/doc-paragraph-spacing.test.ts` |
| Setting the welcome's space after to 0 does not clear Motion's imported space before, and does not change line spacing. | Met | Video 0:17 the welcome reads 0 pt after and Single. Video 0:19 Motion still reads 12 pt before. `tests/doc-paragraph-spacing.test.ts` |
| The imported values survive save and reopen of the SuiteLeaf file. | Met | Video 0:23. She is back in the minutes and Motion still reads 12 pt before. |
| Export writes `w:before` / `w:after` only where the paragraph still has that gap, in twips, and omits a 0. | Met | Video 0:26 File, Export DOCX. Motion is `w:before="240"`. The welcome she zeroed and the motion line omit both. `tests/doc-paragraph-spacing.test.ts` |
| A `w:before` or `w:after` of 0, or a missing attribute, is 0 pt. A value above 120 pt is rejected and that side stays 0, with the rest of the paragraph still imported. | Met | `tests/doc-paragraph-spacing.test.ts`. 0 and a missing attribute are 0. 2400 twips is 120 pt. 3000 twips (150 pt) stays 0, and that paragraph's text is still imported. |

## Gaps and notes

- Line spacing is not imported. A file that set none stays single, which is what these minutes did.
- A gap that lives only on the paragraph style, and not on the paragraph, is not read.
- "Don't add space between paragraphs of the same style" is not implemented.
- A `w:before` or `w:after` above 120 pt is left at 0. The rest of the paragraph still comes in.
