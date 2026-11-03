# Stacked chart

A stacked chart puts every series in one column. North dues of `40` and compost of `15` add to `55`. A missing number adds nothing, so South dues of `10` with no compost stay `10`. A value that is not finite adds nothing, so dues of `40` beside a value that is not a number stay `40`, and a value that is not finite beside compost of `10` stays `10`. The total is not `NaN`. The source rows are not changed.

Saving a workbook chart whose type is `stacked` and opening it again keeps that type. The chart type list includes Stacked. An Excel export writes `barChart` with grouping `stacked`. It is not a combo chart and it does not add a line.

A series cell that is text is left out of the column and counted. The chart says `1 value was not a number.` The typed word stays in the cell and is not copied into that note. An empty cell is not counted.
