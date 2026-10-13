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

1. **Home.** Tomás opens SuiteLeaf. Under the three "New" cards there's a row titled "Start from a template" with cards for Invoice, Meeting notes, Budget, Project tracker, Pitch deck, and Letter, plus **Template gallery ›**.
2. **Browse.** He clicks Template gallery. A full-page view groups templates by Documents, Spreadsheets, and Presentations, with a search box. He types "inv" and Invoice is the only result.
3. **Preview.** Clicking Invoice opens a large preview of the sheet with its formulas visible as results ("Total $0.00"). **Use template** and **Cancel** sit underneath. Esc closes the preview without creating anything.
4. **Create.** He clicks Use template. A spreadsheet opens titled "Invoice" with the title box selected. He types "Invoice · Café Lune · October" and fills in two lines. The total updates.
5. **Make it his.** He adds the bakery's name and logo, then chooses File › Save as template. A dialog suggests "Bakery invoice". He clicks Save, and it appears under "Your templates" in the gallery and on the home row.
6. **Reuse next month.** In November he clicks "Bakery invoice" on Home. A new file opens with his logo and layout. October's invoice is unchanged, and so is the template.
7. **From inside an editor.** Writing the meeting notes, he wants a fresh agenda, so he chooses File › New › From template. The gallery opens filtered to Documents.
8. **Offline.** At the market with no signal, he opens the gallery and creates a pitch deck from "Pitch deck". Everything works.
9. **Tidy up.** In the gallery, the ⋯ menu on "Bakery invoice" offers Rename and Remove. Removing a template doesn't affect any file made from it.

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

- Tomás has October's and November's invoices, both from "Bakery invoice", and the template is unchanged.
- He made meeting notes and a pitch deck from templates, one of them offline.

## Gaps and notes

- **No templates or gallery.** The home screen's `NewCards` creates a blank document, spreadsheet, or presentation, and the File menu only has New document, New spreadsheet, and New presentation.
- **The three samples are hidden once you have files.** "Sample document", "Sample budget", and "Sample presentation" (`samples.ts`) only appear in the empty state, when the library has no files. They're the natural first templates.
- There's no Save as template, and the library has no notion of a template (`storage.ts` and `browser-library.ts` store ordinary file records only).
- Nothing previews a file without opening it, so the gallery needs a thumbnail renderer for each file type.
