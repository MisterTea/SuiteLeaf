on run argv
 set targetPath to item 1 of argv
 tell application "Microsoft PowerPoint"
  set n to count of presentations
  repeat with i from n to 1 by -1
   try
    if (full name of presentation i as text) is targetPath then close presentation i saving no
   end try
  end repeat
 end tell
end run
