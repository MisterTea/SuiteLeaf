# 05 · Add a table, a photo and a link

**Mode:** single-node · **App:** Docs · **Video:** [videos/05-tables-images-and-links.mp4](videos/05-tables-images-and-links.mp4) · **Script:** [scenes/docs.spec.ts](scenes/docs.spec.ts)

## Who and why

Asha is making a seed swap sign-up sheet: a short note, a table of who is bringing what, a photo from last year and a link to the club's rules. She expects to pick the table size, add rows as people sign up, and drop in a picture from her computer, as in Google Docs.

## Inspired by

- [Google Docs Help: add and edit tables](https://support.google.com/docs/answer/1696711): choose rows and columns (up to 20 × 20), then "Insert row above / below" from the right-click menu.
- [Google Docs Help: insert images](https://support.google.com/docs/answer/97447): Insert → Image → Upload from computer.
- [r/googledocs: inserting an image without disrupting the layout](https://www.reddit.com/r/googledocs/comments/z0xgtp/how_do_insert_an_image_into_a_table_cell_without/): people resize images by hand to fit.
- Checkpoints 6–7 in [docs/docs-parity.md](../docs/docs-parity.md) and W19 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md).

## Scenes

1. **Heading and note.** In a new document, "Seed swap sign-up", Asha types a "Seed swap" Heading 1 and a line about the date and place.
2. **Insert table.** **Insert table** opens a dialog. She sets 3 rows and 3 columns, leaves **Header row** ticked and clicks **Create table**.
3. **Fill it in.** She types "Name / Bringing / Hoping for" and two sign-ups, pressing Tab to move between cells. The first row is a bold, shaded header.
4. **Add a row.** Tab in the last cell adds a fourth row, and she adds Joy's sign-up.
5. **Insert a row in the middle.** Priya signed up before Joy. Asha right-clicks Marek's row; a table menu offers insert row above/below, insert column left/right, delete row/column/table and the header row toggle. **Insert row below** adds a row under Marek, and she fills in Priya's sign-up.
6. **Keep writing below.** She clicks below the table and types "Last year's swap table:".
7. **Insert image.** **Insert image** opens the file picker. She chooses a PNG and it appears below the line, outside the table, with the caret after it so she can keep typing.
8. **Link.** She types "Full rules are on the club website.", selects "club website" and clicks **Insert link**. SuiteLeaf's link dialog shows the text and she types `example.org/seed-swap` (no `https://` needed) and clicks **Apply**. The words become a blue, underlined link to `https://example.org/seed-swap`.
9. **Resize the photo.** She clicks the photo; corner handles appear. Dragging a corner shrinks it and it keeps its proportions.
10. **Saved.** The status reads "Saved on this device". The sheet shows the table, photo and link together.

## Success looks like

- A 5-row, 3-column table with a header row and the sign-ups in order, a resized photo, and a working link to the rules.
- Everything autosaved, including the photo's new size.

## Gaps and notes

- The same table commands are under **Format → Table** in the menu bar (greyed out when the caret isn't in a table). After **Insert row above/below** the caret stays where it was, as in Google Docs and Word, so you click into the new row to type.
- The link dialog accepts web addresses, email addresses (turned into `mailto:`), and `mailto:`/`tel:` links; anything else (for example `javascript:`) shows an error and isn't applied. **Cmd/Ctrl+K** opens it too. With the caret in a link, it opens as **Edit link** with a **Remove link** button. There's no hover preview card like Google Docs has.
- While the link dialog is open, the selected words aren't highlighted in the document.
- Images resize from their corners only, always keeping their proportions. There's no alt-text editor or text wrapping.
- A header row is exported to Word as a repeating header row. Header rows don't repeat at the top of each page inside SuiteLeaf.
