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

## AI version

**Videos:** [web](videos/11-filter-to-what-matters-ai.mp4) · [desktop](videos/electron/11-filter-to-what-matters-ai.mp4) · **Script:** [scenes/ai/11-filter-to-what-matters-ai.spec.ts](scenes/ai/11-filter-to-what-matters-ai.spec.ts)

Jo opens the same "Shop orders" workbook and asks the on-device assistant (Gemma 4 E4B) twice, once each morning moment:

1. *Show me only the orders that are still waiting to ship. What do they add up to?*
2. (After packing) *All packed, thanks. Show me all the orders again and take the filter off.*

The request never says "Pending" or "Status". Gemma works out from the values that "waiting to ship" means Pending.

**Tools Gemma used:** `filter_rows` with `column: "Status"` and `show_values: ["Pending"]`, which creates the filter and filters it in one call. Then `clear_filter` with `remove: true`. That is the whole run: one tool call per request.

**What the recording shows:** The pointer moves to the Status header, the filter buttons appear, and only rows 3, 6, 8 and 11 stay visible. Gemma replies that the pending orders add up to 228.44. Jo selects D2:D11 herself, and the status bar agrees: Sum: 228.44. The test downloads the file (Save As on desktop) and checks that the saved filter has one criterion, Pending, hiding rows 2, 4, 5, 7, 9 and 10. It also checks that Gemma's answer says 228.44. For the second request the pointer moves to the funnel. All ten rows come back, the funnel is no longer pressed, and the sum returns to 615.44 without Jo reselecting. The saved file has no filter.

**How Gemma did:** On the final code the web recording passed 3 of 3 runs and desktop (llama.cpp) passed 1 of 1. The first request takes about 15–35 seconds, including about 10 seconds to load the model. The second takes 2–9 seconds. Gemma always chose the right column, value and tools. Model mistakes seen:
- Before the fix below, it read D2:D11 twice in a row with the same call. Then it answered "the total is 327.14". That is neither the pending total (228.44) nor the total of all orders (615.44).
- Once it described the four orders as "range from #1042 to #1050". That's true, but it could suggest all the orders in between.

Fixed while making it: `read_sheet` and the app state listed rows the filter had hidden as if they were showing, so Gemma had no way to tell which totals counted. `filter_rows` only said "4 row(s) shown". Now hidden rows are left out of every cell listing, with a note saying which rows are hidden. `filter_rows` shows the rows that remain and the sum of each number column over them, as the status bar does for a selection. `read_sheet` adds the same sums when rows in its range are hidden. The app state now names the filter's column and values and how many rows it hides. `clear_filter` says whether the filter buttons stayed and how many rows are showing.

## Gaps and notes

- Fixed: the status bar kept counting rows a filter had just hidden (or kept the filtered total after clearing) until the selection changed. Sheets and Excel aggregate only visible rows. It now recalculates whenever a filter, or hiding/showing rows, changes what's visible.
- Fixed: clicking a value's name or count (or the "Select All" text) didn't toggle its checkbox; only the small box did.
- Fixed: Data › "Create a filter" kept that label while a filter was on, and choosing it removed the filter. It now reads "Remove filter", as in Sheets.
- View › "Toggle filter" duplicates the Data menu item; Sheets keeps filters only under Data (View menu is covered by storyboard 12).
- The Sum readout is small gray text at the bottom right. Sheets shows a more prominent chip with a menu for Average, Count, Min and Max. Excel also shows "4 of 10 records found" while filtering.
- There are no named filter views (Sheets' "Filter views"), so a filter changes the sheet for everyone who opens the file.