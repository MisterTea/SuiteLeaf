# Zenodo10K PPTX Processing Subagent

You are processing ONE PowerPoint file from the Zenodo10K dataset to verify SuiteLeaf's
PowerPoint → PDF export against the ground-truth PDF.

## Steps

1. **Convert** the pptx to PDF using the SuiteLeaf CLI:
   ```
   node scripts/zenodo-run-one.mjs <PPTX_PATH> <OUTPUT_DIR>
   ```
   This runs the pipeline: it converts via the CLI, then compares the exported PDF
   against the ground-truth PDF (matched by pptx basename in ground-truth-pdf/*.json).

2. **Read** `<OUTPUT_DIR>/result.json` and report the status.

3. **If status is "review-required":**
   - Read `<OUTPUT_DIR>/compare/comparison.json`
   - Check `ordered_text_equal` for all pages.
   - If text is equal on all pages → the discrepancy is almost certainly **font
     substitution** (SuiteLeaf ships its own fonts that are layout-identical to MS
     Office but not pixel-identical). Note this as the likely cause.
   - If text differs → it may be an **import/content bug**. Note this.

4. **Report the status clearly** in this format:
   ```
   PPTX: <basename>
   STATUS: <raster-equal | review-required | convert-failed | compare-failed | no-ground-truth>
   PAGES: <flagged>/<total>
   TEXT_EQUAL: yes | no
   LIKELY_CAUSE: <font-substitution | content-bug | other>
   FIXES_APPLIED: <none | <description of any code fix>>
   ```

5. If you apply a code fix, describe it precisely (file, function, change) so the
   operator can review. Do not leave the fix half-applied.

## Notes
- The SuiteLeaf CLI is non-deterministic in bytes but visually deterministic, so
  the comparison against the fixed ground-truth is meaningful.
- A "review-required" with text_equal=yes and a small changed-pixel fraction
  (typically <15%) is expected for font substitution and is NOT necessarily a bug.
