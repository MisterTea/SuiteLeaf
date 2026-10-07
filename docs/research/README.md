# Workspace ebook research

Research date: October 6, 2026 (America/Chicago).

The requested target was 5–10 how-to ebooks for each of 22 Google Workspace products, with full downloads only. **That target has not been met.** This research identifies full works from publishers and authors, records paid ebook listings, and shows the remaining shortfalls rather than filling them with unrelated books, previews, or fabricated titles.

- [Product-by-product catalog](catalog.md): selected books for every requested product, with access status and coverage gaps.
- [Coverage CSV](coverage.csv): ebook counts and shortfalls by product; handbooks counted separately.
- [Book metadata](books.json): 50 paid, licensed, or publisher-gated listings, with sources and limitations.
- [Download manifest](downloads.json): 14 successful full downloads and one failed download, with original URLs, file types, sizes, page counts, and SHA-256 hashes.
- [Search evidence](search-evidence.json): source links discovered during searches, including rejected and irrelevant candidates. This is discovery evidence, not an endorsement list.

The downloaded library is at `research-library/` in the repository root. It contains **eight ebooks and six full handbooks/guides**, totaling about 95 MB. These are original publisher/author files; no preview was converted into a book. Downloads and private validation extracts are gitignored so they are not accidentally redistributed under SuiteLeaf's license. Download permission does not imply permission to incorporate a book into SuiteLeaf or publish it with the project.

## Search and selection

General web searches covered every requested product, followed by publisher, author, ebook-retailer, and full-PDF searches. The Yandex query was attempted through both the web tool and direct HTTP access: [Yandex Workspace ebook search](https://yandex.com/search/?text=Google+Workspace+ebook+official+pdf). The web tool could not access results, and direct access returned SmartCaptcha. **No Yandex results were verified.**

No purchases, account sign-ins, marketing-form submissions, paywall bypasses, or unverified ebook-mirror downloads were performed. Wiley, O'Reilly, Packt, author storefronts, and authorized ebook retailers are represented in the catalog. No product-specific Head First or Clean Code how-to titles were verified; general engineering books were not used to fill product quotas.

The phrase “Gemini Notebook,” described in the request as a research and note-organizing assistant, is indexed here with **NotebookLM** material. This is a scope interpretation, not a claim that every Gemini-branded notebook feature is equivalent to NotebookLM.

## How to read the counts

Book listings establish that an ebook is offered; they do not mean it has been downloaded, read in full, or quality-approved. Retailer descriptions are labeled where full text is unavailable. Broad Workspace books appear under multiple products but are stored and counted once as individual works. A product may have 5–10 relevant listings while still having zero downloaded ebooks. Several listings cover older interfaces or partial workflows; the notes identify these limits. P02 is a predecessor of P01 with substantial overlap, and the very old P07 is excluded from the five-book target.

Short role handbooks, compliance guides, and the five-page Sites guide are shown separately and do not count as ebooks toward the requested target. Logitech's ebook is about hybrid-meeting practice and has narrower coverage than a Meet manual. The failed PDST Forms ebook is a verified listing, not a saved file.

## Verification

All 13 saved PDFs have valid PDF headers and readable page trees. Every page was parsed, with Poppler text extraction used for one PDF whose embedded font data confused the Python extractor. Covers and closing pages were reviewed, and rendered covers were visually inspected. The EPUB's ZIP integrity, package, reading order, chapter text, and closing content were checked. File hashes and byte sizes are recorded in the manifest. Completeness means the full work as offered by the source, with coherent opening and closing material; it is not a claim that each book documents every product feature.

The PDST Forms host failed its connection handshake even on retry; its file is not included locally. Google's former `gemini-for-google-workspace-prompting-guide-101.pdf` URL returned 404, so the download uses the current full PDF linked by Google's own prompting-guide landing page.

## Reproducing the downloads

`download-library.py` reads `downloads.json` and retrieves only the curated direct URLs. Use a Python environment with `pypdf`, plus `curl`, `pdfinfo`, and `pdftotext`. It validates successful existing files without fetching them again and records failed attempts instead of saving HTML as an ebook. It makes no purchases or submissions. Preserve each original document's attribution and terms.

These books support later research into user workflows. They are not specifications for copying Google's implementation, branding, or proprietary material. No application code or implementation plan has been created in this step.
