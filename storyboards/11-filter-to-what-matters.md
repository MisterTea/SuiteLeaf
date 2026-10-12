# 11 · Filter to what matters

**Mode:** single-node · **App:** Sheets · **Video:** [videos/11-filter-to-what-matters.mp4](videos/11-filter-to-what-matters.mp4) · **Script:** [scenes/sheets.spec.ts](scenes/sheets.spec.ts)

## Who and why

Jo runs a small online shop and keeps orders in a spreadsheet. Each morning she only cares about orders that are still Pending. She wants to hide the rest for a few minutes, not delete them or copy them somewhere else.

## Inspired by

- [Google Docs Editors Help: Sort & filter your data](https://support.google.com/docs/answer/3540681): Data › Create a filter, use the header's filter button to filter by values, and Remove filter to turn it off.
- [r/googlesheets: Filter/Slicer behavior](https://www.reddit.com/r/googlesheets/comments/1r4m9cx/filterslicer_behavior/): narrowing a list takes many clicks (Clear, type, Select all, OK), and clearing filters is tedious.
- *Ultimate Guide to Google Sheets*, ch. 1: a filter restricts the visible rows (WF-B1-03 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md)).

## Scenes

1. **Open the orders.** Jo opens "Shop orders": Order, Customer, Status and Total for ten orders.
2. **Create a filter.** She selects A1:D11 and clicks the funnel in the toolbar ("Create a filter"). Each header cell gets a filter button and the funnel shows as pressed.
3. **What everything adds up to.** She drags down the Total column (D2:D11). The status bar reads Sum: 615.44 for all ten orders.
4. **Open the Status filter.** Its panel offers Ascending/Descending, By Values, By Colors and By Conditions. By Values lists Cancelled (2), Pending (4) and Shipped (4).
5. **Pick values.** Clicking the name "Shipped" unticks it (6/10), as it would in Sheets. Hovering Pending reveals "Filter Only", which keeps just Pending in one click (4/10). She confirms.
6. **Just the pending orders.** Four rows remain (#1042, #1045, #1047, #1050). The row numbers skip (1, 3, 6, 8, 11), which shows the other rows are hidden, not deleted. The Status filter button turns solid.
7. **What's still to ship.** With the Total column still selected, the status bar drops to Sum: 228.44, counting only the visible orders.
8. **Clear it.** She reopens the Status filter and clicks "Clear Filter". All ten orders are back and the sum returns to 615.44.
9. **Remove the filter.** Data › Remove filter (the funnel does the same) removes the filter buttons.

## Success looks like

- While filtered, only the four Pending rows are visible. The saved filter records the Pending criterion and hides rows 2, 4, 5, 7, 9 and 10.
- The status bar's Sum always matches the visible rows: 615.44 unfiltered, 228.44 filtered to Pending, without reselecting.
- After clearing and removing, every row is visible and the file has no filter.

## Gaps and notes

- Fixed: the status bar kept counting rows a filter had just hidden (or kept the filtered total after clearing) until the selection changed. Sheets and Excel aggregate only visible rows. It now recalculates whenever a filter, or hiding/showing rows, changes what's visible.
- Fixed: clicking a value's name or count (or the "Select All" text) didn't toggle its checkbox; only the small box did.
- Fixed: Data › "Create a filter" kept that label while a filter was on, and choosing it removed the filter. It now reads "Remove filter", as in Sheets.
- View › "Toggle filter" duplicates the Data menu item; Sheets keeps filters only under Data (View menu is covered by storyboard 12).
- The Sum readout is small gray text at the bottom right. Sheets shows a more prominent chip with a menu for Average, Count, Min and Max. Excel also shows "4 of 10 records found" while filtering.
- There are no named filter views (Sheets' "Filter views"), so a filter changes the sheet for everyone who opens the file.