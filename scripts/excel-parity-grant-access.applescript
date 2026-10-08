-- Only approve the audited disposable file's exact Excel sandbox read prompt.
on run argv
 set expectedPrompt to "Please select the file \"" & (item 1 of argv) & "\":"
 repeat 200 times
  tell application "System Events"
   if exists process "Microsoft Excel" then
    tell process "Microsoft Excel"
     repeat with w in windows
      if name of w is "Open" then
       try
        set containerRef to splitter group 1 of w
        if exists static text expectedPrompt of containerRef then
         if (count of argv > 1) then
          if item 2 of argv is "cancel" then
           click button "Cancel" of containerRef
           return "Cancelled audited file-read request"
          end if
         else if exists button "Grant Access" of containerRef then
          if enabled of button "Grant Access" of containerRef then
           click button "Grant Access" of containerRef
           return "Granted file-read access to " & (item 1 of argv)
          end if
         end if
        end if
       end try
      end if
     end repeat
    end tell
   end if
  end tell
  if count of argv > 1 then return "No matching audited file-read dialog"
  delay 0.2
 end repeat
 return "No matching Excel file-read prompt"
end run
