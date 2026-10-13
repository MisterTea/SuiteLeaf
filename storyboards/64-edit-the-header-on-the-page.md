# 64 · Edit the header on the page

**Mode:** single-node · **App:** Docs · **Video:** [videos/64-edit-the-header-on-the-page.mp4](videos/64-edit-the-header-on-the-page.mp4) · **Script:** [scenes/64-edit-the-header-on-the-page.spec.ts](scenes/64-edit-the-header-on-the-page.spec.ts)

## Who and why

Ben has the minutes open and wants to change the running header from "Garden club minutes" to "October minutes". Page setup can do it, but he has to leave the page, open a dialog, and type into a field he cannot see on the sheet. In Word and Google Docs he clicks the header on the page and types.

## Inspired by

- [Add or change headers and footers](https://support.google.com/docs/answer/86629): double-click the top or bottom margin and type. The rest of the document dims.
- Storyboards [07](07-page-setup-and-export.md), [61](61-different-first-page.md), and [62](62-odd-and-even-pages.md): headers exist and can differ by page, and they are edited only in Page setup.
- The header on the page is a plain div in `apps/web/src/editors/Docs.tsx`, not a text box.

## Scenes

1. **The minutes.** Ben opens "Minutes". The header on page 2 reads "Garden club minutes".
2. **Click the header.** He double-clicks that header. The minutes dim, the whole header is selected, and a label says "Header · all pages". Page setup does not open.
3. **Type.** He types "October minutes". The page shows it before he leaves the header.
4. **Back to the minutes.** A click on the body closes the header. The minutes are unchanged, and the text is no longer dim.
5. **Every page.** Page 1 says "October minutes" too. This document has one shared header.
6. **The footer.** He double-clicks the footer. The page number stays in its own pill. He types "Draft" beside it.
7. **Escape.** Escape closes the footer. "Draft" and the number both stay.
8. **Save.** He reopens the file. The header still says "October minutes", and the footer still says "Draft" next to the number.

## Google Workspace benchmark

In Google Docs, double-click the margin, type, and click back in the document ([Docs Help](https://support.google.com/docs/answer/86629)). The header area is short, so the caret is easy to miss, and a click sometimes selects the body instead. Different first page and odd/even headers are easy to edit in the wrong one.

## Better than Google Workspace when

1. Double-clicking the header on the page places a caret in that header. Page setup does not open.
2. Typing replaces the header text, and the page shows it before the editor closes.
3. The body text is dimmed while the header is being edited, and it is unchanged afterward.
4. Double-clicking the footer edits the footer. The page number remains a number.
5. If Different first page or odd and even pages are on, the click edits the header for that page only. The other pages do not change.
6. Escape or a click in the body leaves the header editor. The new text survives save and reopen.

## Success looks like

Ben changes the running header by typing on the page. The header says "October minutes". The footer says "Draft" beside the page number. The minutes themselves are the same.

## Gaps and notes

- Different first page and odd/even headers are not page settings on this base. Storyboards 61 and 62 describe them, and the code still stores one header and one footer for the whole document. A double-click edits that shared text. The blue label says "Header · all pages" or "Footer · all pages" so the scope is visible. Per-page headers remain for those storyboards.
- The page number is drawn beside the footer text, not inside it, so typing in the footer cannot replace the number.
- Page setup still edits the same header, footer, and page-number choice.
- Letterhead import is unchanged.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| Double-clicking the header places a caret there. Page setup does not open. | Met | Video 0:06. Test `double-click edits the header and footer on the page`. |
| Typing replaces the header, and the page shows it before the editor closes. | Met | Video 0:08, "October minutes" in the open header field. |
| The body dims while editing and is unchanged afterward. | Met | Video 0:06 (dimmed "Decisions") and 0:21 (same minutes, full contrast). |
| Double-clicking the footer edits the footer. The page number stays a number. | Met | Video 0:17–0:19, "Draft" beside "1 / 2". Test asserts "2 / 2" is unchanged too. |
| If different first page or odd/even headers are on, the click edits only that page. | Not on this base | Those settings are not implemented. The shared header is what a click edits. See Gaps. |
| Escape or a click in the body leaves the editor. The text survives save and reopen. | Met | Click at 0:09, Escape at 0:21, reopen at 0:27. Test reopens "Minutes". |
