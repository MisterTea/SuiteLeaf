# Histogram

`histogramBins` counts finite numbers in equal-width bins. The values `1`, `2`, `3`, `8`, `9`, and `10` in two bins are `1–5.5` with count 3 and `5.5–10` with count 3. The highest value stays in the last bin. A value that is not a finite number is skipped and counted in `skipped`. A column `10`, `secret-value`, `20` keeps the numbers `10` and `20` and skips one value. A cell written as `10` or ` 4 ` is counted as that number. The note is `1 value was not a number.` That word is not in the result. The histogram chart shows that note. When every finite value is the same, one bin is that number and its count.

The spreadsheet chart type Histogram draws one bar per bin. The bar height is the count. Saving the workbook and opening it again keeps the type `histogram`. An Excel export writes it as `barChart`, a column chart of those counts, not a native Excel histogram. The list passed in is not modified.
