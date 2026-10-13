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

## AI version

**Script:** [scenes/ai/05-tables-images-and-links-ai.spec.ts](scenes/ai/05-tables-images-and-links-ai.spec.ts) · **Video:** [videos/05-tables-images-and-links-ai.mp4](videos/05-tables-images-and-links-ai.mp4) · **Desktop video:** [videos/electron/05-tables-images-and-links-ai.mp4](videos/electron/05-tables-images-and-links-ai.mp4)

Asha starts on the home screen, opens the assistant and types one request:

> Make a new document called Seed swap sign-up. Put the heading Seed swap at the top, then the line: Bring seeds to share on Saturday 14 November at the garden shed. Then add a sign-up table with the columns Name, Bringing and Hoping for, and these sign-ups in this order: Asha brings Runner beans and hopes for Chillies; Marek brings Calendula and hopes for Squash; Priya brings Tomatoes and hopes for Herbs; Joy brings Sweet peas and hopes for Anything! Below the table write "Last year's swap table:" and add a photo I'll pick. Finish with the line: Full rules are on the club website. Link the words club website to example.org/seed-swap.

When Gemma asks for the photo, a "Choose a photo to insert" card appears in the panel and Asha picks `garden.png` herself. The script checks the original's end state: a 5-row, 3-column table whose first row is a header row, with the sign-ups in order; the photo below "Last year's swap table:" and outside the table; "club website" linked to `https://example.org/seed-swap` inside "Full rules are on the club website."; and the file saved. Asha then shrinks the photo by dragging a corner, because no assistant tool resizes photos. The script checks that it got smaller and that the status reads "Saved on this device" ("Draft saved" on desktop).

**Tools used:** `create_file`, `write_text` (for the heading and line, "Last year's swap table:" with `after: "table"`, and the rules line with `after: "photo"`), `insert_table` (all five rows in one call, with `header_row`), `insert_image` and `insert_link`.

**What the recordings show.** The purple pointer goes to Insert table on the toolbar, and the whole table appears filled in, with the bold, shaded header row. The pointer then goes to Insert image while the panel asks for the photo. Once Asha picks it, the photo appears under its line. The rules line is typed below the photo, and the pointer lands on "club website" as the words turn into a link. The assistant's part took 28 to 39 seconds on the web build (WebGPU), or 87 seconds in the first run, and 19 to 31 seconds on desktop (llama.cpp). Then Asha resizes the photo, and the document reads top to bottom: heading, line, table, photo line, photo and link.

**How Gemma did.** After the last fix, it passed 3 out of 3 web runs and the final desktop run, with no tool errors. Across the whole loop it passed 5 of 6 web runs and 2 of 3 desktop runs. Gemma always set out the table correctly, as a header row plus four rows in order. The failures and errors were about where to put things after the table and photo, and about writing the table's arguments:
- **"Below the table" had no way to say it** (web run 2). Gemma wrote `after: "[Table]"`, then `after: "[Image]"`, and in between `insert_image` with `after: "Photo should be inserted after …"`. All three failed. It then linked "club website" anyway (the tool added those words on their own at the end) and said it had added the finishing line, the photo and the table line. None of that had happened. `write_text`, `insert_table` and `insert_image` now take "table" or "photo" (or text from a table cell, or the photo's file name) to mean "right below it". `insert_link` now says when it had to add the words itself. Since then Gemma has used `after: "table"` and `after: "photo"` in every run.
- **Too many brackets on desktop** (desktop run 1). llama.cpp wrote the rows as `cells: [[[…], […]]` with one `[` too many. It retried the same broken call six times, because the error it got back ("cells: must have required properties") hid the real problem. Before that, it had made an empty 3×1 table and typed the column names as a paragraph. The parser now drops a surplus `[`, and an unreadable call is reported as unreadable.
- **Quoting the photo's file name** (desktop run 2). Gemma wrote `after: "garden.png"`, which failed once before it switched to "photo". The file name now works.

## Gaps and notes

- The same table commands are under **Format → Table** in the menu bar (greyed out when the caret isn't in a table). After **Insert row above/below** the caret stays where it was, as in Google Docs and Word, so you click into the new row to type.
- The link dialog accepts web addresses, email addresses (turned into `mailto:`), and `mailto:`/`tel:` links; anything else (for example `javascript:`) shows an error and isn't applied. **Cmd/Ctrl+K** opens it too. With the caret in a link, it opens as **Edit link** with a **Remove link** button. There's no hover preview card like Google Docs has.
- While the link dialog is open, the selected words aren't highlighted in the document.
- Images resize from their corners only, always keeping their proportions. There's no alt-text editor or text wrapping.
- A header row is exported to Word as a repeating header row. Header rows don't repeat at the top of each page inside SuiteLeaf.
