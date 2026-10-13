# 33 · Start from a template

**Mode:** single-node · **App:** Home · **Video:** [videos/33-start-from-a-template.mp4](videos/33-start-from-a-template.mp4) · **Script:** [scenes/33-start-from-a-template.spec.ts](scenes/33-start-from-a-template.spec.ts)

## Who and why

Tomás runs a two-person bakery. This week he needs an invoice for a café that orders bread, notes for a meeting with his landlord, and a short deck for a farmers' market application. He doesn't want to design any of them from a blank page. Once his invoice looks right, he wants to reuse it every month without accidentally overwriting last month's.

## Inspired by

- WF-A4-04 in [docs/workflows-and-expected-behavior.md](../docs/workflows-and-expected-behavior.md): open the templates page and create a file from a template ("partial: native sample files act as templates; no remote template store").
- [Docs Editors Help: Use templates](https://support.google.com/docs/answer/148833): Template gallery at the top of the Docs, Sheets, or Slides home, and File › New › From a template. "Some template features are only available for work or school accounts."
- [r/googledocs: save and create your own templates](https://www.reddit.com/r/googledocs/comments/v8mm49/is_there_a_way_to_save_andor_create_your_own/): personal accounts copy a master document or change "edit" to "copy" in the URL.
- [Technobezz: create a template in Google Docs](https://www.technobezz.com/how-to-create-a-template-in-google-docs): "A personal Google account does not support organization-gallery submissions."
- [All Things How: can't see templates in Docs or Sheets](https://allthings.how/how-to-fix-it-if-you-cant-see-templates-in-google-docs-or-sheets-2/): a home-screen setting hides the gallery, and some editions have no templates.
- [Google Developer forums: template gallery](https://discuss.google.dev/t/template-gallery/167352/3): since October 2023, creating from a template you don't own has been restricted on desktop.

## Scenes

1. **Home.** Tomás opens SuiteLeaf. Under the three "New" cards there's a row titled "Start from a template" with Invoice, Meeting notes, Budget, Project tracker, Pitch deck, Letter, and Announcement (a second presentation, so slides aren't a single card), plus **Template gallery ›**.
2. **Browse.** He clicks Template gallery. A full-page view groups templates by Documents, Spreadsheets, and Presentations, with a search box. He types "inv" and Invoice is the only result.
3. **Preview.** Clicking Invoice opens a large preview of the sheet with its formulas visible as results ("Total $0.00"). **Use template** and **Cancel** sit underneath. Esc closes the preview without creating anything.
4. **Create.** From Home he clicks Invoice, then Use template. A spreadsheet opens titled "Invoice" with the title box selected. He types "Invoice · Café Lune · October" and fills in sourdough (24 × $6.50) and rye (12 × $7). The total becomes $240.00.
5. **Make it his.** He types "Hearth & Rye" in From and inserts a logo, then chooses File › Save as template. The dialog starts from the file's name with the month removed ("Invoice · Café Lune"). He names it "Bakery invoice" and clicks Save. It appears on the home row.
6. **Reuse next month.** He clicks "Bakery invoice" on Home. A new file opens with the logo, the name, and the two lines. He retitles it "Invoice · Café Lune · November" and changes the sourdough quantity to 40; the total becomes $344.00. October is still 24 loaves and $240.00, and the template preview is too.
7. **From inside an editor.** He starts Meeting notes, titles it "Landlord meeting", and adds "Rent is due Friday." under Next steps. File › New › From template opens the gallery filtered to Documents. He starts a fresh Meeting notes file.
8. **Offline.** With the network off, he opens the gallery and creates a deck from "Pitch deck". The title slide opens.
9. **Tidy up.** In the gallery, the ⋯ menu on "Bakery invoice" offers Rename and Remove. He removes it. October's invoice, November's invoice, the notes, and the pitch deck are still in the library.

## Google Workspace benchmark

From the Docs, Sheets, or Slides home it takes 2 clicks: Template gallery (1), then a template (1), which opens a copy named after the template. From inside a file it's File › New › From a template (3 clicks), which opens the gallery in a new tab ([Docs Help](https://support.google.com/docs/answer/148833)). There's no preview step: clicking a template makes a file in your Drive, so a curious click leaves an extra file behind.

Known pain points:

- Personal accounts can't add their own templates to the gallery. The workarounds are copying a master file or editing the URL ([r/googledocs](https://www.reddit.com/r/googledocs/comments/v8mm49/is_there_a_way_to_save_andor_create_your_own/), [Technobezz](https://www.technobezz.com/how-to-create-a-template-in-google-docs)).
- The gallery can disappear because of a home-screen setting, and some editions don't have it ([All Things How](https://allthings.how/how-to-fix-it-if-you-cant-see-templates-in-google-docs-or-sheets-2/)).
- Organization templates you don't own can't be created from the gallery on desktop ([Developer forums](https://discuss.google.dev/t/template-gallery/167352/3)).
- Copying a master by hand risks editing the master itself.

## Better than Google Workspace when

1. Home shows at least two templates for each of Docs, Sheets, and Slides without opening another page, and the full gallery is 1 click away.
2. Creating a file from a template takes at most 2 clicks from Home (the template, then Use template), and the new file opens with its title selected for renaming.
3. Every template has a preview before any file is created, and closing the preview creates nothing (the file count is unchanged).
4. The built-in templates work with no network connection: a test with the network blocked creates a file from each one.
5. File › Save as template adds the current file to "Your templates" in at most 2 clicks, with no account or organization needed.
6. Editing a file made from a template never changes the template, and removing a template never changes files made from it.
7. Spreadsheet templates contain live formulas: changing a quantity in the Invoice template's copy updates its total.
8. File › New › From template in each editor opens the gallery filtered to that app's file type.

## Success looks like

- Tomás has October's and November's invoices, both started from "Bakery invoice". November's quantity change did not touch October or the template, and removing the template left both invoices in the library.
- He has "Landlord meeting" plus a fresh Meeting notes file, and a pitch deck created with the network off.

## Gaps and notes

- Templates are stored on this computer, separate from the file library. There is no shared or organization gallery.
- The preview evaluates `SUM`, `IF`, and `+ - * /`. A formula it doesn't understand shows the value Univer saved, or the formula text.
- A logo on a spreadsheet is a floating image at the top of the sheet. It does not repeat as a page header.
- Built-in templates can't be renamed or removed. "Your templates" can.
- The sample document, budget, and presentation are still the separate "Explore a sample" strip. They are not the templates.

## Result

| Criterion | Met | Evidence |
| --- | --- | --- |
| 1. Home shows at least two templates for each app, gallery one click away | Met | 0:02 home row (Invoice, Budget, Project tracker; Meeting notes, Letter; Pitch deck, Announcement) and Template gallery. `home shows two templates of each kind` |
| 2. Create from Home in at most 2 clicks, title selected | Met | 0:13 the new invoice is open and the caption is on the selected title; he has renamed it to Invoice · Café Lune · October. `using a template opens a new file with the title selected` |
| 3. Preview before any file is created; closing creates nothing | Met | 0:08 preview shows Total $0.00; Escape returns to an empty library. `previewing a template creates nothing` |
| 4. Built-in templates work offline | Met | 0:56 the Pitch deck preview opens with the network off; 0:58 the deck itself is open. `built-in templates create a file with the network blocked` creates all seven |
| 5. Save as template in at most 2 clicks, no account | Met | 0:28 File › Save as template has opened the naming dialog (two clicks) with no account. Enter confirms; the video clicks Save after he types "Bakery invoice". `Save as template takes two menu clicks` |
| 6. Editing a copy never changes the template; removing it never changes files | Met | 0:39 November is 40 / $344.00; 0:43 October is still 24 / $240.00; 0:47 the template preview is still 24 / $240.00; 0:62 both invoices remain after Remove. Unit test `keeps a saved template independent of the file` |
| 7. Invoice formulas update the total | Met | 0:26 October's total is $240.00; 0:39 November's total is $344.00. `an invoice copy keeps live formulas` expects `=SUM(D6:D8)` → 240 |
| 8. File › New › From template filters to that app | Met | 0:53 the gallery says "Showing documents" and lists Meeting notes and Letter; 0:54 a fresh Meeting notes file is open. `File › New › From template filters to that editor` also covers spreadsheets and presentations |
