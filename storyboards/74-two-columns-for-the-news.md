# 74 · Two columns for the news

**Mode:** single-node · **App:** Docs · **Video:** [videos/74-two-columns-for-the-news.mp4](videos/74-two-columns-for-the-news.mp4) · **Script:** [scenes/74-two-columns-for-the-news.spec.ts](scenes/74-two-columns-for-the-news.spec.ts)

## Who and why

Nia writes the garden-club newsletter. The title should span the page. The three short items under it should sit in two columns, so the page does not look like a single skinny paragraph. Google Docs makes her insert a section break before the columns, then open Format, Columns, and More options.

## Inspired by

- [Add columns](https://support.google.com/docs/answer/1213664): Format › Columns, then a flyout. More options is a second dialog for the gap.
- People column the title by accident because columns apply to the whole section, and a section break is easy to miss.
- SuiteLeaf paragraphs have no column layout. The page is one stream of text.

## Scenes

1. **The newsletter.** Nia opens "Garden club news". A heading sits above three short items, all in one column.
2. **The body only.** She selects the three items, not the heading, and chooses Two columns from one control. No section-break step and no second dialog.
3. **The page.** The heading still spans the page. The three items flow down the left column and continue in the right. She can still edit a word in either column.
4. **Back to one.** She selects the items and chooses One column. The heading and the items are one stream again.
5. **Save and Word.** She sets Two columns again, reopens the SuiteLeaf file, and the heading is still full width while the items are still in two columns. The exported .docx keeps that split.

## Google Workspace benchmark

In Google Docs the path is a section break, then Format, Columns, then More options if the gap matters ([Docs Help](https://support.google.com/docs/answer/1213664)). The title often falls into the columns with the body.

## Better than Google Workspace when

1. Two columns is one control on the selection. No section-break step and no second dialog.
2. A heading outside the selection stays full width.
3. The selected paragraphs flow into a left column and then a right column, with a visible gap.
4. Choosing One column puts those paragraphs back into a single stream and leaves the heading full width.
5. The split survives save and reopen.
6. The exported .docx keeps the heading full width and the selected paragraphs in two columns.

## Success looks like

The newsletter title spans the page. The three items sit in two columns under it. Reopening the file, and the Word file, keep that split.

## Gaps and notes

- There is no column layout on paragraphs today.
- Three columns and a custom gap are out of scope. One and two are enough.
- Do not change page size, headers, watermarks, or line spacing.
