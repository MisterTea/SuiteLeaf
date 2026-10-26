-- Approve PowerPoint's sandbox prompt so an unattended PDF export can write its output.
repeat
 try
  tell application "System Events"
   if exists process "Microsoft Error Reporting" then
    try
     tell application "Microsoft Error Reporting" to quit
    end try
   end if
   if exists process "Microsoft PowerPoint" then
    tell process "Microsoft PowerPoint"
     set openPanel to false
     repeat with w in windows
      if name of w is "Open" then
       set openPanel to true
       try
        if exists button "Grant Access" of splitter group 1 of w then
         if enabled of button "Grant Access" of splitter group 1 of w then
          click button "Grant Access" of splitter group 1 of w
         end if
        end if
       end try
      end if
     end repeat
     if not openPanel then
      if exists window "Grant File Access" then
       try
        click button "Select..." of window "Grant File Access"
       end try
      end if
     end if
     -- A repair prompt blocks open until the script times out. Cancel leaves the file unchanged.
     repeat with w in windows
      try
       set repairFound to false
       set cancelControl to missing value
       repeat with uiItem in (entire contents of w)
        try
         if role of uiItem is "AXButton" then
          if name of uiItem is "Repair" then set repairFound to true
          if name of uiItem is "Cancel" then set cancelControl to uiItem
         end if
        end try
       end repeat
       if repairFound and cancelControl is not missing value then click cancelControl
      end try
     end repeat
    end tell
   end if
  end tell
 end try
 delay 0.4
end repeat
