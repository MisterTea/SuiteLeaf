on run argv
 set sourcePath to item 1 of argv
 set outputPath to item 2 of argv
 set AppleScript's text item delimiters to "/"
 set sourceName to last text item of sourcePath
 set AppleScript's text item delimiters to ""
 -- Open a local copy. Opening the share copy raises Grant File Access and the save never starts.
 set localSource to "/tmp/suiteleaf-open-" & sourceName
 do shell script "cp " & quoted form of sourcePath & " " & quoted form of localSource
 set sourceFile to (POSIX file localSource) as alias
 set resolvedSource to POSIX path of sourceFile
 if resolvedSource ends with "/" then set resolvedSource to text 1 thru -2 of resolvedSource
 set outputHFS to (POSIX file outputPath) as text
 with timeout of 1800 seconds
  -- Leftover staged decks keep their Export As PDF windows and eventually block close.
  my closeNativeInputExcept(resolvedSource)
  tell application "Microsoft PowerPoint"
   set oldNames to full name of every presentation
   if oldNames contains sourcePath or oldNames contains resolvedSource then error "Source is already open; preserve existing presentation: " & sourcePath
   try
    with timeout of 180 seconds
     open sourceFile
    end timeout
   on error errorText number errorNumber
    if my dismissRepair(resolvedSource) then error "source-repair-required (original unchanged): " & sourcePath
    error errorText number errorNumber
   end try
   set chosen to 0
   repeat with attempt from 1 to 120
    repeat with i from 1 to count of presentations
     set pname to full name of presentation i as text
     if pname is sourcePath or pname is resolvedSource or pname ends with sourceName then set chosen to i
    end repeat
    if chosen > 0 then exit repeat
    delay 0.5
   end repeat
   if chosen = 0 then error "Opened presentation not found"
   set slideCount to count of slides of presentation chosen
   try
    set print hidden slides of print options of presentation chosen to true
    set output type of print options of presentation chosen to print slides
    set range type of print options of presentation chosen to print range all
   end try
   -- Save on the local disk. A direct Save as PDF onto the share stalls in PowerPoint.
   set AppleScript's text item delimiters to "/"
   set outputName to last text item of outputPath
   set AppleScript's text item delimiters to ""
   set localPDF to "/tmp/suiteleaf-" & outputName
   set localHFS to (POSIX file localPDF) as text
   do shell script "rm -f " & quoted form of localPDF
   with timeout of 240 seconds
    save presentation chosen in localHFS as save as PDF
   end timeout
   set outputReady to false
   repeat with attempt from 1 to 60
    try
     my assertOutputExists(localPDF)
     do shell script "mv " & quoted form of localPDF & " " & quoted form of outputPath
     my assertOutputExists(outputPath)
     set outputReady to true
     exit repeat
    end try
    delay 1
   end repeat
   if not outputReady then error "PDF save did not produce output; presentation left open for inspection"
   my closeNativeInputExcept("")
   return (version as text) & tab & (slideCount as text)
  end tell
 end timeout
end run


on dismissRepair(sourcePath)
 tell application "System Events"
  tell process "Microsoft PowerPoint"
   if not (exists window 1) then return false
   try
    set targetURL to value of attribute "AXDocument" of window 1
    if targetURL does not contain sourcePath then return false
   on error
    return false
   end try
   set controls to entire contents of window 1
   set repairFound to false
   set cancelControl to missing value
   repeat with uiItem in controls
    try
     if class of uiItem is button then
      if name of uiItem is "Repair" then set repairFound to true
      if name of uiItem is "Cancel" then set cancelControl to uiItem
     end if
    end try
   end repeat
   if repairFound and cancelControl is not missing value then
    click cancelControl
    return true
   end if
  end tell
 end tell
 return false
end dismissRepair

on assertOutputExists(outputPath)
 do shell script "/bin/test -s " & quoted form of outputPath
end assertOutputExists

on closeNativeInputExcept(keepPath)
 tell application "Microsoft PowerPoint"
  set n to count of presentations
  do shell script "printf '%s\\n' " & quoted form of ("presentations " & n) & " >> /tmp/suiteleaf-close.log"
  repeat with i from n to 1 by -1
   try
    set idx to i as integer
    set pth to full name of presentation idx as text
    if pth is not keepPath and (pth contains "native-input" or pth contains "-source") then
     try
      with timeout of 8 seconds
       set saved of presentation idx to true
       close presentation idx saving no
      end timeout
     on error errMsg
      do shell script "printf '%s\\n' " & quoted form of ("fail " & errMsg & " :: " & pth) & " >> /tmp/suiteleaf-close.log"
     end try
    end if
   on error errMsg
    do shell script "printf '%s\\n' " & quoted form of ("err " & errMsg) & " >> /tmp/suiteleaf-close.log"
   end try
  end repeat
  repeat with i from (count of document windows) to 1 by -1
   try
    set idx to i as integer
    set wname to caption of document window idx as text
    do shell script "printf '%s\\n' " & quoted form of ("win " & wname) & " >> /tmp/suiteleaf-close.log"
    if wname contains "source" then
     close document window idx
    end if
   on error errMsg
    do shell script "printf '%s\\n' " & quoted form of ("winfail " & errMsg) & " >> /tmp/suiteleaf-close.log"
   end try
  end repeat
 end tell
end closeNativeInputExcept
