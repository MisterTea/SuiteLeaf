# Chart summary

`chartSummary` describes a chart without the painted picture and without the cell values. A combo chart titled Plot fees, with series Dues and Rate, categories North and South, and Rate on the right axis, reads: Combo chart Plot fees. Series Dues and Rate. Categories North and South. Right axis Rate. Legend bottom.

A line chart keeps a missing number in its own category. The line stops at that category and continues at the next number, so a later amount is not drawn on the earlier category. The drawing does not include `NaN`.

A pie percent uses only finite amounts. `10` and a value that is not a number are `100%` and `0%`. A value that is not finite is `0%`. The labels still add to 100 when the amounts are finite and greater than zero.

A blank title is Untitled chart. A chart with no series names says so. A chart marked invalid says that. The series color is not part of the sentence. A combo chart whose series do not already name a right axis puts the last series there. Headers Plot, Dues, and Rate put Rate on the right axis. One value column stays on the left. The spreadsheet accessibility panel uses the header row of a combo chart that has no stored series. A data cell is not included. The panel was not opened in the browser for this sentence. This is not a WCAG claim.
