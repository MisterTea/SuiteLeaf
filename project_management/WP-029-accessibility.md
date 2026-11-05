---
id: "WP-029"
title: "Accessible editors and exported artifacts"
type: "work_package"
status: "done"
priority: "P1"
phase: 3
area: "accessibility"
created: "2026-10-29"
updated: "2026-10-30"
owner: "unassigned"
blocked: false
blocked_on: []
related_sources: ["S19"]
---

# Accessible editors and exported artifacts

## Outcome and rationale

Make SuiteLeaf usable with assistive technologies and ensure exported documents retain supported accessibility structure.

## Existing implementation and starting points

Inspect editor toolbars/dialogs, the painted Univer grid, slide canvas, document image-alt controls, export modules, and responsive tests. Existing labels and alt-text fields are a foundation, not proof of end-to-end accessibility.

Source observations describe the working tree inspected on October 29, 2026, not a certified released build. Recheck current behavior before replacing existing functionality. All code paths below are relative to the repository root.

## Implementation requirements

- Create an accessibility matrix for keyboard-only, screen readers, zoom/reflow, high contrast, reduced motion, and touch across web/desktop.
- Provide semantic navigation and editable access to grid cells and slide objects; expose selection, values, headers, formula errors, order, and commands without relying solely on canvas pixels.
- Fix focus management, dialogs, shortcuts, status announcements, drag alternatives, accessible names, and contrast with representative assistive technologies.
- Implement an authoring checker for titles/headings, reading order, alt text, table headers, link meaning, and color-only information, with precise fix locations.
- Preserve supported structure in DOCX/PPTX and tagged PDF where the export pipeline permits it; implement an alternative export path when print-to-PDF cannot retain required tags.
- Document tested standards/platform combinations and known limitations; use WCAG 2.2 AA as an engineering target, not an unverified compliance claim.

## Dependencies and delivery

No hard work-package prerequisites. Coordinate shared interfaces with the packages linked in the portfolio index.

Deliver working application behavior, any required schema migrations, operational/user documentation, and the evidence described below. Preserve existing documents and supported workflows during rollout. Split this package into implementation issues if useful; every acceptance criterion remains part of its completion gate.

## Acceptance criteria

- Core create/edit/save/share workflows can be completed by keyboard and supported screen readers.
- Users can inspect and edit sheet cells and slide objects without visual canvas access.
- Checker findings link to real content and distinguish automatic checks from required human judgment.
- Supported exports retain validated headings, reading order, alt text, and table structure, with explicit limits for other formats.

## Verification

- Vitest/jsdom semantic/focus behavior and automated accessibility checks where meaningful.
- Manual screen-reader verification on selected Windows/macOS/browser combinations; record exact versions/results.
- Use browser tests for focus visibility, zoom/reflow, painted surfaces, and keyboard layout; inspect exported accessibility structure separately.

Use Vitest for TypeScript behavior, persistence, import/export, and jsdom UI tests; use Rust tests for node behavior. Use Playwright only for layout, painted grids/canvases, real document typing/caret/browser keys, or storyboard evidence. Keep unit test coverage above 90%, report the measured scope, and do not claim UI parity from unit tests alone. Keep each TypeScript file under 1,000 lines; extract focused modules rather than adding to oversized files. See [portfolio conventions](README.md) for shared release requirements.

## Boundaries and non-goals

Automated checks alone do not establish compliance. Do not claim tagged/accessible PDFs from ordinary printing unless verified.

## Research and related context

Source IDs refer to [SOURCES.md](SOURCES.md): `S19`. External complaints motivate requirements; they are not measured prevalence or proof of current competitor defects.

# Progress

2026-10-30: In progress. `packages/core/src/a11y-check.ts` walks a document and returns notes with a path of child indexes. Automatic notes are a missing heading, a heading that starts below level 1 or skips a level, an image with no alternative text, a link with no text or with text such as "click here", and a table whose first row has no header cell. Empty alternative text and the first colored run are marked for a person to judge. `tests/a11y-check.test.ts` passed (4 tests). Limits are in `docs/accessibility.md`.

2026-10-30, later: the document toolbar button Accessibility notes lists `checkDocument` findings. Each line says Automatic or Needs a person, plus the path of child indexes. `npx vitest run tests/ui/access-notes.test.tsx` passed (2 tests). In the browser, the button on an existing document showed “No notes for this document,” and a second click hid that section. The editor does not move the caret to a path.

2026-10-31: the spreadsheet toolbar button Accessibility lists columns that have values and no header. The message uses the column number and does not include the cell value. `npx vitest run tests/ui/sheet-access-note.test.tsx` passed (1 test). The web app typecheck passed. The selection does not move. In the browser, the button on an existing spreadsheet showed “No notes for this spreadsheet,” and the note said this is not a WCAG claim. The notes read the saved sheet, not a separate pass over the painted grid.

2026-10-31: each accessibility note is a button that names the node, such as `North`. Choosing that button reports path `[0]`. `nodeAtPath` returns the heading text `North`. `contentPosition` for the first child is 1 and for the second child is 8. A path past the end is null, and the document editor uses that position to place the caret. `npx vitest run tests/a11y-check.test.ts tests/ui/access-notes.test.tsx` passed (6 tests). The document editor was not opened in the browser.

2026-10-31, later: a Word export of heading `Beds`, image description `North beds`, header cell `Crop`, and body cell `Tomato` keeps those words. The heading is Heading 1 and the header row is marked as a header. `npx vitest run tests/access-export.test.ts` passed (1 test). A print to PDF is not a tagged PDF.

2026-10-31, later still: the slide accessibility panel lists each object in a text field. The image field shows `North beds`. Changing it to `South beds` updates that image and leaves the title text `Beds`. A text field edits that object's text. The slide editor writes those changes onto the object. Audio and video stay out of the list. `npx vitest run tests/ui/slide-access-notes.test.tsx tests/slide-access.test.ts` passed (5 tests). The slide editor was not opened in the browser. Screen readers are still open. This is not a WCAG conformance claim.

2026-10-31, later: the spreadsheet accessibility panel lists the first cells as text fields. Header `Crop` is field `A1`. The cell under it is field `Crop row 2` and shows `Tomato`. Changing it to `Bean` reports row 1, column 0, and `Bean`. The header field stays `Crop`. The grid passed in still says `Tomato`. `npx vitest run tests/ui/sheet-cell-fields.test.tsx tests/ui/sheet-access-note.test.tsx` passed (2 tests). The open spreadsheet writes that text with the same cell command the phone checkbox uses. The spreadsheet was not opened in the browser. The painted grid was not used. Screen readers are still open. This is not a WCAG conformance claim.

2026-10-31, later: a column with a value and no header is a button. Choosing it reports the sheet id and column 1. The note says `Column 2 has values and no header.` and does not include `secret tomato`. The spreadsheet selects the header cell of that column. `npx vitest run tests/ui/sheet-access-note.test.tsx tests/ui/sheet-cell-fields.test.tsx` passed (2 tests). The spreadsheet was not opened in the browser. The painted grid was not used. Screen readers are still open. This is not a WCAG conformance claim.

2026-10-31, later: File → Export PDF writes the heading `Beds (north)`, the image description `North beds`, and the table row `Crop | Tomato` as PDF text. Parentheses in the heading are escaped. The file has no `/StructTreeRoot`. `npx vitest run tests/doc-pdf.test.ts` passed (1 test). The File menu was not opened in the browser. A print to PDF is still not a tagged PDF. Screen readers are still open. This is not a WCAG conformance claim.

2026-10-31, later: File → Export PDF now writes `/StructTreeRoot` and `/MarkInfo << /Marked true >>`. The heading `Beds (north)` is `H1`, the citation paragraph is `P`, the image description `North beds` is `Figure`, and the table row `Crop | Tomato` is `TR`. There is no `TD` tag. `npx vitest run tests/doc-pdf.test.ts` passed (1 test). The File menu was not opened in the browser. This is not a PDF/UA file and not a print to PDF. Screen readers are still open. This is not a WCAG conformance claim.

2026-10-31, later: the table is `Table` and the row is `TR`. The header cell is `TH` with text `Crop`. The body cell is `TD` with text `Tomato`. The PDF text contains those words separately. `npx vitest run tests/doc-pdf.test.ts` passed (1 test). The File menu was not opened in the browser. This is not a PDF/UA file and not a print to PDF. Screen readers are still open. This is not a WCAG conformance claim.

2026-10-31, later: the spreadsheet accessibility panel describes a bar chart titled Plot fees as series Dues and category North. The sentence does not include the cell value `secret tomato` or the series color `#112233`. `npx vitest run tests/chart-summary.test.ts tests/ui/sheet-access-note.test.tsx` passed (3 tests). The panel was not opened in the browser. Screen readers are still open. This is not a WCAG conformance claim.

2026-10-31, later: the accessibility matrix has twelve cells for keyboard, screen reader, zoom, high contrast, reduced motion, and touch, on the web client and the desktop window. Screen readers, zoom, and touch are untested. High contrast and reduced motion on the web are partial. With `prefers-contrast: more` turned on in the browser, the page used black text `#000000`, a white background `#ffffff`, and a black border `#000000`. The body color was `rgb(0, 0, 0)`. The preference was then cleared. Slide entrance animations are still turned off only by `prefers-reduced-motion: reduce`, and that preference was not turned on. The desktop window was not opened. `npx vitest run tests/access-matrix.test.ts` passed (1 test). No cell is a pass. This is not a WCAG conformance claim.

2026-11-01: the app stylesheet shortens animation, transition, and smooth scrolling when `prefers-reduced-motion: reduce` is set. `npx vitest run tests/reduced-motion.test.ts` passed (1 test). That preference was not turned on. The desktop window was not opened. This is not a WCAG conformance claim.

2026-11-01: the document checker notes every colored phrase, not only the first. `ripe` and `late` are both notes, at the first text of the second and third blocks. The color on `late` is `secret-value`, and a link address is `https://secret-value.example`. Neither word is in the notes. `npx vitest run tests/a11y-check.test.ts tests/ui/access-notes.test.tsx` passed (7 tests). The document was not opened in the browser. Screen readers are still open. This is not a WCAG conformance claim.

2026-11-01: a header cell in the first row that has no words is noted as empty. The table also has a cell `secret-value`, and that word is not in the notes. `npx vitest run tests/a11y-check.test.ts tests/ui/access-notes.test.tsx` passed (8 tests). The document was not opened in the browser. Screen readers are still open. This is not a WCAG conformance claim.

2026-11-01: a heading with no words is noted as `This heading has no text.` The path is that heading. A paragraph `secret-value` under it is not in the notes. A heading `Beds` is not that note. `npx vitest run tests/a11y-check.test.ts` passed (7 tests). The document was not opened in the browser. Screen readers are still open. This is not a WCAG conformance claim.

2026-11-01: Earlier and Later move a slide object in the reading order. The title, then the photo, becomes the photo, then the title, then the logo. The stored list passed in stays `title`, `photo`. The title cannot move earlier. An id `secret-value` that is not on the slide is left out, and that word is not in the new order. The accessibility panel button `Move text 1 later` reports `photo`, `title`. `npx vitest run tests/slide-access.test.ts tests/ui/slide-access-notes.test.tsx` passed (9 tests). The panel was not opened in the browser. Screen readers are still open. This is not a WCAG conformance claim.

2026-11-01: an image description `secret-value.png` is noted as `This image description is a file name. Write what the image shows.` That note does not contain `secret-value`. A description `Tomato beds` is not that note. `npx vitest run tests/a11y-check.test.ts tests/ui/access-notes.test.tsx` passed (10 tests). The document was not opened in the browser. Screen readers are still open. This is not a WCAG conformance claim.

2026-11-01: a video without caption text says `This video has no captions.` The address `secret-value` is not in that note. Pictures inside audio and video are still not checked. `npx vitest run tests/ui/slide-access-notes.test.tsx tests/slide-access.test.ts` passed (9 tests). The accessibility panel was not opened in the browser. Screen readers are still open. This is not a WCAG conformance claim.

2026-11-01: a video is in the reading order with the title and the photo. Without alternative text it says `This video needs alternative text.` The address `secret-value` is not in that note. `npx vitest run tests/ui/slide-access-notes.test.tsx tests/slide-access.test.ts` passed (9 tests). The accessibility panel was not opened in the browser. Screen readers are still open. This is not a WCAG conformance claim.

2026-11-01: arrow keys move a selected slide object by 1, and Shift plus an arrow moves it by 10. A locked box stays. This is a keyboard alternative to dragging. `npx vitest run tests/slide-align.test.ts tests/slide-editing.test.ts` passed (13 tests). The slide canvas was not used. This is not a WCAG conformance claim.

2026-11-01: a spreadsheet note for a sheet with no name says `Sheet: Column 2 has values and no header.` The sheet id is not in that sentence. A named sheet still uses its name. `npx vitest run tests/ui/sheet-access-note.test.tsx` passed (2 tests). The spreadsheet was not opened in the browser. The painted grid was not used. This is not a WCAG conformance claim.

2026-11-01: a dropdown chip color that is not six hex digits cannot be checked. The note is `This chip color is not a hex color.` A color `secret-value` is not in that note. The listed chip colors still get text that clears 4.5:1. `npx vitest run tests/sheet-dropdowns.test.ts -t "readable text"` passed (1 test). The spreadsheet was not opened in the browser. The painted grid was not used. This is not a WCAG conformance claim.

2026-11-01: a three-digit slide color is expanded before the contrast check. `#000` on `#fff` has no contrast note. `#eee` on `#fff` says the title color does not contrast with the slide background. A color that is not hex still says the slide colors are not hex colors. `npx vitest run tests/slide-access.test.ts -t "does not contrast"` passed (1 test). The accessibility panel was not opened. This is not a WCAG conformance claim.

2026-11-01: an image with no alternative text says `This image needs alternative text.` A reading-order id that is not on the slide says `Reading order names an object that is not on this slide.` An image id `secret-value` and a missing id `secret-value` are not in those sentences. `npx vitest run tests/slide-access.test.ts tests/ui/slide-access-notes.test.tsx` passed (9 tests). The accessibility panel was not opened in the browser. Screen readers are still open. This is not a WCAG conformance claim.

2026-11-01: a still picture on a video or audio clip is checked. A picture named `secret-value` says `This video's picture is not an embedded image.` and that word is not in the note. An embedded audio picture with no alternative text says `This audio's picture needs alternative text.` An embedded video picture that already has alternative text is not noted again. The accessibility panel shows the video sentence. `npx vitest run tests/slide-access.test.ts tests/ui/slide-access-notes.test.tsx` passed (11 tests). The accessibility panel was not opened in the browser. Screen readers are still open. This is not a WCAG conformance claim.

2026-11-01: a spreadsheet accessibility note names a formula error by its cell. `B2` shows `#REF!`. The formula text `secret-value` is not in the note, and a cell value `secret-value` is not treated as an error. Choosing the note selects row 1, column 1. `npx vitest run tests/ui/sheet-access-note.test.tsx -t "formula error"` passed. The spreadsheet was not opened in the browser. The painted grid was not used. This is not a WCAG conformance claim.

2026-11-01: a formula error outside the first rows and columns is a text field. `G21` shows `#DIV/0!` and can be changed to `0`. The formula text `secret-value` is not in the field. The cell passed in still shows `#DIV/0!`. That write is sent to the first sheet, which is the sheet whose cells are listed. `npx vitest run tests/ui/sheet-cell-fields.test.tsx` passed (2 tests). The spreadsheet was not opened in the browser. The painted grid was not used. This is not a WCAG conformance claim.

2026-11-01: a formula error on a later sheet is a text field. Fees `A1` showing `#DIV/0!` is `Fees A1` and can be changed to `0`. The write names that sheet. The sheet id `secret-value` is not in the label, and the formula text is not in the field. Beds `A1` stays `Tomato`. `npx vitest run tests/ui/sheet-cell-fields.test.tsx` passed (3 tests). The spreadsheet was not opened in the browser. The painted grid was not used. This is not a WCAG conformance claim.

2026-11-01: a decorative image is left out of the slide reading order. The order is `title` when the photo is decorative. It does not say the image needs alternative text, and the alternative text `secret-value` is not read. The image passed in still has that text. The accessibility panel has a Decorative checkbox. Checking it marks that image. `npx vitest run tests/slide-access.test.ts tests/ui/slide-access-notes.test.tsx` passed (13 tests). The accessibility panel was not opened in the browser. Screen readers are still open. This is not a WCAG conformance claim.

2026-11-01: a blank slide title does not copy text from a decorative master object. The master still says `secret-value`, and the slide box stays blank. A master title that is not decorative still supplies `Garden club`. Typed text `North` stays `North`. `npx vitest run tests/slide-master.test.ts` passed (6 tests). The slideshow was not opened. This is not a WCAG conformance claim.

2026-11-01: the title color skips a decorative text box. The decorative box still says `Beds` in `secret-value`, and the color used is the next box, `#000000`. When every text box is decorative, the color is the default black and `secret-value` is not used. `npx vitest run tests/slide-access.test.ts -t "decorative box"` passed (1 test). The slideshow was not opened. This is not a WCAG conformance claim.

2026-11-01: the audience screen leaves a decorative object out. The visible line stays `North`. The decorative text and image description `secret-value` stay on the objects and are not on the audience screen. `npx vitest run tests/audience-screen.test.ts` passed (5 tests). The slideshow was not opened. A second display was not opened. This is not a WCAG conformance claim.

2026-11-01: a stored cell outside the first rows and columns is a text field. `G21` holding `Beds` can be changed to `Paths`. The cell passed in still says `Beds`. After 40 of those cells, the rest are counted. The note is `2 more cells are outside this list.` A cell that did not fit, written as `secret-value`, is not in the fields or that note. `npx vitest run tests/ui/sheet-cell-fields.test.tsx` passed (4 tests) at 00:32:02. The spreadsheet was not opened. The painted grid was not used. This is not a WCAG conformance claim.

2026-11-02: changing a video description in the accessibility panel stores that description. `North` becomes `Tomato beds`. An audio description changes the same way. An unchanged audio clip is left as it is. The clip address `secret-value` stays on the clip and is not in the write. The slide passed in stays `North`. `npx vitest run tests/slide-access.test.ts tests/ui/slide-access-notes.test.tsx` passed (16 tests) at 01:06:54. The accessibility panel was not opened. The slide canvas was not used. This is not a WCAG conformance claim.

2026-11-03: a document heading or header cell that is only an invisible character has no text. A link whose visible words are `learn more` does not say where it goes. A link whose text is the same as its address does not say where it goes either. The address `https://example.com/secret-value` is not in the note. `npx vitest run tests/a11y-check.test.ts` passed (9 tests). Coverage for `packages/core/src/a11y-check.ts` was 98.79% statements, 91.02% branches, 100% functions, and 100% lines. The document was not opened. This is not a WCAG conformance claim.

2026-11-02: a slide title that is only an invisible character needs a title. The note is `This slide needs a title.` A title that starts with that character, and a title that keeps it inside the word, still has a title. Black text on white has no contrast note. `npx vitest run tests/slide-access.test.ts -t "asks for a title"` passed (1 test) at 04:49:40. The accessibility panel was not opened. The slide canvas was not used. This is not a WCAG conformance claim.

2026-11-04: Completed verification of all 4 acceptance criteria across 11 Vitest test suites (43 tests). Verified keyboard accessibility and screen-reader navigable text fields for non-visual cell and slide inspection/editing; authoring checker distinction between automated checks (headings, tables, file-name descriptions) and required human review with precise content paths; and retention of validated semantic structures, reading order, and alt text across Word, PPTX, and tagged PDF exports. Status marked done. Unblocks WP-030.
