-- Native Excel audit control. The caller must pass a disposable workbook copy.
-- Never closes other workbooks or saves a source file.
on jsonString(v)
 set s to v as text
 set AppleScript's text item delimiters to "\\"
 set parts to text items of s
 set AppleScript's text item delimiters to "\\\\"
 set s to parts as text
 set AppleScript's text item delimiters to "\""
 set parts to text items of s
 set AppleScript's text item delimiters to "\\\""
 set s to parts as text
 set AppleScript's text item delimiters to return
 set parts to text items of s
 set AppleScript's text item delimiters to "\\n"
 set s to parts as text
 set AppleScript's text item delimiters to linefeed
 set parts to text items of s
 set AppleScript's text item delimiters to "\\n"
 set s to parts as text
 set AppleScript's text item delimiters to tab
 set parts to text items of s
 set AppleScript's text item delimiters to "\\t"
 set s to parts as text
 set AppleScript's text item delimiters to ""
 return "\"" & s & "\""
end jsonString
on run argv
 set operation to item 1 of argv
 tell application "Microsoft Excel"
  if operation is "version" then return my jsonString(version)
  if operation is "security" then return my jsonString(automation security as text)
  if operation is "restore-security" then
   set savedSecurity to item 2 of argv
   if savedSecurity is "msoAutomationSecurityLow" then
    set automation security to msoAutomationSecurityLow
   else if savedSecurity is "msoAutomationSecurityByUI" then
    set automation security to msoAutomationSecurityByUI
   else if savedSecurity is "msoAutomationSecurityForceDisable" then
    set automation security to msoAutomationSecurityForceDisable
   else
    error "Unknown original automation security setting"
   end if
   return "true"
  end if
  if operation is "exists" then return ((name of every workbook) contains (item 2 of argv)) as text
  if operation is "open" then
   set oldSecurity to automation security as text
   set automation security to msoAutomationSecurityForceDisable
   try
    set pwd to ""
    if count of argv > 2 then set pwd to item 3 of argv
    open workbook workbook file name (item 2 of argv) update links do not update links read only true password pwd write reserved password "" ignore read only recommended true editable true add to mru false
    -- Malformed workbooks can return before the recovery dialog is answered.
    -- Bind only the caller's uniquely named disposable workbook after it opens.
    if count of argv < 4 then error "Disposable workbook name is required"
    set expectedWorkbook to item 4 of argv
    repeat 150 times
     if (name of every workbook) contains expectedWorkbook then exit repeat
     delay 0.2
    end repeat
    if not ((name of every workbook) contains expectedWorkbook) then error "Audited workbook did not finish opening"
    set wb to workbook expectedWorkbook
    if oldSecurity is "msoAutomationSecurityLow" then
     set automation security to msoAutomationSecurityLow
    else if oldSecurity is "msoAutomationSecurityByUI" then
     set automation security to msoAutomationSecurityByUI
    else
     set automation security to msoAutomationSecurityForceDisable
    end if
    activate
    try
     set bounds of active window to {6, 33, 1206, 833}
    end try
    tell application "System Events"
     tell process "Microsoft Excel"
      repeat with auditWindow in windows
       if name of auditWindow is expectedWorkbook or name of auditWindow starts with expectedWorkbook & "  -" then
        set position of auditWindow to {6, 33}
        set size of auditWindow to {1440, 900}
       end if
      end repeat
     end tell
    end tell
    return "{\"workbook\":" & my jsonString(name of wb) & ",\"sheet_count\":" & (count of sheets of wb) & ",\"excel_version\":" & my jsonString(version) & "}"
   on error msg number n
    if oldSecurity is "msoAutomationSecurityLow" then
     set automation security to msoAutomationSecurityLow
    else if oldSecurity is "msoAutomationSecurityByUI" then
     set automation security to msoAutomationSecurityByUI
    else
     set automation security to msoAutomationSecurityForceDisable
    end if
    error msg number n
   end try
  end if
  set wb to workbook (item 2 of argv)
  if operation is "close" then
   close wb saving no
   return "{\"closed\":true}"
  end if
  set sh to sheet ((item 3 of argv) as integer) of wb
  if operation is "info" then
   return "{\"name\":" & my jsonString(name of sh) & ",\"visibility\":" & my jsonString(visible of sh as text) & "}"
  end if
  if operation is "sheet" then
   set originalVisibility to visible of sh as text
   set sheetName to name of sh
   set visible of sh to sheet visible
   activate object sh
   set originalView to view of active window as text
   set view of active window to normal view
   set zoom of active window to 100
   set ur to used range of sh
   set maxRow to (first row index of ur) + (count of rows of ur) - 1
   set maxCol to (first column index of ur) + (count of columns of ur) - 1
   repeat with shapeIndex from 1 to count of shapes of sh
    set shapeBounds to my drawingBounds(shape shapeIndex of sh, sh)
    set maxRow to my maxValue(maxRow, item 1 of shapeBounds)
    set maxCol to my maxValue(maxCol, item 2 of shapeBounds)
   end repeat
   repeat with chartIndex from 1 to count of chart objects of sh
    set chartBounds to my drawingBounds(chart object chartIndex of sh, sh)
    set maxRow to my maxValue(maxRow, item 1 of chartBounds)
    set maxCol to my maxValue(maxCol, item 2 of chartBounds)
   end repeat
   set columnWidths to "["
   repeat with columnIndex from 1 to maxCol
    if columnIndex > 1 then set columnWidths to columnWidths & ","
    set columnWidths to columnWidths & (width of column columnIndex of sh)
   end repeat
   set columnWidths to columnWidths & "]"
   return "{\"index\":" & (item 3 of argv) & ",\"name\":" & my jsonString(sheetName) & ",\"visibility\":" & my jsonString(originalVisibility) & ",\"original_view\":" & my jsonString(originalView) & ",\"capture_view\":\"normal view\",\"original_column_widths_points\":" & columnWidths & ",\"used_range\":" & my jsonString(get address of ur) & ",\"last_row\":" & maxRow & ",\"last_column\":" & maxCol & ",\"freeze_panes\":" & (freeze panes of active window as text) & ",\"split_row\":" & (split row of active window) & ",\"split_column\":" & (split column of active window) & "}"
  end if
  if operation is "metrics" then
   set rr to range (item 4 of argv) of sh
   return "{\"width_points\":" & (width of rr) & ",\"height_points\":" & (height of rr) & "}"
  end if
  if operation is "readability" then
   set column width of entire column of used range of sh to 24
   set wrap text of used range of sh to true
   autofit entire row of used range of sh
   set rowHeights to "["
   repeat with rowIndex from 1 to ((first row index of used range of sh) + (count of rows of used range of sh) - 1)
    if rowIndex > 1 then set rowHeights to rowHeights & ","
    set rowHeights to rowHeights & (height of row rowIndex of sh)
   end repeat
   set rowHeights to rowHeights & "]"
   set columnWidths to "["
   repeat with columnIndex from 1 to ((item 4 of argv) as integer)
    if columnIndex > 1 then set columnWidths to columnWidths & ","
    set columnWidths to columnWidths & (width of column columnIndex of sh)
   end repeat
   return "{\"column_widths_points\":" & columnWidths & "],\"row_heights_points\":" & rowHeights & ",\"wrap_text\":true,\"supplemental\":true,\"column_width_characters\":24}"
  end if
  if operation is "tile" then
   activate object sh
   set zoom of active window to 100
   try
    activate object range "IV65536" of sh
   end try
   set targetPane to last pane of active window
   set scroll row of targetPane to (item 4 of argv) as integer
   set scroll column of targetPane to (item 5 of argv) as integer
   set vr to visible range of targetPane
   set r1 to first row index of vr
   set c1 to first column index of vr
   set r2 to r1 + (count of rows of vr) - 1
   set c2 to c1 + (count of columns of vr) - 1
   set b to bounds of active window
   if b is missing value then set b to {6, 33, 1206, 833}
   return "{\"range\":" & my jsonString(get address of vr) & ",\"row_start\":" & r1 & ",\"row_end\":" & r2 & ",\"column_start\":" & c1 & ",\"column_end\":" & c2 & ",\"bounds\":[" & (item 1 of b) & "," & (item 2 of b) & "," & (item 3 of b) & "," & (item 4 of b) & "]}"
  end if
  error "Unknown operation " & operation
 end tell
end run
on maxValue(a, b)
 if a > b then return a
 return b
end maxValue
on drawingBounds(drawingRef, sh)
 tell application "Microsoft Excel"
  try
   set br to bottom right cell of drawingRef
   return {first row index of br, first column index of br}
  end try
  -- Some native chart/shape objects do not expose bottom right cell. Determine
  -- the original footprint from their native point geometry and sheet sizes.
  set bottomEdge to top of drawingRef + height of drawingRef
  set rightEdge to left position of drawingRef + width of drawingRef
  set rowIndex to 1
  set accumulatedHeight to 0
  repeat while accumulatedHeight < bottomEdge
   set accumulatedHeight to accumulatedHeight + height of row rowIndex of sh
   set rowIndex to rowIndex + 1
   if rowIndex > 1048576 then error "Drawing extends outside worksheet rows"
  end repeat
  set columnIndex to 1
  set accumulatedWidth to 0
  repeat while accumulatedWidth < rightEdge
   set accumulatedWidth to accumulatedWidth + width of column columnIndex of sh
   set columnIndex to columnIndex + 1
   if columnIndex > 16384 then error "Drawing extends outside worksheet columns"
  end repeat
  return {my maxValue(1, rowIndex - 1), my maxValue(1, columnIndex - 1)}
 end tell
end drawingBounds
