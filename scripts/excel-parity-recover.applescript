-- Approve recovery only for the exact disposable copy named by the caller.
on run argv
 set auditedName to item 1 of argv
 set recoveryApproved to false
 repeat 200 times
  tell application "System Events"
   if exists process "Microsoft Excel" then
    tell process "Microsoft Excel"
     repeat with w in windows
      try
       repeat with t in static texts of w
        set messageText to value of t as text
        if messageText contains auditedName and messageText contains "Do you want us to try to recover" then
         click button "Yes" of w
         set recoveryApproved to true
        else if recoveryApproved and messageText is "Excel was able to open the file by repairing or removing the unreadable content." then
         -- View preserves the repair log; Delete would discard it.
         click button "View" of w
         return "Recovered disposable workbook: " & auditedName
        end if
       end repeat
      end try
     end repeat
    end tell
   end if
  end tell
  delay 0.2
 end repeat
 if recoveryApproved then return "Recovered disposable workbook: " & auditedName
 return "No matching workbook recovery prompt"
end run
