# 53 · Link a cell

**Mode:** single-node · **App:** Sheets · **Video:** [videos/53-link-a-cell.mp4](videos/53-link-a-cell.mp4) · **Script:** [scenes/53-link-a-cell.spec.ts](scenes/53-link-a-cell.spec.ts)

## Who and why

Priya keeps the club's supplier list in a sheet. Column A is the supplier name and column B should open that supplier's page. In Google Sheets she selects the name, presses Ctrl/Cmd+K, and types the address. In SuiteLeaf, Insert › Link and Ctrl/Cmd+K do nothing, and an Excel file that already has those links opens with the words kept and the addresses gone.

## Inspired by

- [Insert or edit a link in Sheets](https://support.google.com/docs/answer/45893): select the cell, Ctrl/Cmd+K, type the address, Apply.
- Excel import used to keep hyperlink labels and drop the targets (`packages/core/src/excel.ts`).
- Insert › Link in Sheets used to do nothing. Docs already rejects `javascript:` addresses; Sheets uses that same check (`linkTarget`).

## Scenes

1. **The list.** Priya opens "Suppliers". Supplier, Northwind, Contoso, and Fabrikam are plain text.
2. **Add a link.** She selects Northwind, presses Ctrl/Cmd+K, and types `example.org/northwind`. The name stays in its own field. Apply leaves the cell saying Northwind, drawn as a link, with `https://example.org/northwind` in a chip beside it.
3. **Open it.** She clicks the name. The sheet stays. She clicks the address in the chip. It opens in a new tab.
4. **Edit it.** Insert › Link opens the same dialog, with Remove link. She changes only the address to `example.org/northwind/orders`. The label stays Northwind.
5. **Keep it.** Download writes the link into the SuiteLeaf file. Opening that copy still shows the orders address.
6. **Remove it.** Remove link leaves the word Northwind and drops the address.
7. **An unsafe address.** She tries `javascript:alert(1)`. The dialog refuses it and the cell stays plain text.
8. **From Excel.** An .xlsx whose cells are hyperlinks opens with each name still linked. Export XLSX writes the addresses back. Opening that workbook again, Fabrikam still points at its page.

## Google Workspace benchmark

In Google Sheets the path is select the cell, Ctrl/Cmd+K (or Insert › Link), type or paste the address, Apply: about 1 shortcut plus typing ([Docs Help](https://support.google.com/docs/answer/45893)). The cell shows the label, and a click opens the page. Editing is the same dialog. People complain that a click both selects the cell and follows the link, so they open links by accident while editing.

## Better than Google Workspace when

1. Ctrl/Cmd+K and Insert › Link open an in-app dialog. Neither does nothing.
2. The cell keeps the label the user typed. The address is separate, and a bare domain becomes `https://`.
3. Activating the link opens the address without leaving the sheet. Selecting the cell to edit does not open it.
4. Edit and Remove link are in the same dialog. Remove keeps the label.
5. An address Docs already rejects, including `javascript:`, is refused and the cell is unchanged.
6. A link survives save and reopen in a SuiteLeaf file.
7. An Excel file's hyperlinks come in as real links, and exporting back to Excel keeps the address, not only the label.

## Success looks like

Priya's supplier names are links. The address sits beside the name, and choosing it opens the page in a new tab. Clicking the name only selects the cell. A downloaded copy and an Excel round trip keep the address.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Ctrl/Cmd+K and Insert › Link open a dialog | Met | Video 0:08 (Cmd+K, Insert link) and 0:22 (Insert › Link, Edit link). `tests/browser/sheet-links.spec.ts` |
| 2. Label stays separate; a bare domain becomes https:// | Met | Video 0:12: Northwind stays the cell text; the chip shows `https://example.org/northwind`. `tests/sheet-links.test.ts` |
| 3. Opening the address leaves the sheet; selecting the cell does not follow it | Met | Video 0:15–0:18: the pointer clicks Northwind and the sheet stays, then the chip opens a new tab. Browser test asserts no popup on the cell click |
| 4. Edit and Remove are in the same dialog; Remove keeps the label | Met | Video 0:22 (Remove link in Edit link) and 0:36 (Northwind remains, chip gone) |
| 5. `javascript:` is refused and the cell is unchanged | Met | Video 0:40: the dialog says to enter a web address, and Northwind stays plain text. Same refusal as Docs via `linkTarget` |
| 6. A link survives save and reopen | Met | Video 0:28–0:34: Download, then the reopened copy still has the orders address. Browser test reads the downloaded file |
| 7. Excel hyperlinks import and export as addresses | Met | Video 0:48–1:04: imported names are links; after Export XLSX and reopen, Fabrikam still shows `https://example.org/fabrikam`. `tests/sheet-links.test.ts` round trip |

## Gaps and notes

- Selecting a linked cell shows the address beside it. The cell click does not follow the link, which is the point of the story.
- A formula cell is refused: the dialog asks for a cell that holds words.
- An in-workbook address such as `#Sheet1!A1` is stored when Excel had one, and it is not turned into a web link. The chip does not jump to that cell.
- Dropdowns, cleanup, and function help were left alone.
