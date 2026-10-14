# SuiteLeaf file format

SuiteLeaf files are UTF-8 JSON. Each kind of file has its own extension and MIME type so operating systems, SuiteDrive, and other tools can tell them apart without opening them:

| Kind | Extension | MIME type |
| --- | --- | --- |
| Document | `.sldoc` | `application/vnd.suiteleaf.doc+json` |
| Spreadsheet | `.slsheet` | `application/vnd.suiteleaf.sheet+json` |
| Presentation | `.slslides` | `application/vnd.suiteleaf.slides+json` |
| Form | `.slform` | `application/vnd.suiteleaf.form+json` |

Files saved by earlier versions use `.suiteleaf` and may hold any kind. SuiteLeaf still opens them, and saving through **Save As** or **Download** writes the per-kind extension.

## Envelope

Every file shares one envelope, validated by `fileSchema` in [`packages/core/src/index.ts`](../packages/core/src/index.ts):

```json
{
  "format": "suiteleaf",
  "version": 1,
  "id": "6f1c…",
  "kind": "doc",
  "title": "Quarterly notes",
  "createdAt": "2026-10-08T21:00:00.000Z",
  "updatedAt": "2026-10-08T21:05:00.000Z",
  "importInfo": { "sourceFormat": "docx", "sourceName": "notes.docx", "warnings": [], "features": [] },
  "content": {}
}
```

`importInfo` is present only for files converted from Office formats.

## Content by kind

- **`doc`**: a Tiptap/ProseMirror JSON tree rooted at `{ "type": "doc" }`. Images are embedded `data:image/(png|jpeg|gif|webp);base64,` URLs. Links must be `http(s):`, `mailto:`, `tel:`, or `#` fragments. Page setup is stored in `attrs.pageSettings` (`size`, `landscape`, `margin` in CSS pixels, `marginTop`, `marginBottom`, `marginLeft`, `marginRight`, `header`, `footer`, `pageNumbers`, `pageNumberFormat` of `fraction` ("1 / 2"), `page` ("Page 1"), or `roman` (lowercase "i", "ii"), `pageNumberPosition` of `bottom-right`, `bottom-center`, or `top-right`, `pageNumberPositionSet`, `pageNumberStart`, `coverHasNoNumber`, `differentFirstPage`, `firstHeader`, `firstFooter`, `watermark`). The four edges are CSS pixels. A file that only has `margin` opens with that inset on every edge. Without page setup a document is Letter, portrait, with 0.75 in margins and no header, footer, page numbers, or watermark. `pageNumberStart` defaults to 1 and is the number on the first page of the file. With `coverHasNoNumber`, the first page has no number and is not counted, so the second page is page 1; the footer text is unchanged and `pageNumberStart` is kept for when the cover is turned off. With `differentFirstPage`, page 1 uses `firstHeader` and `firstFooter` and shows no page number; later pages keep `header` and `footer`. Saved settings that lack `pageNumbers` show page numbers, as older versions did. Files that omit `pageNumberStart` or `coverHasNoNumber` start at 1 with every page numbered. A heading with `attrs.startArabic: true` restarts numbering at arabic 1 on that heading's page; earlier pages keep the chosen format, and the footer text is unchanged. Only the first such heading is used.
- **`sheet`**: `{ workbook, images?, charts, pivots }`. `workbook` is a Univer workbook snapshot with `sheetOrder` and `sheets` keyed by worksheet ID; cells live in `cellData[row][column]` as `{ v, f, t, s }`. Charts and pivots refer to worksheets by ID.
- **`slide`**: `{ id, width, height, slideOrder, slides }`. Each slide has `elements` (text, shape, image, or table) positioned in presentation pixels, plus optional `background`, `layout`, and `notes`.
- **`form`**: `{ questions, responses }`. A question has `id`, `prompt`, `kind` (`text` or `choice`), `required`, and optional `choices`. A response has `id`, `at`, and `answers` keyed by question id. The questions and the answers are the same file.

## Validation rules

- The extension must match `kind`. A spreadsheet saved as `.sldoc` is rejected.
- Files larger than 200 MB, newer versions, external image references, and unsafe links are rejected.
- Worksheet and slide orders must be non-empty, distinct, and refer to existing entries.

Future incompatible changes must raise `version` and add an explicit migration.
