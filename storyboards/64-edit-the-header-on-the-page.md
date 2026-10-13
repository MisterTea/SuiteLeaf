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
2. **Click the header.** He double-clicks that header. The document text dims, and a caret appears in the header. He does not open Page setup.
3. **Type.** He selects the words and types "October minutes". Page 2 shows the new header immediately.
4. **The footer.** He clicks the footer and types nothing over the page number. The number stays. He adds "Draft" beside it.
5. **Escape.** Escape returns him to the document. The body text is unchanged.
6. **Save.** He reopens the file. Page 2 still says "October minutes", and the footer still says "Draft" next to the number.

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

Ben changes the running header by typing on the page. Page 2 says "October minutes". The minutes themselves are the same.

## Gaps and notes

- Headers and footers are drawn on the page and edited only in Page setup.
- Different first page and odd/even headers may live on other branches. If they are present, a click must edit the header that belongs to that page. If they are not present yet, editing the shared header is enough, and say so in Gaps and notes.
- Do not rebuild letterhead import.
