# 53 · Link a cell

**Mode:** single-node · **App:** Sheets · **Video:** [videos/53-link-a-cell.mp4](videos/53-link-a-cell.mp4) · **Script:** [scenes/53-link-a-cell.spec.ts](scenes/53-link-a-cell.spec.ts)

## Who and why

Priya keeps the club's supplier list in a sheet. Column A is the supplier name and column B should open that supplier's page. In Google Sheets she selects the name, presses Ctrl/Cmd+K, and types the address. In SuiteLeaf, Insert › Link and Ctrl/Cmd+K do nothing, and an Excel file that already has those links opens with the words kept and the addresses gone.

## Inspired by

- [Insert or edit a link in Sheets](https://support.google.com/docs/answer/45893): select the cell, Ctrl/Cmd+K, type the address, Apply.
- Excel import in `packages/core/src/excel.ts`: "Hyperlink cell labels are preserved; hyperlink targets are not recreated."
- Insert › Link in `apps/web/src/App.tsx` has an empty click handler. Docs already has a link dialog that rejects `javascript:` addresses.

## Scenes

1. **The list.** Priya opens "Suppliers" and sees names in column A with no links.
2. **Add a link.** She selects "Northwind", presses Ctrl/Cmd+K, types `example.org/northwind`, and applies. The cell text stays "Northwind" and is shown as a link.
3. **Open it.** She clicks the link. It opens `https://example.org/northwind`. The sheet does not navigate away.
4. **Edit it.** She selects the cell again, opens the link dialog, and changes the address to `example.org/northwind/orders`. Apply keeps the label.
5. **Remove it.** Remove link leaves the words "Northwind" and drops the address.
6. **An unsafe address.** She tries `javascript:alert(1)`. The dialog refuses it and the cell is unchanged.
7. **From Excel.** She opens a workbook whose cells are hyperlinks. Each label still opens its address. She downloads the sheet and opens it again. The links are still there.

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

Priya's supplier names are links. Clicking "Northwind" opens the orders page. The label is still the name. A downloaded copy and an Excel round trip keep the address.

## Gaps and notes

- Insert › Link and Ctrl/Cmd+K in Sheets call an empty handler.
- Excel import keeps the visible label and drops the hyperlink target.
- Docs already has the safe-link check. Sheets should use that, not a second policy.
- Do not rebuild dropdowns, cleanup, or function help. Those are other storyboards.
